import type {
  ApprovalRecord,
  AuditEvent,
  EvidenceRecord,
  ItemRecord,
  ListingRecord,
  SellerConnection,
  SellerAcknowledgement,
  StoredImage
} from '../domain/types.js';
import type { EbayLeafCategory, Store } from './store.js';
import type { GmCatalogImportOptions, GmCatalogPart, GmCatalogStatus } from '../catalog/gm-catalog.js';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import { mergeGmCatalogParts } from '../catalog/gm-catalog-merge.js';
import type { EbayReferenceCacheRecord } from '../ebay/reference-types.js';
import type { CommunitySubmissionRecord, StoredCommunityImage } from '../community/types.js';
import type {
  VintageGmCatalogMatch,
  VintageGmCatalogMatchPool,
  VintageGmDatasetStatus,
  VintageGmImportOptions,
  VintageGmInventoryQuestionIntent,
  VintageGmInventoryQuestionMatch,
  VintageGmInventoryQuestionPool,
  VintageGmInventoryRecord
} from '../vintage-gm/types.js';
import {
  MAX_VINTAGE_INVENTORY_ANSWER_ROWS,
  matchesVintagePartQuery,
  matchesVintageVehicleApplication,
  resolveVintageGmIntentFromCatalogModels
} from '../vintage-gm/inventory-question.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface MemoryVintageGmDataset extends Omit<VintageGmDatasetStatus, 'datasetId'> {
  datasetId: string;
}

export class MemoryStore implements Store {
  private readonly items = new Map<string, ItemRecord>();
  private readonly evidence: EvidenceRecord[] = [];
  private readonly approvals: ApprovalRecord[] = [];
  private readonly listings = new Map<string, ListingRecord>();
  private readonly connections = new Map<string, SellerConnection>();
  private readonly images = new Map<string, StoredImage>();
  private readonly audits: AuditEvent[] = [];
  private readonly publishSlots = new Map<string, { sellerId: string; status: 'RESERVED' | 'SUCCEEDED' }>();
  private readonly oauthNonces = new Map<string, { sellerId: string; expiresAt: string; consumedAt?: string }>();
  private readonly acknowledgements = new Map<string, SellerAcknowledgement>();
  private readonly gmCatalog = new Map<string, GmCatalogPart>();
  private readonly vintageGmInventory = new Map<string, { datasetId: string; record: VintageGmInventoryRecord }>();
  private readonly vintageGmDatasets = new Map<string, MemoryVintageGmDataset>();
  private readonly ebayReferenceCache = new Map<string, EbayReferenceCacheRecord>();
  private readonly communitySubmissions = new Map<string, CommunitySubmissionRecord>();
  private readonly communityImages = new Map<string, StoredCommunityImage>();
  private gmCatalogComplete = false;
  private gmCatalogDatasetId: string | null = null;

  async listEbayLeafCategories(query = '', limit = 2_000): Promise<EbayLeafCategory[]> {
    const rows: EbayLeafCategory[] = [
      { categoryId: '174021', categoryName: 'Brake Boosters', categoryPath: 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories › Brakes & Brake Parts › Brake Boosters' },
      { categoryId: '9886', categoryName: 'Other Car & Truck Parts & Accessories', categoryPath: 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories › Other Car & Truck Parts & Accessories' }
    ];
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => !needle || row.categoryId === needle || `${row.categoryName} ${row.categoryPath}`.toLowerCase().includes(needle))
      .slice(0, Math.min(Math.max(limit, 1), 2_500))
      .map(clone);
  }

  async saveCommunitySubmission(record: CommunitySubmissionRecord): Promise<void> {
    this.communitySubmissions.set(record.id, clone(record));
  }

  async getCommunitySubmission(id: string): Promise<CommunitySubmissionRecord | undefined> {
    const record = this.communitySubmissions.get(id);
    return record ? clone(record) : undefined;
  }

  async listCommunitySubmissionsForReview(limit: number): Promise<CommunitySubmissionRecord[]> {
    return [...this.communitySubmissions.values()]
      .filter((record) => ['SCREENING','PENDING_HUMAN_REVIEW','PROCESSING','READY_FOR_ARCHIVE','FAILED'].includes(record.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async saveCommunityImage(record: StoredCommunityImage): Promise<void> {
    this.communityImages.set(record.id, clone(record));
  }

  async getCommunityImage(id: string): Promise<StoredCommunityImage | undefined> {
    const record = this.communityImages.get(id);
    return record ? clone(record) : undefined;
  }

  async listCommunityImages(submissionId: string): Promise<StoredCommunityImage[]> {
    return [...this.communityImages.values()].filter((record) => record.submissionId === submissionId).sort((a,b) => a.order-b.order).map(clone);
  }

  async listCommunityImagesByPartNumber(partNumber: string): Promise<StoredCommunityImage[]> {
    return [...this.communityImages.values()]
      .filter((record) => record.partNumber === partNumber)
      .map((record) => structuredClone(record));
  }

  async listPublishedCommunityImages(partNumber: string): Promise<StoredCommunityImage[]> {
    const key = canonicalOemPartNumber(partNumber);
    return [...this.communityImages.values()]
      .filter((record) => record.partNumber === key && record.status === 'PUBLISHED')
      .sort((a,b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '') || a.order-b.order)
      .map((record) => ({ ...clone(record), contributorCredit: this.communitySubmissions.get(record.submissionId)?.contributorCredit ?? 'PartQuill contributor' }));
  }

  async getPublishedCommunityAsset(filename: string): Promise<StoredCommunityImage | undefined> {
    const record = [...this.communityImages.values()].find((row) => row.status === 'PUBLISHED' && row.archiveFilename === filename);
    return record ? clone(record) : undefined;
  }

  async getEbayReferenceCache(partNumber: string): Promise<EbayReferenceCacheRecord | undefined> {
    const record = this.ebayReferenceCache.get(canonicalOemPartNumber(partNumber));
    return record ? clone(record) : undefined;
  }

  async saveEbayReferenceCache(record: EbayReferenceCacheRecord): Promise<void> {
    this.ebayReferenceCache.set(canonicalOemPartNumber(record.partNumber), clone(record));
  }

  async deleteEbayReferenceCache(partNumber: string): Promise<void> {
    this.ebayReferenceCache.delete(canonicalOemPartNumber(partNumber));
  }

  async purgeExpiredEbayReferenceCache(at: string): Promise<number> {
    const cutoff = Date.parse(at);
    let deleted = 0;
    for (const [partNumber, record] of this.ebayReferenceCache) {
      if (record.status === 'MATCHED_LIVE_REFERENCE' && record.expiresAt && Date.parse(record.expiresAt) <= cutoff) {
        this.ebayReferenceCache.delete(partNumber);
        deleted += 1;
      }
    }
    return deleted;
  }

  async importGmCatalogRecords(records: GmCatalogPart[], options: GmCatalogImportOptions = {}): Promise<void> {
    for (const record of records) {
      const partNumber = canonicalOemPartNumber(record.partNumber);
      if (!partNumber) continue;
      const incoming = clone({ ...record, partNumber });
      const current = this.gmCatalog.get(partNumber);
      this.gmCatalog.set(partNumber, current ? mergeGmCatalogParts(current, incoming) : incoming);
    }
    this.gmCatalogDatasetId = options.datasetId ?? this.gmCatalogDatasetId ?? 'gm-catalog-memory';
    this.gmCatalogComplete = options.complete ?? false;
  }

  async lookupGmCatalogPart(partNumber: string): Promise<GmCatalogPart | undefined> {
    const record = this.gmCatalog.get(canonicalOemPartNumber(partNumber));
    return record ? clone(record) : undefined;
  }

  async getGmCatalogStatus(): Promise<GmCatalogStatus> {
    const partNumbers = [...this.gmCatalog.keys()].sort();
    return {
      datasetId: partNumbers.length ? this.gmCatalogDatasetId ?? 'gm-catalog-memory' : null,
      status: this.gmCatalogComplete ? 'completed' : partNumbers.length ? 'running' : 'not_started',
      importedParts: partNumbers.length,
      availableParts: partNumbers.length,
      lastPartNumber: partNumbers.at(-1) ?? null
    };
  }

  async importVintageGmRecords(
    records: VintageGmInventoryRecord[],
    options: VintageGmImportOptions
  ): Promise<VintageGmDatasetStatus> {
    const current = this.vintageGmDatasets.get(options.datasetId);
    if (current && (
      current.sourceSha256 !== options.sourceSha256
      || current.sourceFileName !== options.sourceFileName
      || current.expectedGmRows !== options.expectedGmRows
      || current.sourceTotalRows !== options.sourceTotalRows
    )) throw new Error('Vintage GM dataset metadata does not match the existing import');

    for (const record of records) {
      this.vintageGmInventory.set(`${options.datasetId}:${record.sourceRow}`, {
        datasetId: options.datasetId,
        record: clone(record)
      });
    }
    const datasetRecords = [...this.vintageGmInventory.values()]
      .filter((entry) => entry.datasetId === options.datasetId)
      .map((entry) => entry.record);
    if (options.complete && datasetRecords.length !== options.expectedGmRows) {
      throw new Error(`Vintage GM import is incomplete: expected ${options.expectedGmRows}, found ${datasetRecords.length}`);
    }
    const timestamp = new Date().toISOString();
    if (options.complete) {
      for (const [datasetId, dataset] of this.vintageGmDatasets) {
        this.vintageGmDatasets.set(datasetId, { ...dataset, active: false });
      }
    }
    const partNumbers = new Set(datasetRecords.flatMap((record) => record.partNumber ? [record.partNumber] : []));
    const next: MemoryVintageGmDataset = {
      datasetId: options.datasetId,
      status: options.complete ? 'completed' : 'running',
      active: options.complete ?? false,
      sourceSha256: options.sourceSha256,
      sourceFileName: options.sourceFileName,
      sourceTotalRows: options.sourceTotalRows,
      expectedGmRows: options.expectedGmRows,
      importedRows: datasetRecords.length,
      normalizedRows: datasetRecords.filter((record) => record.normalizationState === 'NORMALIZED_EXACT_KEY').length,
      rejectedRows: datasetRecords.filter((record) => record.normalizationState !== 'NORMALIZED_EXACT_KEY').length,
      distinctPartNumbers: partNumbers.size,
      catalogKeyMatches: [...partNumbers].filter((partNumber) => this.gmCatalog.has(partNumber)).length,
      completedAt: options.complete ? timestamp : null,
      updatedAt: timestamp
    };
    this.vintageGmDatasets.set(options.datasetId, next);
    return clone(next);
  }

  async getVintageGmStatus(): Promise<VintageGmDatasetStatus> {
    const datasets = [...this.vintageGmDatasets.values()]
      .sort((left, right) => Number(right.active) - Number(left.active)
        || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
    return datasets[0] ? clone(datasets[0]) : {
      datasetId: null,
      status: 'not_started',
      active: false,
      sourceSha256: null,
      sourceFileName: null,
      sourceTotalRows: 0,
      expectedGmRows: 0,
      importedRows: 0,
      normalizedRows: 0,
      rejectedRows: 0,
      distinctPartNumbers: 0,
      catalogKeyMatches: 0,
      completedAt: null,
      updatedAt: null
    };
  }

  async listVintageGmCatalogMatches(limit: number): Promise<VintageGmCatalogMatchPool> {
    const dataset = [...this.vintageGmDatasets.values()]
      .filter((candidate) => candidate.active && candidate.status === 'completed')
      .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
    if (!dataset) return { dataset: await this.getVintageGmStatus(), matches: [] };

    const grouped = new Map<string, VintageGmInventoryRecord[]>();
    for (const entry of this.vintageGmInventory.values()) {
      const record = entry.record;
      if (entry.datasetId !== dataset.datasetId || !record.partNumber || record.quantity <= 0) continue;
      const group = grouped.get(record.partNumber) ?? [];
      group.push(record);
      grouped.set(record.partNumber, group);
    }
    const matches: VintageGmCatalogMatch[] = [];
    for (const [partNumber, records] of grouped) {
      const catalog = this.gmCatalog.get(partNumber);
      if (!catalog) continue;
      const numericMinRecord = (field: 'sourcePrice' | 'sourceWeight') =>
        [...records].sort((left, right) => Number(left[field]) - Number(right[field]))[0]?.[field] ?? '0';
      const numericMaxRecord = (field: 'sourcePrice' | 'sourceWeight') =>
        [...records].sort((left, right) => Number(right[field]) - Number(left[field]))[0]?.[field] ?? '0';
      const first = [...records].sort((left, right) => left.sourceRow - right.sourceRow)[0]!;
      matches.push({
        inventory: {
          partNumber,
          productName: first.productName,
          sku: first.sku,
          brands: [...new Set(records.map((record) => record.brand))].sort(),
          descriptions: [...new Set(records.map((record) => record.description).filter(Boolean))],
          quantity: records.reduce((total, record) => total + record.quantity, 0),
          sourcePriceMin: numericMinRecord('sourcePrice'),
          sourcePriceMax: numericMaxRecord('sourcePrice'),
          sourceWeightMin: numericMinRecord('sourceWeight'),
          sourceWeightMax: numericMaxRecord('sourceWeight'),
          sourceRows: records.map((record) => record.sourceRow).sort((left, right) => left - right),
          recordCount: records.length
        },
        catalog: clone(catalog)
      });
    }
    const evidenceRank = (match: VintageGmCatalogMatch) => {
      if (match.catalog.identityEvidence?.method === 'gmpartswiki_exact_part_link') return 0;
      if (match.catalog.verificationState === 'catalog_stated') return 1;
      return 2;
    };
    matches.sort((left, right) => evidenceRank(left) - evidenceRank(right)
      || left.inventory.quantity - right.inventory.quantity
      || right.catalog.rollup.pageCount - left.catalog.rollup.pageCount
      || left.inventory.partNumber.localeCompare(right.inventory.partNumber));
    return { dataset: clone(dataset), matches: matches.slice(0, Math.max(1, limit)) };
  }

  async queryVintageGmInventory(intent: VintageGmInventoryQuestionIntent): Promise<VintageGmInventoryQuestionPool> {
    const dataset = [...this.vintageGmDatasets.values()]
      .filter((candidate) => candidate.active && candidate.status === 'completed')
      .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
    if (!dataset) return { dataset: await this.getVintageGmStatus(), matches: [], truncated: false };

    const catalogModels = [...this.gmCatalog.values()].flatMap((catalog) =>
      (catalog.applications ?? []).flatMap((application) =>
        (application.models ?? []).map((model) => model.modelName)
      )
    );
    const resolvedIntent = resolveVintageGmIntentFromCatalogModels(intent, catalogModels);

    const grouped = new Map<string, VintageGmInventoryRecord[]>();
    for (const entry of this.vintageGmInventory.values()) {
      const record = entry.record;
      if (entry.datasetId !== dataset.datasetId || !record.partNumber || record.quantity <= 0) continue;
      const records = grouped.get(record.partNumber) ?? [];
      records.push(record);
      grouped.set(record.partNumber, records);
    }

    const matches: VintageGmInventoryQuestionMatch[] = [];
    for (const [partNumber, records] of grouped) {
      const catalog = this.gmCatalog.get(partNumber);
      if (!catalog) continue;
      const matchedApplications = (catalog.applications ?? []).filter((application) => matchesVintageVehicleApplication(application, resolvedIntent));
      if ((resolvedIntent.year || resolvedIntent.make || resolvedIntent.model) && matchedApplications.length === 0) continue;
      const numericMinRecord = (field: 'sourcePrice' | 'sourceWeight') =>
        [...records].sort((left, right) => Number(left[field]) - Number(right[field]))[0]?.[field] ?? '0';
      const numericMaxRecord = (field: 'sourcePrice' | 'sourceWeight') =>
        [...records].sort((left, right) => Number(right[field]) - Number(left[field]))[0]?.[field] ?? '0';
      const first = [...records].sort((left, right) => left.sourceRow - right.sourceRow)[0]!;
      const candidate: VintageGmInventoryQuestionMatch = {
        inventory: {
          partNumber,
          productName: first.productName,
          sku: first.sku,
          brands: [...new Set(records.map((record) => record.brand))].sort(),
          descriptions: [...new Set(records.map((record) => record.description).filter(Boolean))],
          quantity: records.reduce((total, record) => total + record.quantity, 0),
          sourcePriceMin: numericMinRecord('sourcePrice'),
          sourcePriceMax: numericMaxRecord('sourcePrice'),
          sourceWeightMin: numericMinRecord('sourceWeight'),
          sourceWeightMax: numericMaxRecord('sourceWeight'),
          sourceRows: records.map((record) => record.sourceRow).sort((left, right) => left - right),
          recordCount: records.length
        },
        sourceInventoryValue: records.reduce((total, record) => total + (record.quantity * Number(record.sourcePrice)), 0).toFixed(4),
        catalog: clone(catalog),
        matchedApplications: clone(matchedApplications)
      };
      if (!matchesVintagePartQuery(candidate.catalog, candidate.inventory, resolvedIntent)) continue;
      matches.push(candidate);
    }
    matches.sort((left, right) => left.inventory.partNumber.localeCompare(right.inventory.partNumber, undefined, { numeric: true }));
    const cap = MAX_VINTAGE_INVENTORY_ANSWER_ROWS + 1;
    return {
      dataset: clone(dataset),
      matches: matches.slice(0, cap),
      truncated: matches.length > MAX_VINTAGE_INVENTORY_ANSWER_ROWS,
      resolvedIntent
    };
  }

  async createItem(item: ItemRecord): Promise<void> {
    if (this.items.has(item.id)) throw new Error('item already exists');
    if ([...this.items.values()].some((row) => row.sellerId === item.sellerId && row.sku === item.sku)) {
      throw new Error('seller SKU already exists');
    }
    this.items.set(item.id, clone(item));
  }

  async getItem(itemId: string): Promise<ItemRecord | undefined> {
    const item = this.items.get(itemId);
    return item ? clone(item) : undefined;
  }

  async saveItem(item: ItemRecord): Promise<void> {
    this.items.set(item.id, clone(item));
  }

  async listItems(sellerId: string): Promise<ItemRecord[]> {
    return [...this.items.values()].filter((item) => item.sellerId === sellerId).map(clone);
  }

  async addEvidence(record: EvidenceRecord): Promise<void> {
    this.evidence.push(clone(record));
  }

  async listEvidence(itemId: string): Promise<EvidenceRecord[]> {
    return this.evidence.filter((row) => row.itemId === itemId).map(clone);
  }

  async addApproval(record: ApprovalRecord): Promise<void> {
    this.approvals.push(clone(record));
  }

  async listApprovals(itemId: string): Promise<ApprovalRecord[]> {
    return this.approvals.filter((row) => row.itemId === itemId).map(clone);
  }

  async saveListing(record: ListingRecord): Promise<void> {
    this.listings.set(record.itemId, clone(record));
  }

  async getListing(itemId: string): Promise<ListingRecord | undefined> {
    const listing = this.listings.get(itemId);
    return listing ? clone(listing) : undefined;
  }

  async saveConnection(connection: SellerConnection): Promise<void> {
    this.connections.set(connection.sellerId, clone(connection));
  }

  async getConnection(sellerId: string): Promise<SellerConnection | undefined> {
    const connection = this.connections.get(sellerId);
    return connection ? clone(connection) : undefined;
  }

  async saveImage(image: StoredImage): Promise<void> {
    this.images.set(image.id, clone(image));
  }

  async getImage(imageId: string): Promise<StoredImage | undefined> {
    const image = this.images.get(imageId);
    return image ? clone(image) : undefined;
  }

  async listImages(itemId: string): Promise<StoredImage[]> {
    return [...this.images.values()].filter((image) => image.itemId === itemId).map(clone);
  }

  async addAudit(event: AuditEvent): Promise<void> {
    this.audits.push(clone(event));
  }

  async listAudit(itemId?: string): Promise<AuditEvent[]> {
    return this.audits.filter((event) => itemId === undefined || event.itemId === itemId).map(clone);
  }

  async getSuccessfulPublishCount(sellerId: string): Promise<number> {
    return [...this.publishSlots.values()].filter((slot) => slot.sellerId === sellerId && slot.status === 'SUCCEEDED').length;
  }

  async reserveFreePublish(sellerId: string, itemId: string, limit: number): Promise<boolean> {
    const existing = this.publishSlots.get(itemId);
    if (existing) return existing.sellerId === sellerId;
    const claimed = [...this.publishSlots.values()].filter((slot) => slot.sellerId === sellerId).length;
    if (claimed >= limit) return false;
    this.publishSlots.set(itemId, { sellerId, status: 'RESERVED' });
    return true;
  }

  async finalizeFreePublish(itemId: string): Promise<void> {
    const slot = this.publishSlots.get(itemId);
    if (!slot) throw new Error('publish slot not reserved');
    this.publishSlots.set(itemId, { ...slot, status: 'SUCCEEDED' });
  }

  async releaseFreePublish(itemId: string): Promise<void> {
    const slot = this.publishSlots.get(itemId);
    if (slot?.status === 'RESERVED') this.publishSlots.delete(itemId);
  }

  async saveOAuthNonce(nonce: string, sellerId: string, expiresAt: string): Promise<void> {
    this.oauthNonces.set(nonce, { sellerId, expiresAt });
  }

  async consumeOAuthNonce(nonce: string, sellerId: string, at: string): Promise<boolean> {
    const record = this.oauthNonces.get(nonce);
    if (!record || record.sellerId !== sellerId || record.consumedAt || Date.parse(record.expiresAt) < Date.parse(at)) return false;
    this.oauthNonces.set(nonce, { ...record, consumedAt: at });
    return true;
  }

  async saveAcknowledgement(record: SellerAcknowledgement): Promise<void> {
    this.acknowledgements.set(`${record.sellerId}:${record.type}`, clone(record));
  }

  async getAcknowledgement(
    sellerId: string,
    type: SellerAcknowledgement['type']
  ): Promise<SellerAcknowledgement | undefined> {
    const record = this.acknowledgements.get(`${sellerId}:${type}`);
    return record ? clone(record) : undefined;
  }
}

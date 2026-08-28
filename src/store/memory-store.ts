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
import type { Store } from './store.js';
import type { GmCatalogImportOptions, GmCatalogPart, GmCatalogStatus } from '../catalog/gm-catalog.js';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import { mergeGmCatalogParts } from '../catalog/gm-catalog-merge.js';
import type { EbayReferenceCacheRecord } from '../ebay/reference-types.js';
import type { CommunitySubmissionRecord, StoredCommunityImage } from '../community/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
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
  private readonly ebayReferenceCache = new Map<string, EbayReferenceCacheRecord>();
  private readonly communitySubmissions = new Map<string, CommunitySubmissionRecord>();
  private readonly communityImages = new Map<string, StoredCommunityImage>();
  private gmCatalogComplete = false;
  private gmCatalogDatasetId: string | null = null;

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

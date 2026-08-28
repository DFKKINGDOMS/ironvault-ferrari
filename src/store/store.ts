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
import type { GmCatalogImportOptions, GmCatalogPart, GmCatalogStatus } from '../catalog/gm-catalog.js';
import type { EbayReferenceCacheRecord } from '../ebay/reference-types.js';
import type { CommunitySubmissionRecord, StoredCommunityImage } from '../community/types.js';

export interface EbayLeafCategory {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
}

export interface Store {
  ping?(): Promise<void>;
  close?(): Promise<void>;
  createItem(item: ItemRecord): Promise<void>;
  getItem(itemId: string): Promise<ItemRecord | undefined>;
  saveItem(item: ItemRecord): Promise<void>;
  listItems(sellerId: string): Promise<ItemRecord[]>;
  addEvidence(record: EvidenceRecord): Promise<void>;
  listEvidence(itemId: string): Promise<EvidenceRecord[]>;
  addApproval(record: ApprovalRecord): Promise<void>;
  listApprovals(itemId: string): Promise<ApprovalRecord[]>;
  saveListing(record: ListingRecord): Promise<void>;
  getListing(itemId: string): Promise<ListingRecord | undefined>;
  saveConnection(connection: SellerConnection): Promise<void>;
  getConnection(sellerId: string): Promise<SellerConnection | undefined>;
  saveImage(image: StoredImage): Promise<void>;
  getImage(imageId: string): Promise<StoredImage | undefined>;
  listImages(itemId: string): Promise<StoredImage[]>;
  addAudit(event: AuditEvent): Promise<void>;
  listAudit(itemId?: string): Promise<AuditEvent[]>;
  getSuccessfulPublishCount(sellerId: string): Promise<number>;
  reserveFreePublish(sellerId: string, itemId: string, limit: number): Promise<boolean>;
  finalizeFreePublish(itemId: string): Promise<void>;
  releaseFreePublish(itemId: string): Promise<void>;
  saveOAuthNonce(nonce: string, sellerId: string, expiresAt: string): Promise<void>;
  consumeOAuthNonce(nonce: string, sellerId: string, at: string): Promise<boolean>;
  saveAcknowledgement(record: SellerAcknowledgement): Promise<void>;
  getAcknowledgement(sellerId: string, type: SellerAcknowledgement['type']): Promise<SellerAcknowledgement | undefined>;
  lookupGmCatalogPart?(partNumber: string): Promise<GmCatalogPart | undefined>;
  getGmCatalogStatus?(): Promise<GmCatalogStatus>;
  importGmCatalogRecords?(records: GmCatalogPart[], options?: GmCatalogImportOptions): Promise<void>;
  getEbayReferenceCache(partNumber: string): Promise<EbayReferenceCacheRecord | undefined>;
  saveEbayReferenceCache(record: EbayReferenceCacheRecord): Promise<void>;
  deleteEbayReferenceCache(partNumber: string): Promise<void>;
  purgeExpiredEbayReferenceCache(at: string): Promise<number>;
  saveCommunitySubmission(record: CommunitySubmissionRecord): Promise<void>;
  getCommunitySubmission(id: string): Promise<CommunitySubmissionRecord | undefined>;
  listCommunitySubmissionsForReview(limit: number): Promise<CommunitySubmissionRecord[]>;
  saveCommunityImage(record: StoredCommunityImage): Promise<void>;
  getCommunityImage(id: string): Promise<StoredCommunityImage | undefined>;
  listCommunityImages(submissionId: string): Promise<StoredCommunityImage[]>;
  listCommunityImagesByPartNumber(partNumber: string): Promise<StoredCommunityImage[]>;
  listPublishedCommunityImages(partNumber: string): Promise<StoredCommunityImage[]>;
  getPublishedCommunityAsset(filename: string): Promise<StoredCommunityImage | undefined>;
  listEbayLeafCategories?(query?: string, limit?: number): Promise<EbayLeafCategory[]>;
}

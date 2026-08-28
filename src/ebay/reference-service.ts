import type { AppConfig } from '../config.js';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import type { Store } from '../store/store.js';
import type { EbayReferenceProvider } from './reference-discovery.js';
import type {
  EbayReferenceCacheRecord,
  EbayReferenceLookup
} from './reference-types.js';
import { acceptedReferenceImage } from './reference-image-policy.js';

export class EbayReferenceService {
  private readonly inFlight = new Map<string, Promise<EbayReferenceLookup>>();

  constructor(
    private readonly store: Store,
    private readonly provider: EbayReferenceProvider | undefined,
    private readonly config: AppConfig,
    private readonly clock: () => Date = () => new Date(),
    private readonly curatedProvider?: EbayReferenceProvider
  ) {}

  async purgeExpired(): Promise<number> {
    return this.store.purgeExpiredEbayReferenceCache(this.clock().toISOString());
  }

  async lookup(partNumber: string, catalog: GmCatalogPart | undefined): Promise<EbayReferenceLookup> {
    const exactPart = canonicalOemPartNumber(partNumber);
    if (!catalog || !exactPart || canonicalOemPartNumber(catalog.partNumber) !== exactPart) {
      return { status: 'NOT_CATALOG_VERIFIED', reference: null, searchSuppressed: true };
    }
    const running = this.inFlight.get(exactPart);
    if (running) return running;
    const work = this.lookupUnshared(exactPart, catalog).finally(() => this.inFlight.delete(exactPart));
    this.inFlight.set(exactPart, work);
    return work;
  }

  private async lookupUnshared(partNumber: string, catalog: GmCatalogPart): Promise<EbayReferenceLookup> {
    const at = this.clock();
    const cached = await this.store.getEbayReferenceCache(partNumber);
    if (cached?.status === 'RIGHTS_CLEARED_ARCHIVE' || cached?.status === 'PRIVATE_REFERENCE_ARCHIVE') {
      return { status: cached.status, reference: cached, searchSuppressed: true };
    }

    const curatedCandidate = await this.curatedProvider?.searchExact(partNumber, catalog);
    if (curatedCandidate) {
      return this.saveMatchedReference(partNumber, curatedCandidate, at);
    }

    if (
      cached?.status === 'MATCHED_LIVE_REFERENCE'
      && cached.expiresAt
      && Date.parse(cached.expiresAt) > at.getTime()
      && cached.images.length > 0
      && cached.images.every(acceptedReferenceImage)
    ) {
      return { status: cached.status, reference: cached, searchSuppressed: true };
    }
    if (cached?.status === 'NO_EXACT_MATCH' && cached.retryAfter && Date.parse(cached.retryAfter) > at.getTime()) {
      return { status: cached.status, reference: cached, searchSuppressed: true };
    }
    if (cached) await this.store.deleteEbayReferenceCache(partNumber);

    if (this.config.EBAY_REFERENCE_DISCOVERY_MODE !== 'live' || !this.provider) {
      return { status: 'DISCOVERY_DISABLED', reference: null, searchSuppressed: true };
    }

    try {
      const candidate = await this.provider.searchExact(partNumber, catalog);
      if (!candidate) {
        const retryAfter = new Date(at.getTime() + this.config.EBAY_REFERENCE_NEGATIVE_CACHE_HOURS * 3_600_000).toISOString();
        const record: EbayReferenceCacheRecord = {
          partNumber,
          status: 'NO_EXACT_MATCH',
          source: 'EBAY_BROWSE_API',
          rightsState: 'EBAY_PUBLIC_REFERENCE_ONLY',
          sourceItemId: null,
          sourceUrl: null,
          title: null,
          categoryId: null,
          categoryPath: null,
          images: [],
          matchEvidence: ['No exact catalog-consistent eBay Motors match'],
          checkedAt: at.toISOString(),
          expiresAt: null,
          retryAfter,
          archiveAllowed: false,
          listingPayloadEligible: false
        };
        await this.store.saveEbayReferenceCache(record);
        return { status: record.status, reference: record, searchSuppressed: false };
      }

      return this.saveMatchedReference(partNumber, candidate, at);
    } catch {
      return { status: 'TEMPORARILY_UNAVAILABLE', reference: null, searchSuppressed: false };
    }
  }

  private async saveMatchedReference(
    partNumber: string,
    candidate: Awaited<ReturnType<EbayReferenceProvider['searchExact']>> & {},
    at: Date
  ): Promise<EbayReferenceLookup> {
    const approvedImages = candidate.images
      .filter(acceptedReferenceImage)
      .slice(0, this.config.EBAY_REFERENCE_MAX_IMAGES);
    if (!approvedImages.length) {
      return { status: 'TEMPORARILY_UNAVAILABLE', reference: null, searchSuppressed: false };
    }
    const cacheHours = Math.min(6, this.config.EBAY_REFERENCE_CACHE_HOURS);
    const privateArchive = candidate.archiveState === 'PRIVATE_PERSONAL_REFERENCE_ONLY';
    const expiresAt = privateArchive ? null : new Date(at.getTime() + cacheHours * 3_600_000).toISOString();
    const record: EbayReferenceCacheRecord = {
      partNumber,
      status: privateArchive ? 'PRIVATE_REFERENCE_ARCHIVE' : 'MATCHED_LIVE_REFERENCE',
      source: privateArchive ? 'PARTQUILL_PRIVATE_ARCHIVE' : 'EBAY_BROWSE_API',
      rightsState: privateArchive ? 'PRIVATE_PERSONAL_REFERENCE_ONLY' : 'EBAY_PUBLIC_REFERENCE_ONLY',
      sourceItemId: candidate.sourceItemId,
      sourceUrl: candidate.sourceUrl,
      title: candidate.title,
      categoryId: candidate.categoryId,
      categoryPath: candidate.categoryPath,
      images: approvedImages,
      matchEvidence: candidate.matchEvidence,
      checkedAt: at.toISOString(),
      expiresAt,
      retryAfter: null,
      archiveAllowed: privateArchive,
      listingPayloadEligible: false
    };
    await this.store.saveEbayReferenceCache(record);
    return { status: record.status, reference: record, searchSuppressed: false };
  }
}

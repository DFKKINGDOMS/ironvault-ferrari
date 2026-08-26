import type { ListingPayload } from '../domain/types.js';

export interface CatalogResolution {
  outcome: 'UNIQUE_MATCH' | 'AMBIGUOUS' | 'NO_MATCH';
  epid?: string;
  title?: string;
  compatibility?: Array<Record<string, string>>;
  raw: unknown;
}

export interface FeeEstimate {
  id: string;
  amount?: string;
  currency?: string;
  source: 'MOCK' | 'EBAY_RESPONSE' | 'UNAVAILABLE';
  expiresAt: string;
}

export interface PublishResult {
  offerId: string;
  listingId: string;
  remoteSnapshot: unknown;
}

export interface EbayGateway {
  readonly mode: 'mock' | 'live';
  resolveCatalog(payload: ListingPayload): Promise<CatalogResolution>;
  stageOffer(payload: ListingPayload, accessToken: string): Promise<{ offerId: string; remoteSnapshot: unknown }>;
  estimateFees(payload: ListingPayload, accessToken: string): Promise<FeeEstimate>;
  publish(offerId: string, accessToken: string): Promise<PublishResult>;
  revise(
    offerId: string,
    changes: { price?: string; quantity?: number },
    accessToken: string
  ): Promise<{ remoteSnapshot: unknown }>;
  withdraw(offerId: string, accessToken: string): Promise<{ remoteSnapshot: unknown }>;
  getOffer(offerId: string, accessToken: string): Promise<unknown>;
}

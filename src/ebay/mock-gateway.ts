import { newId, now } from '../domain/canonical.js';
import type { ListingPayload } from '../domain/types.js';
import type { CatalogResolution, EbayGateway, FeeEstimate, PublishResult } from './types.js';

export class MockEbayGateway implements EbayGateway {
  readonly mode = 'mock' as const;
  private readonly offers = new Map<string, { payload?: ListingPayload; listingId?: string; withdrawn?: boolean }>();

  async resolveCatalog(payload: ListingPayload): Promise<CatalogResolution> {
    if (payload.gtin || (payload.brand && payload.mpn)) {
      return {
        outcome: 'NO_MATCH',
        raw: {
          fixture: true,
          scenario: 'MECHANICS_ONLY',
          candidateIdentifier: payload.gtin ?? `${payload.brand}:${payload.mpn}`,
          warning: 'Mock mode never creates an ePID or eBay Catalog Match evidence.'
        }
      };
    }
    return { outcome: 'NO_MATCH', raw: { fixture: true } };
  }

  async stageOffer(payload: ListingPayload, _accessToken: string): Promise<{ offerId: string; remoteSnapshot: unknown }> {
    const offerId = `mock-offer-${newId()}`;
    this.offers.set(offerId, { payload: structuredClone(payload) });
    return { offerId, remoteSnapshot: { offerId, payload, stagedAt: now(), environment: 'mock' } };
  }

  async estimateFees(_payload: ListingPayload, _accessToken: string): Promise<FeeEstimate> {
    return {
      id: `mock-fee-${newId()}`,
      source: 'MOCK',
      amount: '0.00',
      currency: 'USD',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
    };
  }

  async publish(offerId: string, _accessToken: string): Promise<PublishResult> {
    const offer = this.offers.get(offerId);
    if (!offer) throw new Error('mock offer not found');
    const listingId = `mock-listing-${newId()}`;
    offer.listingId = listingId;
    return { offerId, listingId, remoteSnapshot: { ...offer, publishedAt: now(), environment: 'mock' } };
  }

  async revise(
    offerId: string,
    changes: { price?: string; quantity?: number },
    _accessToken: string
  ): Promise<{ remoteSnapshot: unknown }> {
    const offer = this.offers.get(offerId);
    if (!offer?.payload) throw new Error('mock offer not found');
    if (changes.price) offer.payload.price.value = changes.price;
    if (changes.quantity !== undefined) offer.payload.quantity = changes.quantity;
    return { remoteSnapshot: { ...offer, revisedAt: now(), environment: 'mock' } };
  }

  async withdraw(offerId: string, _accessToken: string): Promise<{ remoteSnapshot: unknown }> {
    const offer = this.offers.get(offerId);
    if (!offer) throw new Error('mock offer not found');
    offer.withdrawn = true;
    return { remoteSnapshot: { ...offer, withdrawnAt: now(), environment: 'mock' } };
  }

  async getOffer(offerId: string, _accessToken: string): Promise<unknown> {
    const offer = this.offers.get(offerId);
    if (!offer) throw new Error('mock offer not found');
    return structuredClone(offer);
  }
}

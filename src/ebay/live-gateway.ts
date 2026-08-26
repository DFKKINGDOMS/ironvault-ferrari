import { newId } from '../domain/canonical.js';
import type { ListingPayload } from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { CatalogResolution, EbayGateway, FeeEstimate, PublishResult } from './types.js';

function inventoryBase(environment: 'sandbox' | 'production'): string {
  return environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

export class LiveEbayGateway implements EbayGateway {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = inventoryBase(config.EBAY_ENV);
  }

  private async request(path: string, accessToken: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
        ...(init.headers ?? {})
      }
    });
    const body = await response.text();
    const parsed: unknown = body ? JSON.parse(body) : {};
    if (!response.ok) throw new Error(`eBay ${response.status}: ${body.slice(0, 2_000)}`);
    return parsed;
  }

  async resolveCatalog(_payload: ListingPayload): Promise<CatalogResolution> {
    return {
      outcome: 'NO_MATCH',
      raw: {
        reason: 'Live catalog resolution is intentionally feature-flagged until production catalog probes are approved.'
      }
    };
  }

  async stageOffer(_payload: ListingPayload, _accessToken: string): Promise<{ offerId: string; remoteSnapshot: unknown }> {
    throw new Error('Live staging requires seller policy/location mapping and is not enabled in this pilot checkpoint.');
  }

  async estimateFees(_payload: ListingPayload, _accessToken: string): Promise<FeeEstimate> {
    return {
      id: `unavailable-${newId()}`,
      source: 'UNAVAILABLE',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    };
  }

  async publish(offerId: string, accessToken: string): Promise<PublishResult> {
    const result = (await this.request(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, accessToken, {
      method: 'POST'
    })) as { listingId?: string };
    if (!result.listingId) throw new Error('eBay publish response did not include listingId');
    return { offerId, listingId: result.listingId, remoteSnapshot: result };
  }

  async revise(
    _offerId: string,
    _changes: { price?: string; quantity?: number },
    _accessToken: string
  ): Promise<{ remoteSnapshot: unknown }> {
    throw new Error('Live revise is disabled until the end-to-end inventory item and offer mapping passes Sandbox acceptance.');
  }

  async withdraw(offerId: string, accessToken: string): Promise<{ remoteSnapshot: unknown }> {
    const result = await this.request(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, accessToken, {
      method: 'POST'
    });
    return { remoteSnapshot: result };
  }

  async getOffer(offerId: string, accessToken: string): Promise<unknown> {
    return this.request(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, accessToken);
  }
}

import type { AppConfig } from '../config.js';
import type { EbayCategorySuggestion } from '../catalog/listing-intelligence.js';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface CategorySuggestionResponse {
  categorySuggestions?: Array<{
    category?: { categoryId?: string; categoryName?: string };
    categoryTreeNodeAncestors?: Array<{ category?: { categoryName?: string } }>;
  }>;
}

export class EbayTaxonomyClient {
  private token: { value: string; expiresAt: number } | undefined;
  private treeId: string | undefined;

  constructor(private readonly config: AppConfig) {}

  private get baseUrl(): string {
    return this.config.EBAY_ENV === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
  }

  private async applicationToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.config.EBAY_CLIENT_ID || !this.config.EBAY_CLIENT_SECRET) {
      throw new Error('eBay application credentials are not configured');
    }
    const credentials = Buffer.from(`${this.config.EBAY_CLIENT_ID}:${this.config.EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope'
      }),
      signal: AbortSignal.timeout(8_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay application token failed (${response.status})`);
    const parsed = JSON.parse(body) as TokenResponse;
    if (!parsed.access_token) throw new Error('eBay application token response was incomplete');
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + Math.max(300, parsed.expires_in ?? 7_200) * 1_000
    };
    return parsed.access_token;
  }

  private async request(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${await this.applicationToken()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay Taxonomy API failed (${response.status})`);
    return body ? JSON.parse(body) : {};
  }

  private async categoryTreeId(): Promise<string> {
    if (this.treeId) return this.treeId;
    const result = await this.request('/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US') as {
      categoryTreeId?: string;
    };
    if (!result.categoryTreeId) throw new Error('eBay category tree response was incomplete');
    this.treeId = result.categoryTreeId;
    return result.categoryTreeId;
  }

  async suggestCategory(query: string): Promise<EbayCategorySuggestion | undefined> {
    const treeId = await this.categoryTreeId();
    const result = await this.request(
      `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(query)}`
    ) as CategorySuggestionResponse;
    const suggestion = result.categorySuggestions?.[0];
    const categoryId = suggestion?.category?.categoryId;
    const categoryName = suggestion?.category?.categoryName;
    if (!categoryId || !categoryName) return undefined;
    const ancestors = suggestion.categoryTreeNodeAncestors
      ?.map((ancestor) => ancestor.category?.categoryName)
      .filter((name): name is string => Boolean(name))
      .reverse() ?? [];
    return {
      categoryId,
      categoryName,
      categoryPath: [...ancestors, categoryName].join(' › ')
    };
  }
}

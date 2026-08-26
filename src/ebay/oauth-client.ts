import type { AppConfig } from '../config.js';

export const REQUIRED_EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account'
] as const;

export interface EbayTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn?: number;
  tokenType: string;
}

function identityBase(environment: 'sandbox' | 'production'): string {
  return environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

function consentBase(environment: 'sandbox' | 'production'): string {
  return environment === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
}

export class EbayOAuthClient {
  constructor(private readonly config: AppConfig) {}

  authorizationUrl(state: string): string {
    if (!this.config.EBAY_CLIENT_ID || !this.config.EBAY_RU_NAME) throw new Error('eBay OAuth is not configured');
    const params = new URLSearchParams({
      client_id: this.config.EBAY_CLIENT_ID,
      redirect_uri: this.config.EBAY_RU_NAME,
      response_type: 'code',
      scope: REQUIRED_EBAY_SCOPES.join(' '),
      state,
      prompt: 'login'
    });
    return `${consentBase(this.config.EBAY_ENV)}/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<EbayTokens> {
    if (!this.config.EBAY_CLIENT_ID || !this.config.EBAY_CLIENT_SECRET || !this.config.EBAY_RU_NAME) {
      throw new Error('eBay OAuth is not configured');
    }
    const credentials = Buffer.from(`${this.config.EBAY_CLIENT_ID}:${this.config.EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${identityBase(this.config.EBAY_ENV)}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.EBAY_RU_NAME
      })
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`eBay OAuth ${response.status}: ${JSON.stringify(body).slice(0, 2_000)}`);
    return {
      accessToken: String(body.access_token),
      expiresIn: Number(body.expires_in),
      refreshToken: String(body.refresh_token),
      refreshTokenExpiresIn: body.refresh_token_expires_in ? Number(body.refresh_token_expires_in) : undefined,
      tokenType: String(body.token_type)
    };
  }

  async refresh(refreshToken: string, scopes: readonly string[] = REQUIRED_EBAY_SCOPES): Promise<Omit<EbayTokens, 'refreshToken'>> {
    if (!this.config.EBAY_CLIENT_ID || !this.config.EBAY_CLIENT_SECRET) throw new Error('eBay OAuth is not configured');
    const credentials = Buffer.from(`${this.config.EBAY_CLIENT_ID}:${this.config.EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${identityBase(this.config.EBAY_ENV)}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: scopes.join(' ')
      })
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`eBay token refresh ${response.status}: ${JSON.stringify(body).slice(0, 2_000)}`);
    return {
      accessToken: String(body.access_token),
      expiresIn: Number(body.expires_in),
      refreshTokenExpiresIn: body.refresh_token_expires_in ? Number(body.refresh_token_expires_in) : undefined,
      tokenType: String(body.token_type)
    };
  }
}

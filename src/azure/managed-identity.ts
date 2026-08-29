const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function managedIdentityAccessToken(resource: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(resource);
  if (cached && cached.expiresAt - now > 5 * 60_000) return cached.token;

  const endpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  if (!endpoint || !identityHeader) {
    throw new Error('Azure Container Apps managed identity endpoint is unavailable');
  }

  const url = new URL(endpoint);
  url.searchParams.set('api-version', '2019-08-01');
  url.searchParams.set('resource', resource);
  const response = await fetch(url, {
    headers: {
      'X-IDENTITY-HEADER': identityHeader,
      Metadata: 'true'
    }
  });
  if (!response.ok) {
    throw new Error(`Azure managed identity token request failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    access_token?: string;
    expires_on?: string | number;
  };
  if (!payload.access_token) throw new Error('Azure managed identity did not return an access token');

  const parsedExpiry = Number(payload.expires_on);
  tokenCache.set(resource, {
    token: payload.access_token,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry * 1_000 : now + 45 * 60_000
  });
  return payload.access_token;
}

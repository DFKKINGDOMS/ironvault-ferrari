import { describe, it, expect } from 'vitest';
import { createGoogleResearch, googleResearchConfig, renderGoogleAnswer, validateGoogleInput, type GoogleResearchConfig } from '../src/research/google-search.js';

const config: GoogleResearchConfig = {
  project: 'catalogue-research-test', model: 'gemini-3.8-flash',
  audience: '//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/test-pool/providers/test-provider',
  serviceAccount: 'research@catalogue-research-test.iam.gserviceaccount.com',
  azureResource: 'api://00000000-0000-0000-0000-000000000001',
  identityEndpoint: 'http://localhost:8081/msi/token', identityHeader: 'fake-local-header'
};
const metadata = {
  webSearchQueries: ['example exact OEM'],
  groundingChunks: [{ web: { uri: 'https://example.com/catalogue', title: 'Example catalogue' } }],
  groundingSupports: [{ segment: { endIndex: Buffer.byteLength('Café part.') }, groundingChunkIndices: [0] }],
  searchEntryPoint: { renderedContent: '<div><a href="https://www.google.com/search?q=example">Search</a></div>' }
};
function fakeProvider(response: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    if (String(url).startsWith('http://localhost:8081/')) return Response.json({ access_token: 'fake-azure-token' });
    if (String(url) === 'https://sts.googleapis.com/v1/token') return Response.json({ access_token: 'fake-sts-token' });
    if (String(url).startsWith('https://iamcredentials.googleapis.com/')) return Response.json({ accessToken: 'fake-google-token', expireTime: new Date(Date.now() + 3600_000).toISOString() });
    return Response.json(response);
  };
  return { client: createGoogleResearch(config, fetcher), calls };
}
describe('Google web research boundaries', () => {
  it('exchanges the app identity, bills the configured project and returns cited Google results', async () => {
    const { client, calls } = fakeProvider({ modelVersion: config.model, candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: 'Café part.' }] }, groundingMetadata: metadata }] });
    const result = await client.research({ sku: 'AB-123', vendor: 'Example manufacturer' });
    expect(result.provider).toBe('google_search');
    expect(result.source_count).toBe(1);
    expect(result.citation_count).toBe(1);
    expect(result.answer_html).toContain('Café part.<sup>');
    expect(result.search_suggestions_html).toBe(metadata.searchEntryPoint.renderedContent);
    expect(calls).toHaveLength(4);
    const identity = new URL(calls[0]!.url);
    expect(identity.searchParams.get('resource')).toBe(config.azureResource);
    const exchange = calls[1]!.init!.body as URLSearchParams;
    expect(exchange.get('audience')).toBe(config.audience);
    expect(exchange.get('subject_token')).toBe('fake-azure-token');
    const generation = calls[3]!.init!;
    expect(new Headers(generation.headers).get('x-goog-user-project')).toBe(config.project);
    expect(JSON.parse(generation.body as string).tools).toEqual([{ googleSearch: {} }]);
    expect(JSON.stringify(result)).not.toContain('fake-google-token');
    await client.authenticate();
    expect(calls).toHaveLength(4);
  });
  it('rejects ungrounded output without calling another search engine', async () => {
    const { client, calls } = fakeProvider({ modelVersion: config.model, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Unverified claim' }] } }] });
    await expect(client.research({ sku: 'AB-123' })).rejects.toMatchObject({ code: 'google_search_no_sources' });
    expect(calls).toHaveLength(4);
    expect(calls.every(call => /localhost|googleapis\.com/.test(new URL(call.url).hostname))).toBe(true);
  });
  it('rejects truncated answers and unsafe source markup', async () => {
    const { client } = fakeProvider({ modelVersion: config.model, candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Truncated' }] }, groundingMetadata: metadata }] });
    await expect(client.research({ sku: 'AB-123' })).rejects.toMatchObject({ code: 'google_answer_incomplete' });
    expect(renderGoogleAnswer('<img onerror="bad">', metadata).answer_html).toContain('&lt;img');
    expect(() => renderGoogleAnswer('Result', { ...metadata, searchEntryPoint: { renderedContent: '<img src=x onerror=bad>' } })).toThrow('google_display_metadata_invalid');
  });
  it('does not send malformed input or full VINs to the public web', () => {
    expect(() => validateGoogleInput({ sku: '' })).toThrow('invalid_part_number');
    expect(() => validateGoogleInput({ sku: 'AB-123', question: 'Check 1HGCM82633A004352' })).toThrow('full_vin_not_accepted');
    expect(() => googleResearchConfig({ GOOGLE_CLOUD_PROJECT: config.project })).toThrow('google_server_configuration_missing');
    expect(() => googleResearchConfig({ GOOGLE_CLOUD_PROJECT: config.project, GOOGLE_SEARCH_MODEL: config.model,
      GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: config.audience, GOOGLE_SERVICE_ACCOUNT_EMAIL: config.serviceAccount,
      GOOGLE_AZURE_TOKEN_RESOURCE: config.azureResource, IDENTITY_ENDPOINT: 'https://example.com/token', IDENTITY_HEADER: 'fake' })).toThrow('managed_identity_endpoint_invalid');
  });
});

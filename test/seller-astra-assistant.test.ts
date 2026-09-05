import { describe, expect, it } from 'vitest';
import {
  AzureFoundrySellerAssistant,
  deterministicSellerAssistantAnswer,
  isExplicitListingRequest,
  type SellerAssistantEvidence
} from '../src/seller/astra-assistant.js';

const noPartEvidence: SellerAssistantEvidence = {
  partNumber: null,
  catalogState: 'NOT_REQUESTED',
  catalog: null,
  merchantMedia: null,
  inventory: null
};

describe('seller assistant routing', () => {
  it('requires an explicit listing action before building a draft', () => {
    expect(isExplicitListingRequest('WHAT CAN YOU DO?')).toBe(false);
    expect(isExplicitListingRequest('10110989 WHAT DOES THIS FIT?')).toBe(false);
    expect(isExplicitListingRequest('Tell me about part 10110989')).toBe(false);
    expect(isExplicitListingRequest('List what you can do')).toBe(false);
    expect(isExplicitListingRequest('List part 10110989 for $9.99')).toBe(true);
    expect(isExplicitListingRequest('Can you list part 10110989 for $9.99?')).toBe(true);
    expect(isExplicitListingRequest('Can you list 10110989 for $9.99?')).toBe(true);
    expect(isExplicitListingRequest('I want to sell a used dashboard for $49.99')).toBe(true);
    expect(isExplicitListingRequest('Create an eBay listing for this item')).toBe(true);
  });

  it('returns a safe read-only answer when Astra is unavailable', () => {
    const result = deterministicSellerAssistantAnswer('What can you do?', noPartEvidence, true);
    expect(result).toMatchObject({
      status: 'AI_UNAVAILABLE',
      provider: 'DETERMINISTIC_FALLBACK',
      listingDraftCreated: false,
      allowanceConsumed: false,
      publicEbayWrite: 'DISABLED'
    });
    expect(result.answer).toContain('Questions never create drafts');
  });

  it('calls the locked Azure GPT-6 Astra deployment and returns its bounded answer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          answer: 'I can answer inventory and exact-part questions without creating a listing.',
          evidenceLimited: false,
          suggestedCommands: ['What does part 10110989 fit?']
        })
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const assistant = new AzureFoundrySellerAssistant(
      'azure-secret',
      'https://partquill-test.openai.azure.com/openai/v1/',
      'gpt-6-astra-1',
      fetcher
    );

    const result = await assistant.answer('What can you do?', noPartEvidence);

    expect(result).toMatchObject({
      status: 'ANSWERED',
      provider: 'AZURE_FOUNDRY_ASTRA',
      model: 'gpt-6-astra-1',
      listingDraftCreated: false,
      allowanceConsumed: false,
      publicEbayWrite: 'DISABLED'
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://partquill-test.openai.azure.com/openai/v1/responses');
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('api-key')).toBe('azure-secret');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-6-astra-1',
      reasoning: { effort: 'low' },
      max_output_tokens: 1_200
    });
    expect(String(body.instructions)).toContain('A question must never create a draft');
  });
});

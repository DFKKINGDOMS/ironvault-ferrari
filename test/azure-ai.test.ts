import { describe, expect, it } from 'vitest';
import { OpenAiCommunityModerator } from '../src/community/moderation.js';
import { OpenAiImageEngine } from '../src/image-studio/openai-engine.js';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Azure OpenAI-compatible routing', () => {
  it('uses the Azure v1 endpoint, api-key header and deployment names without OpenAI fallback', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/images/edits')) {
        return jsonResponse({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] });
      }
      return jsonResponse({
        output: [{ content: [{ text: JSON.stringify({
          pass: true,
          decision: 'ACCEPT_PART_ONLY',
          containsPerson: false,
          containsFace: false,
          containsHand: false,
          containsBodyPart: false,
          containsPromotionalGraphic: false,
          containsWatermarkOrOverlay: false,
          containsExplicitOrIllegalContent: false,
          unrelatedToAutomotiveOrMachineryPart: false,
          visiblePartNumberConflict: false,
          visiblePartNumber: null,
          reason: 'part-only image'
        }) }] }]
      });
    }) as typeof fetch;
    const options = {
      baseUrl: 'https://partquill-test.openai.azure.com/openai/v1/',
      authMode: 'api-key' as const,
      reviewModel: 'partquill-review',
      premiumImageModel: 'partquill-image',
      economyImageModel: 'partquill-image',
      supportsBackgroundControl: true
    };
    const engine = new OpenAiImageEngine('azure-secret', fetcher, options);

    const edited = await engine.edit({
      source: Buffer.from('source'),
      mediaType: 'image/png',
      filename: 'ABC123.png',
      background: 'PURE_WHITE',
      watermarkStatus: 'NONE',
      route: 'HERO_PREMIUM'
    });
    await engine.compare(Buffer.from('source'), 'image/png', edited);
    await new OpenAiCommunityModerator('azure-secret', fetcher, options).review({
      bytes: Buffer.from('source'),
      mediaType: 'image/png',
      partNumber: 'ABC123'
    });

    expect(calls.map((call) => call.url)).toEqual([
      'https://partquill-test.openai.azure.com/openai/v1/images/edits',
      'https://partquill-test.openai.azure.com/openai/v1/responses',
      'https://partquill-test.openai.azure.com/openai/v1/responses'
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get('api-key')).toBe('azure-secret');
      expect(headers.get('authorization')).toBeNull();
    }
    expect((calls[0]?.init?.body as FormData).get('model')).toBe('partquill-image');
    expect(JSON.parse(String(calls[1]?.init?.body)).model).toBe('partquill-review');
    expect(JSON.parse(String(calls[2]?.init?.body)).model).toBe('partquill-review');
  });
});

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { OpenAiCommunityModerator } from '../src/community/moderation.js';
import { OpenAiImageEngine } from '../src/image-studio/openai-engine.js';
import { AstraMediaPolicy } from '../src/shopify-media/astra-policy.js';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Azure OpenAI-compatible routing', () => {
  it('uses the Azure v1 endpoint, api-key header and deployment names without OpenAI fallback', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const source = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 40, height: 20, channels: 3, background: '#222222' } }, left: 20, top: 20 }])
      .jpeg()
      .toBuffer();
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/images/edits')) {
        return jsonResponse({ data: [{ b64_json: source.toString('base64') }] });
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
      source,
      mediaType: 'image/jpeg',
      filename: 'ABC123.png',
      background: 'PURE_WHITE',
      watermarkStatus: 'NONE',
      route: 'HERO_PREMIUM'
    });
    await engine.compare(source, 'image/jpeg', edited);
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
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      reasoning: { effort: 'low' },
      max_output_tokens: 1_200
    });
    expect(JSON.parse(String(calls[2]?.init?.body)).model).toBe('partquill-review');
  });

  it('gives Astra a bounded low-reasoning budget and accepts the output_text form', async () => {
    const source = await sharp({ create: { width: 2_000, height: 1_500, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 900, height: 400, channels: 3, background: '#222222' } }, left: 550, top: 550 }])
      .withMetadata({ density: 300 })
      .png()
      .toBuffer();
    let requestBody: Record<string, unknown> = {};
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        output_text: JSON.stringify({ classification: 'PRODUCT_PHOTO', confidence: 0.99, reason: 'physical part on white' })
      });
    }) as typeof fetch;

    const result = await new AstraMediaPolicy('azure-secret', 'https://partquill-test.openai.azure.com/openai/v1', 'gpt-6-astra-1', fetcher)
      .classify(source, 'image/png', '10110989.png');

    expect(result.classification).toBe('PRODUCT_PHOTO');
    expect(requestBody).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: 1_200 });
    const input = requestBody.input as Array<{ content: Array<{ type: string; image_url?: string }> }>;
    const encoded = input[0]?.content.find((part) => part.type === 'input_image')?.image_url || '';
    const preview = Buffer.from(encoded.split(',', 2)[1] || '', 'base64');
    const metadata = await sharp(preview).metadata();
    expect(encoded.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(Math.max(metadata.width || 0, metadata.height || 0)).toBe(1_280);
    expect(metadata.exif).toBeUndefined();
  });
});

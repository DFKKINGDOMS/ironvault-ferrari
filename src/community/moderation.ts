import type { CommunityModerationEngine, CommunityModerationResult } from './types.js';

type JsonObject = Record<string, unknown>;

const REVIEW_PROMPT = `You are PartQuill's strict intake moderator for a community automotive and machinery part-image archive.
The contributor supplied an exact part number. Review the photograph only; do not infer fitment.

REJECT if the image contains any person, face, hand, arm, leg, skin/body part, sexual or graphic content, illegal goods, weapon-focused content, marketplace promotional graphic, logo-style marketplace banner, watermark, advertising overlay, unrelated scene, or is not a focused photograph of an automotive/machinery part, its pieces, its label, or its packaging. REJECT if a clearly readable physical label shows a different part number from the supplied number. A physical manufacturer logo or label attached to the product is allowed and must not be removed.

Return ONLY JSON:
{"decision":"ACCEPT_PART_ONLY","containsPerson":false,"containsFace":false,"containsHand":false,"containsBodyPart":false,"containsPromotionalGraphic":false,"containsWatermarkOrOverlay":false,"containsExplicitOrIllegalContent":false,"unrelatedToAutomotiveOrMachineryPart":false,"visiblePartNumberConflict":false,"visiblePartNumber":null,"reason":"short explanation"}`;

function dataUrl(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function textFromResponse(payload: JsonObject): string {
  for (const row of Array.isArray(payload.output) ? payload.output : []) {
    if (!row || typeof row !== 'object') continue;
    for (const part of Array.isArray((row as JsonObject).content) ? (row as JsonObject).content as unknown[] : []) {
      if (part && typeof part === 'object' && typeof (part as JsonObject).text === 'string') return (part as JsonObject).text as string;
    }
  }
  return '';
}

function parseJson(value: string): JsonObject {
  try { return JSON.parse(value.trim()) as JsonObject; } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('moderation returned no JSON');
    return JSON.parse(match[0]) as JsonObject;
  }
}

export class OpenAiCommunityModerator implements CommunityModerationEngine {
  readonly available: boolean;

  constructor(private readonly apiKey?: string, private readonly fetcher: typeof fetch = fetch) {
    this.available = Boolean(apiKey);
  }

  async review(input: { bytes: Uint8Array; mediaType: string; partNumber: string }): Promise<CommunityModerationResult> {
    if (!this.apiKey) return unavailableReview();
    const model = 'gpt-5.4-mini';
    const response = await this.fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_output_tokens: 420,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: `${REVIEW_PROMPT}\n\nSupplied exact part number: ${input.partNumber}` },
          { type: 'input_image', image_url: dataUrl(input.bytes, input.mediaType), detail: 'high' }
        ] }]
      })
    });
    const payload = await response.json().catch(() => ({})) as JsonObject;
    if (!response.ok) throw new Error(typeof (payload.error as JsonObject | undefined)?.message === 'string'
      ? (payload.error as JsonObject).message as string
      : `moderation failed with ${response.status}`);
    const parsed = parseJson(textFromResponse(payload));
    const flags = {
      containsPerson: parsed.containsPerson === true,
      containsFace: parsed.containsFace === true,
      containsHand: parsed.containsHand === true,
      containsBodyPart: parsed.containsBodyPart === true,
      containsPromotionalGraphic: parsed.containsPromotionalGraphic === true,
      containsWatermarkOrOverlay: parsed.containsWatermarkOrOverlay === true,
      containsExplicitOrIllegalContent: parsed.containsExplicitOrIllegalContent === true,
      unrelatedToAutomotiveOrMachineryPart: parsed.unrelatedToAutomotiveOrMachineryPart === true,
      visiblePartNumberConflict: parsed.visiblePartNumberConflict === true
    };
    const rejected = Object.values(flags).some(Boolean) || parsed.decision !== 'ACCEPT_PART_ONLY';
    return {
      decision: rejected ? 'REJECT' : 'ACCEPT_PART_ONLY',
      ...flags,
      visiblePartNumber: typeof parsed.visiblePartNumber === 'string' ? parsed.visiblePartNumber.slice(0, 80) : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : rejected ? 'Image failed intake policy.' : 'Part-only image accepted for human review.',
      model,
      checkedAt: new Date().toISOString()
    };
  }
}

export class DisabledCommunityModerator implements CommunityModerationEngine {
  readonly available = false;
  async review(): Promise<CommunityModerationResult> { return unavailableReview(); }
}

function unavailableReview(): CommunityModerationResult {
  return {
    decision: 'UNAVAILABLE',
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
    reason: 'Automated visual review is not activated.',
    model: 'disabled',
    checkedAt: new Date().toISOString()
  };
}

import type { EpcQaEngine, EpcQaResult } from './types.js';

type JsonObject = Record<string, unknown>;

const EPC_QA_PROMPT = `Compare the source EPC diagram with the clean-base and interactive outputs. Return JSON only with keys pass (boolean), reason (string), missing_component_or_line (boolean), crop_or_stretch_problem (boolean), callout_number_problem (boolean), nonwhite_background (boolean), residual_watermark_or_color_cast (boolean), orange_ring_problem (boolean). Pass only when every mechanical component, leader line, callout number, position, scale and sheet composition is preserved; the background is pure white; gray/green cast and watermark artifacts are gone; and the interactive output adds only one small thin bright-orange ring per supplied hotspot.`;

function dataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

function outputText(payload: JsonObject): string {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const row of output) {
    if (!row || typeof row !== 'object') continue;
    const content = Array.isArray((row as JsonObject).content) ? (row as JsonObject).content as unknown[] : [];
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as JsonObject).text === 'string') return (part as JsonObject).text as string;
    }
  }
  return '';
}

function parseDecision(text: string): JsonObject {
  try {
    return JSON.parse(text.trim()) as JsonObject;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Azure EPC QA returned no JSON decision');
    return JSON.parse(match[0]) as JsonObject;
  }
}

export class AzureEpcQaEngine implements EpcQaEngine {
  readonly available: boolean;

  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly model = 'gpt-5-mini',
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.available = Boolean(apiKey);
  }

  async compare(source: Uint8Array, cleanBase: Uint8Array, interactive: Uint8Array, calloutCount: number): Promise<EpcQaResult> {
    if (!this.apiKey) throw new Error('Azure EPC QA is not activated');
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 350,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: `${EPC_QA_PROMPT}\nExpected orange-ring/hotspot count: ${calloutCount}.` },
            { type: 'input_image', image_url: dataUrl(source), detail: 'high' },
            { type: 'input_image', image_url: dataUrl(cleanBase), detail: 'high' },
            { type: 'input_image', image_url: dataUrl(interactive), detail: 'high' }
          ]
        }]
      })
    });
    const payload = await response.json().catch(() => ({})) as JsonObject;
    if (!response.ok) {
      const error = payload.error as JsonObject | undefined;
      throw new Error(typeof error?.message === 'string' ? error.message : `Azure EPC QA failed with ${response.status}`);
    }
    const decision = parseDecision(outputText(payload));
    const failureFlags = [
      'missing_component_or_line',
      'crop_or_stretch_problem',
      'callout_number_problem',
      'nonwhite_background',
      'residual_watermark_or_color_cast',
      'orange_ring_problem'
    ];
    return {
      passed: decision.pass === true && !failureFlags.some((flag) => decision[flag] === true),
      reason: typeof decision.reason === 'string' ? decision.reason : 'Azure EPC source comparison completed',
      model: this.model
    };
  }
}

export class DisabledEpcQaEngine implements EpcQaEngine {
  readonly available = false;
  async compare(): Promise<EpcQaResult> {
    throw new Error('Azure EPC QA is not activated');
  }
}

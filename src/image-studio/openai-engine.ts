import { buildStudioPrompt, STUDIO_QA_PROMPT } from './prompt.js';
import { responseOutputText, reviewImageDataUrl } from './review-payload.js';
import type { EditRequest, EditResult, ImageEditEngine, QaResult, StudioRoute } from './types.js';

type JsonObject = Record<string, unknown>;

export interface AiEndpointOptions {
  baseUrl?: string;
  authMode?: 'bearer' | 'api-key';
  reviewModel?: string;
  premiumImageModel?: string;
  economyImageModel?: string;
  supportsBackgroundControl?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function routeSettings(route: StudioRoute, options: AiEndpointOptions): { model: string; quality: string } {
  if (route === 'SECONDARY_ECONOMY') return { model: options.economyImageModel ?? 'gpt-image-1-mini', quality: 'high' };
  return { model: options.premiumImageModel ?? 'gpt-image-2', quality: route === 'QA_ESCALATION' ? 'medium' : 'high' };
}

async function readJson(response: Response): Promise<JsonObject> {
  const payload = (await response.json().catch(() => ({}))) as JsonObject;
  if (!response.ok) {
    const error = payload.error as JsonObject | undefined;
    const message = typeof error?.message === 'string' ? error.message : `OpenAI request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function parseQa(text: string): JsonObject {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as JsonObject;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI QA returned no JSON decision');
    return JSON.parse(match[0]) as JsonObject;
  }
}

export class OpenAiImageEngine implements ImageEditEngine {
  readonly available: boolean;

  constructor(
    private readonly apiKey?: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: AiEndpointOptions = {}
  ) {
    this.available = Boolean(apiKey);
  }

  private url(path: string): string {
    return `${(this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/${path}`;
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.options.authMode === 'api-key') headers['api-key'] = this.apiKey!;
    else headers.authorization = `Bearer ${this.apiKey}`;
    if (json) headers['content-type'] = 'application/json';
    return headers;
  }

  async edit(input: EditRequest): Promise<EditResult> {
    if (!this.apiKey) throw new Error('OpenAI image processing is not activated');
    const settings = routeSettings(input.route, this.options);
    const backgroundControl = this.options.supportsBackgroundControl ?? settings.model === 'gpt-image-2';
    const outputFormat = input.background === 'TRANSPARENT' && backgroundControl ? 'png' : 'jpeg';
    const form = new FormData();
    form.append('model', settings.model);
    form.append('image', new Blob([Buffer.from(input.source)], { type: input.mediaType }), input.filename);
    form.append('prompt', buildStudioPrompt(input.background, input.watermarkStatus));
    form.append('size', '1024x1024');
    form.append('quality', settings.quality);
    form.append('output_format', outputFormat);
    if (outputFormat === 'jpeg') form.append('output_compression', '94');
    if (backgroundControl) {
      form.append('background', input.background === 'TRANSPARENT' ? 'transparent' : 'opaque');
    }

    const payload = await readJson(
      await this.fetcher(this.url('images/edits'), {
        method: 'POST',
        headers: this.headers(),
        body: form,
        signal: AbortSignal.timeout(180_000)
      })
    );
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const encoded = rows[0] && typeof rows[0] === 'object' ? (rows[0] as JsonObject).b64_json : undefined;
    if (typeof encoded !== 'string' || !encoded) throw new Error('OpenAI image edit returned no image bytes');
    return {
      bytes: Buffer.from(encoded, 'base64'),
      mediaType: outputFormat === 'png' ? 'image/png' : 'image/jpeg',
      model: settings.model,
      quality: settings.quality
    };
  }

  async compare(source: Uint8Array, _sourceMediaType: string, candidate: EditResult): Promise<QaResult> {
    if (!this.apiKey) throw new Error('OpenAI image QA is not activated');
    const model = this.options.reviewModel ?? 'gpt-5.4-mini';
    const [sourcePreview, candidatePreview] = await Promise.all([
      reviewImageDataUrl(source),
      reviewImageDataUrl(candidate.bytes)
    ]);
    const payload = await readJson(
      await this.fetcher(this.url('responses'), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          model,
          reasoning: { effort: 'low' },
          max_output_tokens: 1_200,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: STUDIO_QA_PROMPT },
                { type: 'input_image', image_url: sourcePreview, detail: 'high' },
                { type: 'input_image', image_url: candidatePreview, detail: 'high' }
              ]
            }
          ]
        }),
        signal: AbortSignal.timeout(180_000)
      })
    );
    const decision = parseQa(responseOutputText(payload));
    const flags = [
      'geometry_or_piece_count_problem',
      'washed_out_or_hazy',
      'crop_or_edge_problem',
      'invented_or_missing_detail',
      'background_problem'
    ];
    const passed = decision.pass === true && !flags.some((key) => decision[key] === true);
    return {
      passed,
      reason: typeof decision.reason === 'string' ? decision.reason : 'AI source comparison completed',
      model
    };
  }
}

export class DisabledImageEngine implements ImageEditEngine {
  readonly available = false;
  async edit(): Promise<EditResult> {
    throw new Error('Image Studio is awaiting AI provider activation');
  }
  async compare(): Promise<QaResult> {
    throw new Error('Image Studio is awaiting AI provider activation');
  }
}

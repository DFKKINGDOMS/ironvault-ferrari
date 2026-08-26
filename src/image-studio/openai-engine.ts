import { buildStudioPrompt, STUDIO_QA_PROMPT } from './prompt.js';
import type { EditRequest, EditResult, ImageEditEngine, QaResult, StudioRoute } from './types.js';

type JsonObject = Record<string, unknown>;

function routeSettings(route: StudioRoute): { model: string; quality: string } {
  if (route === 'SECONDARY_ECONOMY') return { model: 'gpt-image-1-mini', quality: 'high' };
  return { model: 'gpt-image-2', quality: route === 'QA_ESCALATION' ? 'medium' : 'high' };
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

function outputText(payload: JsonObject): string {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const row of output) {
    if (!row || typeof row !== 'object') continue;
    const content = Array.isArray((row as JsonObject).content) ? ((row as JsonObject).content as unknown[]) : [];
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as JsonObject).text === 'string') {
        return (part as JsonObject).text as string;
      }
    }
  }
  return '';
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

function dataUrl(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

export class OpenAiImageEngine implements ImageEditEngine {
  readonly available: boolean;

  constructor(
    private readonly apiKey?: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.available = Boolean(apiKey);
  }

  async edit(input: EditRequest): Promise<EditResult> {
    if (!this.apiKey) throw new Error('OpenAI image processing is not activated');
    const settings = routeSettings(input.route);
    const outputFormat = input.background === 'TRANSPARENT' && settings.model === 'gpt-image-2' ? 'png' : 'jpeg';
    const form = new FormData();
    form.append('model', settings.model);
    form.append('image', new Blob([Buffer.from(input.source)], { type: input.mediaType }), input.filename);
    form.append('prompt', buildStudioPrompt(input.background, input.watermarkStatus));
    form.append('size', '1024x1024');
    form.append('quality', settings.quality);
    form.append('output_format', outputFormat);
    if (outputFormat === 'jpeg') form.append('output_compression', '94');
    if (settings.model === 'gpt-image-2') {
      form.append('background', input.background === 'TRANSPARENT' ? 'transparent' : 'opaque');
    }

    const payload = await readJson(
      await this.fetcher('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form
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

  async compare(source: Uint8Array, sourceMediaType: string, candidate: EditResult): Promise<QaResult> {
    if (!this.apiKey) throw new Error('OpenAI image QA is not activated');
    const model = 'gpt-5.4-mini';
    const payload = await readJson(
      await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_output_tokens: 300,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: STUDIO_QA_PROMPT },
                { type: 'input_image', image_url: dataUrl(source, sourceMediaType), detail: 'high' },
                { type: 'input_image', image_url: dataUrl(candidate.bytes, candidate.mediaType), detail: 'high' }
              ]
            }
          ]
        })
      })
    );
    const decision = parseQa(outputText(payload));
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
    throw new Error('Image Studio is awaiting OpenAI API activation');
  }
  async compare(): Promise<QaResult> {
    throw new Error('Image Studio is awaiting OpenAI API activation');
  }
}

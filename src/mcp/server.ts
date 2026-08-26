import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { buildConnectedImagePrompt } from './prompt.js';
import {
  buildPartQuillWidgetHtml,
  PARTQUILL_WIDGET_ORIGIN,
  PARTQUILL_WIDGET_URI
} from './widget.js';

const openAiFileSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
});

type OpenAiFile = z.infer<typeof openAiFileSchema>;

function sourceName(file: OpenAiFile, index: number): string {
  return file.file_name?.trim() || `source-${index + 1}`;
}

function deterministicJobCode(files: OpenAiFile[]): string {
  const digest = createHash('sha256')
    .update(files.map((file) => file.file_id).join('|'))
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `PQ-C-${digest}`;
}

export function buildPartQuillMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'partquill-image-studio', version: '0.3.0' },
    {
      instructions:
        'PartQuill prepares seller-authorized automotive images for evidence-safe eBay drafts. Never infer identity or fitment from an edited image. Never publish to eBay from Image Studio. Preserve every original and require explicit rights confirmation.'
    }
  );

  registerAppResource(
    server,
    'PartQuill connected Image Studio',
    PARTQUILL_WIDGET_URI,
    { description: 'Upload-once protected automotive image editing inside ChatGPT.' },
    async () => ({
      contents: [
        {
          uri: PARTQUILL_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildPartQuillWidgetHtml(),
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
              domain: PARTQUILL_WIDGET_ORIGIN
            },
            'openai/widgetDomain': PARTQUILL_WIDGET_ORIGIN
          }
        }
      ]
    })
  );

  registerAppTool(
    server,
    'open_image_studio',
    {
      title: 'Open PartQuill Image Studio',
      description:
        'Open the free-first PartQuill image workspace when the user wants to clean, isolate, enhance or prepare automotive-part photos without leaving ChatGPT.',
      outputSchema: {
        stage: z.literal('READY_FOR_UPLOAD'),
        max_images: z.literal(24),
        route: z.literal('FREE_CHATGPT_ASSIST'),
        automatic_return_status: z.literal('PROOF_REQUIRED')
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ui: { resourceUri: PARTQUILL_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/outputTemplate': PARTQUILL_WIDGET_URI,
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': 'Opening protected Image Studio…',
        'openai/toolInvocation/invoked': 'Image Studio ready'
      }
    },
    async () => {
      const structuredContent = {
        stage: 'READY_FOR_UPLOAD' as const,
        max_images: 24 as const,
        route: 'FREE_CHATGPT_ASSIST' as const,
        automatic_return_status: 'PROOF_REQUIRED' as const
      };
      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: 'PartQuill Image Studio is ready. The user can attach 1–24 originals once inside this ChatGPT conversation. No eBay write or paid API call occurs from this tool.'
          }
        ]
      };
    }
  );

  registerAppTool(
    server,
    'prepare_protected_image_job',
    {
      title: 'Prepare protected image job',
      description:
        'Use when the user has already attached seller-owned or seller-authorized automotive-part images and wants PartQuill to apply its exact preservation prompt in source order.',
      inputSchema: {
        images: z.array(openAiFileSchema).min(1).max(24),
        rights_confirmed: z.literal(true)
      },
      outputSchema: {
        job_code: z.string(),
        source_count: z.number().int(),
        source_order: z.array(z.string()),
        protected_prompt: z.string(),
        return_status: z.literal('AWAITING_CHATGPT_EDIT')
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ui: { resourceUri: PARTQUILL_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/outputTemplate': PARTQUILL_WIDGET_URI,
        'openai/widgetAccessible': true,
        'openai/fileParams': ['images'],
        'openai/toolInvocation/invoking': 'Binding originals to protected job…',
        'openai/toolInvocation/invoked': 'Protected job prepared'
      }
    },
    async ({ images }) => {
      const jobCode = deterministicJobCode(images);
      const sourceOrder = images.map(sourceName);
      const protectedPrompt = buildConnectedImagePrompt(jobCode, sourceOrder);
      const structuredContent = {
        job_code: jobCode,
        source_count: images.length,
        source_order: sourceOrder,
        protected_prompt: protectedPrompt,
        return_status: 'AWAITING_CHATGPT_EDIT' as const
      };
      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: `${protectedPrompt}\n\nThe originals were supplied through ChatGPT file references. Do not ask the user to upload them again.`
          }
        ]
      };
    }
  );

  registerAppTool(
    server,
    'return_edited_images',
    {
      title: 'Return edited images to PartQuill',
      description:
        'Use only after ChatGPT has completed a PartQuill image job and can pass every finished derivative as a file reference. This proves whether automatic result return is supported in the current host session.',
      inputSchema: {
        job_code: z.string().regex(/^PQ-[A-Z]-[A-Z0-9]{7,8}$/),
        images: z.array(openAiFileSchema).min(1).max(24)
      },
      outputSchema: {
        job_code: z.string(),
        returned_count: z.number().int(),
        returned_files: z.array(openAiFileSchema),
        status: z.literal('READY_FOR_REVIEW'),
        eBay_write_performed: z.literal(false)
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ui: { resourceUri: PARTQUILL_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/outputTemplate': PARTQUILL_WIDGET_URI,
        'openai/widgetAccessible': true,
        'openai/fileParams': ['images'],
        'openai/toolInvocation/invoking': 'Mapping finished images…',
        'openai/toolInvocation/invoked': 'Finished images ready for review'
      }
    },
    async ({ job_code: jobCode, images }) => {
      const structuredContent = {
        job_code: jobCode,
        returned_count: images.length,
        returned_files: images,
        status: 'READY_FOR_REVIEW' as const,
        eBay_write_performed: false as const
      };
      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: `${images.length} finished image${images.length === 1 ? '' : 's'} returned to ${jobCode}. They remain review-only derivatives; no eBay write occurred.`
          }
        ]
      };
    }
  );

  return server;
}

import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { researchLexusPart, type LexusPartResearch } from '../catalog/lexuspartsnow.js';
import { buildConnectedImagePrompt } from './prompt.js';

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

type LexusPartResearchFunction = (
  partNumber: string,
  options?: { quickSaleDiscountPercent?: number }
) => Promise<LexusPartResearch>;

export interface PartQuillMcpDependencies {
  researchLexusPart?: LexusPartResearchFunction;
}

function money(value: number | undefined): string {
  return value === undefined ? 'not shown' : `$${value.toFixed(2)}`;
}

function lexusPartSummary(result: LexusPartResearch): string {
  const fitmentPreview = result.fitment
    .slice(0, 12)
    .map((row) => `- ${row.raw}`)
    .join('\n');
  const image = result.images[0];
  const quickSale = result.quickSale.targetPrice === undefined
    ? '- **Quick-sale target:** unavailable because the dealer did not return a current sale price'
    : `- **Quick-sale target:** ${money(result.quickSale.targetPrice)} (dealer-anchored estimate, ${result.quickSale.discountPercent}% below current dealer price)`;
  return [
    `## ${result.identity.partNumber} — ${result.identity.description}`,
    '',
    `- **Manufacturer:** ${result.identity.manufacturer}`,
    `- **List/MSRP:** ${money(result.pricing.listPrice)}`,
    `- **Current dealer price:** ${money(result.pricing.dealerSalePrice)}`,
    quickSale,
    ...(result.identity.replacedBy ? [`- **Replaced by:** ${result.identity.replacedBy}`] : []),
    '',
    image ? `![${image.alt || result.identity.description}](${image.url})` : '_No catalog image was returned._',
    '',
    `### Fitment (${result.fitmentTotal} dealer-catalog rows)`,
    fitmentPreview || '- No fitment rows were returned.',
    result.fitmentTotal > 12 ? `- …and ${result.fitmentTotal - 12} additional rows in the structured result.` : '',
    '',
    `Source: ${result.source.url} (retrieved ${result.source.retrievedAt})`,
    '',
    `**Important:** ${result.quickSale.disclaimer} ${result.source.limitations[2]}`,
    'No eBay listing or price was changed.'
  ].join('\n');
}

export function buildPartQuillMcpServer(dependencies: PartQuillMcpDependencies = {}): McpServer {
  const lexusLookup = dependencies.researchLexusPart ?? researchLexusPart;
  const server = new McpServer(
    { name: 'partquill-image-studio', version: '0.4.0' },
    {
      instructions:
        'PartQuill researches exact Lexus part numbers and prepares seller-authorized automotive images for evidence-safe eBay drafts. Use research_lexus_part when the user supplies a Lexus part number or asks its identity, price, worth, images or fitment. Dealer fitment is reference evidence and always requires VIN confirmation. Never infer identity or fitment from an edited image. Never publish to eBay from these tools. Preserve every original and require explicit rights confirmation.'
    }
  );

  registerAppTool(
    server,
    'research_lexus_part',
    {
      title: 'Research Lexus part',
      description:
        'Look up an exact Lexus part number at LexusPartsNow and return dealer-catalog identity, list/MSRP, current dealer sale price, a dealer-anchored quick-sale estimate, images, supersession and year/make/model fitment. Use when the user enters a Lexus part number or asks what it is worth. Read-only: never changes or publishes an eBay listing.',
      inputSchema: {
        part_number: z.string().min(5).max(40),
        quick_sale_discount_percent: z.number().min(10).max(40).default(20)
      },
      outputSchema: {
        source: z.object({
          provider: z.literal('LexusPartsNow'),
          url: z.string().url(),
          retrievedAt: z.string(),
          evidenceStatus: z.literal('DEALER_CATALOG_REFERENCE'),
          limitations: z.array(z.string())
        }),
        identity: z.object({
          manufacturer: z.literal('Lexus'),
          partNumber: z.string(),
          description: z.string(),
          alternateDescription: z.string().optional(),
          manufacturerNote: z.string().optional(),
          condition: z.string().optional(),
          fitmentType: z.string().optional(),
          pncCode: z.string().optional(),
          replacedBy: z.string().optional(),
          replaces: z.array(z.string())
        }),
        pricing: z.object({
          currency: z.literal('USD'),
          listPrice: z.number().optional(),
          dealerSalePrice: z.number().optional(),
          savingsPercent: z.number().optional(),
          status: z.string().optional()
        }),
        quickSale: z.object({
          targetPrice: z.number().optional(),
          lowPrice: z.number().optional(),
          highPrice: z.number().optional(),
          discountPercent: z.number(),
          basis: z.enum(['DEALER_SALE_PRICE', 'UNAVAILABLE']),
          disclaimer: z.string()
        }),
        images: z.array(
          z.object({
            url: z.string().url(),
            type: z.enum(['ACTUAL_PRODUCT_PHOTO', 'CATALOG_ILLUSTRATION']),
            alt: z.string().optional()
          })
        ),
        fitment: z.array(
          z.object({
            yearStart: z.number().int().optional(),
            yearEnd: z.number().int().optional(),
            make: z.literal('Lexus'),
            model: z.string(),
            trimEngine: z.string().optional(),
            optionDetails: z.string().optional(),
            raw: z.string()
          })
        ),
        fitmentTotal: z.number().int(),
        vinConfirmationRequired: z.literal(true)
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: {
        'openai/toolInvocation/invoking': 'Checking Lexus dealer catalog…',
        'openai/toolInvocation/invoked': 'Lexus part research ready'
      }
    },
    async ({ part_number: partNumber, quick_sale_discount_percent: discountPercent }) => {
      const result = await lexusLookup(partNumber, { quickSaleDiscountPercent: discountPercent });
      const structuredContent = { ...result };
      return {
        structuredContent,
        content: [{ type: 'text', text: lexusPartSummary(result) }]
      };
    }
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

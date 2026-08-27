import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { researchOemPart, type OemPartResearch } from '../catalog/oem-research.js';
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

type OemPartResearchFunction = (
  partNumber: string,
  options?: { quickSaleDiscountPercent?: number }
) => Promise<OemPartResearch>;

export interface PartQuillMcpDependencies {
  researchOemPart?: OemPartResearchFunction;
}

function money(value: number | undefined): string {
  return value === undefined ? 'not shown' : `$${value.toFixed(2)}`;
}

function oemPartSummary(result: OemPartResearch): string {
  const fitmentPreview = result.fitment
    .slice(0, 12)
    .map((row) => `- ${row.raw}`)
    .join('\n');
  const image = result.images[0];
  const quoteRows = result.pricing.anonymousQuotes
    .map((quote) => `- **${quote.quote}:** current ${money(quote.currentPrice)} · list/MSRP ${money(quote.listPrice)}`)
    .join('\n');
  const quickSale = result.quickSale.targetPrice === undefined
    ? '- **Quick-sale target:** unavailable because no current anonymous quote was returned'
    : `- **Quick-sale target:** ${money(result.quickSale.targetPrice)} (${result.quickSale.discountPercent}% below the lowest current anonymous OEM quote)`;
  return [
    `## ${result.identity.partNumber} — ${result.identity.description}`,
    '',
    `- **Catalog brands:** ${result.brandCoverage.catalogBrands.join(', ') || 'not established'}`,
    `- **Fitment brands:** ${result.brandCoverage.fitmentBrands.join(', ') || 'not returned'}`,
    `- **Crossover:** ${result.brandCoverage.crossoverStatus === 'MULTI_BRAND' ? 'Yes—multiple Toyota umbrella brands have evidence' : 'No crossover established'}`,
    `- **List/MSRP reference:** ${money(result.pricing.listPriceReference)}`,
    `- **Current observed range:** ${money(result.pricing.currentPriceLow)}–${money(result.pricing.currentPriceHigh)}`,
    quickSale,
    ...(result.identity.replacedBy.length ? [`- **Replaced by:** ${result.identity.replacedBy.join(', ')}`] : []),
    ...(result.identity.replaces.length ? [`- **Replaces:** ${result.identity.replaces.join(', ')}`] : []),
    '',
    '### Anonymous OEM price checks',
    quoteRows || '- No current price was returned.',
    '',
    image ? `![${image.alt || result.identity.description}](${image.url})` : '_No catalog image was returned._',
    '',
    `### Fitment (${result.fitmentTotal} exact catalog rows)`,
    fitmentPreview || '- No fitment rows were returned.',
    result.fitmentTotal > 12 ? `- …and ${result.fitmentTotal - 12} additional rows in the structured result.` : '',
    '',
    `Catalog checks: ${result.catalogChecks.exactMatches} exact match(es) from ${result.catalogChecks.attempted} private lookup sources; retrieved ${result.catalogChecks.retrievedAt}. Dealer identity is never exposed.`,
    '',
    `**Important:** ${result.quickSale.disclaimer}`,
    'No eBay listing or price was changed.'
  ].join('\n');
}

export function buildPartQuillMcpServer(dependencies: PartQuillMcpDependencies = {}): McpServer {
  const oemLookup = dependencies.researchOemPart ?? researchOemPart;
  const server = new McpServer(
    { name: 'partquill-image-studio', version: '0.5.0' },
    {
      instructions:
        'PartQuill researches exact Toyota, Lexus and Scion part numbers and prepares seller-authorized automotive images for evidence-safe eBay drafts. Use research_oem_part when the user supplies a part number or asks its identity, price, worth, images, crossover or fitment. Never expose, repeat or infer any lookup-source identity, dealer name, website, URL, phone number, address or personnel. All price sources must remain anonymous. Catalog fitment is reference evidence and always requires VIN confirmation. Never infer identity or fitment from an edited image. Never publish to eBay from these tools. Preserve every original and require explicit rights confirmation.'
    }
  );

  registerAppTool(
    server,
    'research_oem_part',
    {
      title: 'Research Toyota / Lexus / Scion part',
      description:
        'Privately exact-match a Toyota, Lexus or Scion part number across multiple OEM reference catalogs. Returns anonymized price quotes, crossover brands, PartQuill-hosted images, supersession and year/make/model fitment. It never returns dealer identity or contact information. Read-only: never changes or publishes an eBay listing.',
      inputSchema: {
        part_number: z.string().min(5).max(40),
        quick_sale_discount_percent: z.number().min(10).max(40).default(20)
      },
      outputSchema: {
        identity: z.object({
          partNumber: z.string(),
          description: z.string(),
          alternateNames: z.array(z.string()),
          manufacturerNotes: z.array(z.string()),
          condition: z.string().optional(),
          fitmentType: z.string().optional(),
          pncCodes: z.array(z.string()),
          replacedBy: z.array(z.string()),
          replaces: z.array(z.string())
        }),
        brandCoverage: z.object({
          catalogBrands: z.array(z.enum(['Lexus', 'Toyota', 'Scion'])),
          fitmentBrands: z.array(z.enum(['Lexus', 'Toyota', 'Scion'])),
          crossoverStatus: z.enum(['SINGLE_BRAND', 'MULTI_BRAND'])
        }),
        pricing: z.object({
          currency: z.literal('USD'),
          observedQuoteCount: z.number().int(),
          listPriceReference: z.number().optional(),
          currentPriceLow: z.number().optional(),
          currentPriceHigh: z.number().optional(),
          anonymousQuotes: z.array(z.object({
            quote: z.string(),
            listPrice: z.number().optional(),
            currentPrice: z.number().optional(),
            savingsPercent: z.number().optional()
          }))
        }),
        quickSale: z.object({
          targetPrice: z.number().optional(),
          lowPrice: z.number().optional(),
          highPrice: z.number().optional(),
          discountPercent: z.number(),
          basis: z.enum(['LOWEST_CURRENT_OEM_QUOTE', 'UNAVAILABLE']),
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
            make: z.enum(['Lexus', 'Toyota', 'Scion']),
            model: z.string(),
            trimEngine: z.string().optional(),
            optionDetails: z.string().optional(),
            raw: z.string()
          })
        ),
        fitmentTotal: z.number().int(),
        catalogChecks: z.object({
          attempted: z.literal(3),
          exactMatches: z.number().int(),
          unavailable: z.number().int(),
          retrievedAt: z.string()
        }),
        dealerIdentityExposed: z.literal(false),
        vinConfirmationRequired: z.literal(true)
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: {
        'openai/toolInvocation/invoking': 'Checking private OEM references…',
        'openai/toolInvocation/invoked': 'Anonymous OEM research ready'
      }
    },
    async ({ part_number: partNumber, quick_sale_discount_percent: discountPercent }) => {
      const result = await oemLookup(partNumber, { quickSaleDiscountPercent: discountPercent });
      const structuredContent = { ...result };
      return {
        structuredContent,
        content: [{ type: 'text', text: oemPartSummary(result) }]
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

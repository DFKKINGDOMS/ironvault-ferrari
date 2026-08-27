import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { researchOemPart, type OemPartResearch } from '../catalog/oem-research.js';
import { verifyOemPartVin, type VinPartVerification } from '../catalog/vin-fitment.js';
import {
  loadCatalogImageAttachment,
  type CatalogImageAttachment
} from '../catalog/image-proxy.js';
import { buildPartQuillOemWidgetHtml, PARTQUILL_OEM_WIDGET_URI } from './oem-widget.js';
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
type CatalogImageLoader = (publicUrl: string) => Promise<CatalogImageAttachment | undefined>;
type VinPartVerificationFunction = (partNumber: string, vin: string) => Promise<VinPartVerification>;

export interface PartQuillMcpDependencies {
  researchOemPart?: OemPartResearchFunction;
  loadCatalogImage?: CatalogImageLoader;
  verifyOemPartVin?: VinPartVerificationFunction;
}

function money(value: number | undefined): string {
  return value === undefined ? 'not shown' : `$${value.toFixed(2)}`;
}

interface ImagePresentation {
  productPhotoAvailable: boolean;
  diagramAvailable: boolean;
  visualCard: 'PARTQUILL_INLINE_CARD';
  transcriptAttachments: false;
  diagramCallouts: string[];
  productPhotoUsage: 'REFERENCE_ONLY_UNLESS_RIGHTS_CONFIRMED';
  catalogDiagramUsage: 'INTERNAL_REFERENCE_ONLY';
  primaryEbayImageApproved: false;
}

function oemPartSummary(result: OemPartResearch, imagePresentation: ImagePresentation): string {
  const fitmentPreview = result.fitment
    .slice(0, 12)
    .map((row) => `- ${row.raw}`)
    .join('\n');
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
    '### Images and diagram reference',
    `- **Exact product reference photo:** ${imagePresentation.productPhotoAvailable ? 'available to the PartQuill visual result card' : 'not returned'}`,
    `- **Catalog diagram:** ${imagePresentation.diagramAvailable ? 'available to the PartQuill visual result card' : 'not returned'}`,
    `- **Diagram callout / PNC:** ${imagePresentation.diagramCallouts.join(', ') || 'not returned'}`,
    '- **Display:** These are not transcript attachments. Do not claim they are shown unless the PartQuill visual result card is visible.',
    '- **Usage:** Research reference only. Neither image is approved as the primary eBay image; publishing requires confirmed image rights.',
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
  const imageLoader = dependencies.loadCatalogImage ?? loadCatalogImageAttachment;
  const vinVerifier = dependencies.verifyOemPartVin ?? verifyOemPartVin;
  const server = new McpServer(
    { name: 'partquill-image-studio', version: '0.7.0' },
    {
      instructions:
        'PartQuill researches exact Toyota, Lexus and Scion part numbers and prepares seller-authorized automotive images for evidence-safe eBay drafts. Use research_oem_part when the user supplies a part number or asks its identity, price, worth, images, crossover or fitment. Use verify_oem_part_vin when the user supplies both a part number and a VIN. Never say a product photo or diagram is attached above or displayed unless the PartQuill visual result card is visibly rendered; raw transcript image attachments are disabled. Never expose, repeat or infer any lookup-source identity, dealer name, website, URL, phone number, address or personnel. All price sources must remain anonymous. Never echo a full VIN; return only its last four characters and never store it. Catalog fitment is reference evidence and broad or conflicting fitment remains blocked. Never infer identity or fitment from an edited image. Never publish to eBay from these tools. Preserve every original and require explicit rights confirmation.'
    }
  );

  registerAppResource(
    server,
    'PartQuill OEM Part Finder',
    PARTQUILL_OEM_WIDGET_URI,
    { description: 'Inline OEM part research, reference media and VIN cross-check panel.' },
    async () => ({
      contents: [
        {
          uri: PARTQUILL_OEM_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildPartQuillOemWidgetHtml(),
          _meta: { ui: { prefersBorder: true } }
        }
      ]
    })
  );

  registerAppTool(
    server,
    'open_oem_part_finder',
    {
      title: 'Open PartQuill OEM Part Finder',
      description:
        'Open the buyer-facing Toyota, Lexus and Scion part-number finder with an optional 17-character VIN cross-check. Read-only and dealer-anonymous.',
      outputSchema: {
        stage: z.literal('READY_FOR_PART_OR_VIN'),
        supportedMakes: z.tuple([z.literal('Toyota'), z.literal('Lexus'), z.literal('Scion')]),
        dealerIdentityExposed: z.literal(false),
        eBayWritePerformed: z.literal(false)
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ui: { resourceUri: PARTQUILL_OEM_WIDGET_URI, visibility: ['model'] },
        'openai/toolInvocation/invoking': 'Opening PartQuill OEM Part Finder…',
        'openai/toolInvocation/invoked': 'PartQuill OEM Part Finder ready'
      }
    },
    async () => {
      const structuredContent = {
        stage: 'READY_FOR_PART_OR_VIN' as const,
        supportedMakes: ['Toyota', 'Lexus', 'Scion'] as const,
        dealerIdentityExposed: false as const,
        eBayWritePerformed: false as const
      };
      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: 'PartQuill OEM Part Finder is ready for an exact part number and optional 17-character VIN. No dealer identity or eBay write is exposed.'
          }
        ]
      };
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
        imagePresentation: z.object({
          productPhotoAvailable: z.boolean(),
          diagramAvailable: z.boolean(),
          visualCard: z.literal('PARTQUILL_INLINE_CARD'),
          transcriptAttachments: z.literal(false),
          diagramCallouts: z.array(z.string()),
          productPhotoUsage: z.literal('REFERENCE_ONLY_UNLESS_RIGHTS_CONFIRMED'),
          catalogDiagramUsage: z.literal('INTERNAL_REFERENCE_ONLY'),
          primaryEbayImageApproved: z.literal(false)
        }),
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
        ui: { resourceUri: PARTQUILL_OEM_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/toolInvocation/invoking': 'Checking private OEM references…',
        'openai/toolInvocation/invoked': 'Anonymous OEM research ready'
      }
    },
    async ({ part_number: partNumber, quick_sale_discount_percent: discountPercent }) => {
      const result = await oemLookup(partNumber, { quickSaleDiscountPercent: discountPercent });
      const productPhoto = result.images.find((image) => image.type === 'ACTUAL_PRODUCT_PHOTO');
      const catalogDiagram = result.images.find((image) => image.type === 'CATALOG_ILLUSTRATION');
      const [productAttachment, diagramAttachment] = await Promise.all([
        productPhoto ? imageLoader(productPhoto.url).catch(() => undefined) : undefined,
        catalogDiagram ? imageLoader(catalogDiagram.url).catch(() => undefined) : undefined
      ]);
      const imagePresentation: ImagePresentation = {
        productPhotoAvailable: Boolean(productAttachment),
        diagramAvailable: Boolean(diagramAttachment),
        visualCard: 'PARTQUILL_INLINE_CARD',
        transcriptAttachments: false,
        diagramCallouts: result.identity.pncCodes,
        productPhotoUsage: 'REFERENCE_ONLY_UNLESS_RIGHTS_CONFIRMED',
        catalogDiagramUsage: 'INTERNAL_REFERENCE_ONLY',
        primaryEbayImageApproved: false
      };
      const structuredContent = { ...result, imagePresentation };
      const partquillMedia: Array<{
        role: 'PRODUCT_PHOTO' | 'CATALOG_DIAGRAM';
        data: string;
        mimeType: string;
        alt: string;
      }> = [];
      if (productAttachment) {
        partquillMedia.push({
          role: 'PRODUCT_PHOTO',
          data: productAttachment.data,
          mimeType: productAttachment.mimeType,
          alt: `Exact product reference photograph for ${result.identity.partNumber}`
        });
      }
      if (diagramAttachment) {
        partquillMedia.push({
          role: 'CATALOG_DIAGRAM',
          data: diagramAttachment.data,
          mimeType: diagramAttachment.mimeType,
          alt: `Catalog diagram for ${result.identity.partNumber}; callout ${imagePresentation.diagramCallouts.join(', ') || 'not returned'}`
        });
      }
      return {
        structuredContent,
        content: [{ type: 'text', text: oemPartSummary(result, imagePresentation) }],
        _meta: { partquillMedia }
      };
    }
  );

  registerAppTool(
    server,
    'verify_oem_part_vin',
    {
      title: 'Verify OEM part against buyer VIN',
      description:
        'Decode a buyer-provided 17-character Toyota, Lexus or Scion VIN and cross-check an exact OEM part number against three anonymous catalog paths. Returns only the VIN last four, never stores the VIN, never exposes dealer identity and never writes to eBay.',
      inputSchema: {
        part_number: z.string().min(5).max(40),
        vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i)
      },
      outputSchema: {
        partNumber: z.string(),
        vinLastFour: z.string().length(4),
        vehicle: z.object({
          make: z.enum(['Toyota', 'Lexus', 'Scion']),
          model: z.string(),
          modelYear: z.number().int(),
          engineModel: z.string().optional(),
          displacementL: z.number().optional(),
          cylinders: z.number().optional(),
          trim: z.string().optional(),
          series: z.string().optional()
        }),
        status: z.enum(['CATALOG_MATCH', 'CATALOG_NO_MATCH', 'INCONCLUSIVE']),
        statusLabel: z.enum(['Fits catalog evidence', 'No matching catalog evidence', 'Needs manual confirmation']),
        explanation: z.string(),
        matchingFitment: z.array(z.object({
          yearStart: z.number().int().optional(),
          yearEnd: z.number().int().optional(),
          make: z.enum(['Lexus', 'Toyota', 'Scion']),
          model: z.string(),
          trimEngine: z.string().optional(),
          optionDetails: z.string().optional(),
          raw: z.string()
        })),
        catalogChecks: z.object({
          attempted: z.literal(3),
          exactPartMatches: z.number().int(),
          unavailable: z.number().int(),
          matchingRows: z.number().int()
        }),
        listingFitmentAllowed: z.boolean(),
        vinStored: z.literal(false),
        dealerIdentityExposed: z.literal(false)
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: {
        ui: { resourceUri: PARTQUILL_OEM_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/toolInvocation/invoking': 'Checking VIN against anonymous catalog evidence…',
        'openai/toolInvocation/invoked': 'VIN catalog cross-check ready'
      }
    },
    async ({ part_number: partNumber, vin }) => {
      const verification = await vinVerifier(partNumber, vin);
      const structuredContent = { ...verification };
      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: `${verification.statusLabel}: ${verification.explanation} VIN ending ${verification.vinLastFour}. The full VIN was not returned or stored. No dealer identity or eBay write was exposed.`
          }
        ]
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

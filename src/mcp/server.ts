import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import {
  researchOemPart,
  summarizeOemApplications,
  type OemApplicationSummary,
  type OemPartResearch
} from '../catalog/oem-research.js';
import { verifyOemPartVin, type VinPartVerification } from '../catalog/vin-fitment.js';
import { findCorrectOemPart, type CorrectOemPartResult } from '../catalog/correct-part.js';
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
type CorrectOemPartFunction = (partNumber: string, vin: string) => Promise<CorrectOemPartResult>;

export interface PartQuillMcpDependencies {
  researchOemPart?: OemPartResearchFunction;
  loadCatalogImage?: CatalogImageLoader;
  verifyOemPartVin?: VinPartVerificationFunction;
  findCorrectOemPart?: CorrectOemPartFunction;
  oemResearchAllowed?: boolean;
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

interface PartQuillMedia {
  role: 'PRODUCT_PHOTO' | 'CATALOG_DIAGRAM';
  data: string;
  mimeType: string;
  alt: string;
}

async function prepareResearchMedia(
  result: OemPartResearch,
  imageLoader: CatalogImageLoader
): Promise<{ imagePresentation: ImagePresentation; partquillMedia: PartQuillMedia[] }> {
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
  const partquillMedia: PartQuillMedia[] = [];
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
  return { imagePresentation, partquillMedia };
}

function researchCardData(
  result: OemPartResearch,
  imagePresentation: ImagePresentation,
  fitmentVerdict: {
    status: 'VIN_REQUIRED' | 'VIN_MATCHED_CORRECT_PART';
    tone: 'AMBER' | 'GREEN';
    statusLabel: 'Fitment not verified' | 'Correct part for this vehicle';
    explanation: string;
    listingFitmentAllowed: boolean;
  }
) {
  const applications = summarizeOemApplications(result.fitment);
  return {
    identity: {
      partNumber: result.identity.partNumber,
      description: result.identity.description,
      alternateNames: result.identity.alternateNames,
      manufacturerNotes: result.identity.manufacturerNotes,
      ...(result.identity.condition ? { catalogCondition: result.identity.condition } : {}),
      ...(result.identity.fitmentType ? { catalogFitmentType: result.identity.fitmentType } : {}),
      pncCodes: result.identity.pncCodes,
      replacedBy: result.identity.replacedBy,
      replaces: result.identity.replaces
    },
    brandCoverage: result.brandCoverage,
    pricingReference: {
      currency: result.pricing.currency,
      observedQuoteCount: result.pricing.observedQuoteCount,
      ...(result.pricing.listPriceReference !== undefined ? { listPriceReference: result.pricing.listPriceReference } : {}),
      ...(result.pricing.currentPriceLow !== undefined ? { currentPriceLow: result.pricing.currentPriceLow } : {}),
      ...(result.pricing.currentPriceHigh !== undefined ? { currentPriceHigh: result.pricing.currentPriceHigh } : {}),
      evidenceType: 'ANONYMOUS_OEM_SOURCE_REFERENCE' as const,
      ebayMarketValueVerified: false as const
    },
    fitmentVerdict,
    imagePresentation,
    applicationSummary: applications,
    applicationGroupTotal: applications.length,
    fitmentRowCount: result.fitmentTotal,
    catalogChecks: result.catalogChecks,
    dealerIdentityExposed: false as const,
    vinConfirmationRequired: true as const
  };
}

function applicationLine(application: OemApplicationSummary): string {
  return `${application.yearRanges.join(', ')} ${application.make} ${application.model}`;
}

function oemPartSummary(
  result: OemPartResearch,
  imagePresentation: ImagePresentation,
  applications: OemApplicationSummary[]
): string {
  const applicationPreview = applications.slice(0, 8).map((application) => `- ${applicationLine(application)}`).join('\n');
  return [
    `## ${result.identity.partNumber} — ${result.identity.description}`,
    '',
    '**Vehicle fitment: AMBER — not verified.** Enter the buyer VIN in the PartQuill card for a vehicle-specific verdict. Do not call the applications below safe or confirmed fitment.',
    '',
    ...(result.identity.replacedBy.length ? [`- **Replaced by:** ${result.identity.replacedBy.join(', ')}`] : []),
    ...(result.identity.replaces.length ? [`- **Replaces:** ${result.identity.replaces.join(', ')}`] : []),
    `- **Diagram callout / PNC:** ${imagePresentation.diagramCallouts.join(', ') || 'not returned'}`,
    `- **Potential application groups:** ${applications.length}; VIN confirmation required`,
    '',
    '### Potential applications — VIN required',
    applicationPreview || '- No catalog application groups were returned.',
    applications.length > 8 ? `- …and ${applications.length - 8} additional grouped applications in the visual card.` : '',
    '',
    '### Reference pricing — not eBay market value',
    `- **List/MSRP reference:** ${money(result.pricing.listPriceReference)}`,
    `- **Current anonymous OEM-source range:** ${money(result.pricing.currentPriceLow)}–${money(result.pricing.currentPriceHigh)}`,
    '- No eBay list price or quick-sale price is verified by this lookup. Sold-market evidence, actual condition, shipping, fees and seller cost are still required.',
    '',
    '### Reference media',
    `- **Exact product reference photo:** ${imagePresentation.productPhotoAvailable ? 'available to the PartQuill visual result card' : 'not returned'}`,
    `- **Catalog diagram:** ${imagePresentation.diagramAvailable ? 'available to the PartQuill visual result card' : 'not returned'}`,
    '- **Display:** These are not transcript attachments. Do not claim they are shown unless the PartQuill visual result card is visible.',
    '- **Usage:** Research reference only. Neither image is approved as the primary eBay image; publishing requires confirmed image rights.',
    '',
    '**eBay draft guard:** Catalog condition does not establish the seller item’s condition. Do not assert New, quantity, package contents, specifications, fitment or a recommended price until those facts are separately confirmed.',
    `Catalog checks: ${result.catalogChecks.exactMatches} exact part-number match(es) from ${result.catalogChecks.attempted} anonymous sources.`,
    'No eBay listing or price was changed.'
  ].join('\n');
}

export function buildPartQuillMcpServer(dependencies: PartQuillMcpDependencies = {}): McpServer {
  const oemLookup = dependencies.researchOemPart ?? researchOemPart;
  const imageLoader = dependencies.loadCatalogImage ?? loadCatalogImageAttachment;
  const vinVerifier = dependencies.verifyOemPartVin ?? verifyOemPartVin;
  const correctPartFinder = dependencies.findCorrectOemPart ?? findCorrectOemPart;
  const assertOemResearchAllowed = (): void => {
    if (dependencies.oemResearchAllowed === false) {
      throw new Error('OEM research is unavailable until authorized data and image-use rights are documented.');
    }
  };
  const server = new McpServer(
    { name: 'partquill-image-studio', version: '0.13.0' },
    {
      instructions:
        'PartQuill researches exact Toyota, Lexus and Scion part numbers and prepares seller-authorized automotive images for evidence-safe eBay drafts. Use research_oem_part when the user supplies a part number or asks its identity, price, worth, images, crossover or fitment. Use verify_oem_part_vin when the user supplies both a part number and a VIN. When and only when that verifier returns RED, find_correct_oem_part may reuse the same buyer VIN to locate one exact VIN-filtered replacement in the same part family. This is buyer purchase assistance: it must never replace the seller item, change the seller listing, or write to eBay. A replacement is GREEN only when one unique VIN-filtered candidate is exact-matched; multiple, incomplete or conflicting candidates remain AMBER. Always lead with the returned vehicle-fitment verdict: GREEN means Fits this vehicle, AMBER means Fitment not verified or May fit, and RED means Does not fit this vehicle. Without a VIN, fitment is always AMBER and potential application groups must never be called safe or confirmed. Never dump raw catalog option codes or hidden research rows. Never say a product photo or diagram is attached above or displayed unless the PartQuill visual result card is visibly rendered; raw transcript image attachments are disabled. Never expose, repeat or infer any lookup-source identity, dealer name, website, URL, phone number, address or personnel. All price sources must remain anonymous. OEM-source quotes and MSRP are reference pricing, not eBay market value; never manufacture a recommended list price or quick-sale price without sold-market evidence, actual seller condition, shipping, fees and cost. Catalog condition does not prove the seller item condition. Never invent teeth count, dimensions, package contents, quantity or other specifications absent from the structured result. Never echo a full VIN; return only its last four characters and never store it. Catalog fitment is reference evidence and broad or conflicting fitment remains blocked. Never infer identity or fitment from an edited image. Never publish to eBay from these tools. Preserve every original and require explicit rights confirmation.'
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
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: []
              }
            }
          }
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
        'Privately exact-match a Toyota, Lexus or Scion part number across multiple OEM reference catalogs. Returns a concise AMBER fitment-not-verified verdict, grouped potential applications, anonymous OEM-source reference pricing, reference media and supersession. A green or red vehicle verdict requires verify_oem_part_vin. It never returns dealer identity or contact information, raw option-code dumps, verified eBay market value or a seller-item condition claim. Read-only: never changes or publishes an eBay listing.',
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
          catalogCondition: z.string().optional(),
          catalogFitmentType: z.string().optional(),
          pncCodes: z.array(z.string()),
          replacedBy: z.array(z.string()),
          replaces: z.array(z.string())
        }),
        brandCoverage: z.object({
          catalogBrands: z.array(z.enum(['Lexus', 'Toyota', 'Scion'])),
          fitmentBrands: z.array(z.enum(['Lexus', 'Toyota', 'Scion'])),
          crossoverStatus: z.enum(['SINGLE_BRAND', 'MULTI_BRAND'])
        }),
        pricingReference: z.object({
          currency: z.literal('USD'),
          observedQuoteCount: z.number().int(),
          listPriceReference: z.number().optional(),
          currentPriceLow: z.number().optional(),
          currentPriceHigh: z.number().optional(),
          evidenceType: z.literal('ANONYMOUS_OEM_SOURCE_REFERENCE'),
          ebayMarketValueVerified: z.literal(false)
        }),
        fitmentVerdict: z.object({
          status: z.literal('VIN_REQUIRED'),
          tone: z.literal('AMBER'),
          statusLabel: z.literal('Fitment not verified'),
          explanation: z.string(),
          listingFitmentAllowed: z.literal(false)
        }),
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
        applicationSummary: z.array(z.object({
          make: z.enum(['Lexus', 'Toyota', 'Scion']),
          model: z.string(),
          yearRanges: z.array(z.string())
        })),
        applicationGroupTotal: z.number().int(),
        fitmentRowCount: z.number().int(),
        catalogChecks: z.object({
          attempted: z.literal(3),
          exactMatches: z.number().int(),
          unavailable: z.number().int(),
          retrievedAt: z.string()
        }),
        sellerListingReadiness: z.object({
          status: z.literal('NEEDS_SELLER_FACTS_AND_MARKET_EVIDENCE'),
          missingSellerFacts: z.array(z.string()),
          ebayMarketValueVerified: z.literal(false),
          finalListingReady: z.literal(false)
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
      assertOemResearchAllowed();
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
      const applications = summarizeOemApplications(result.fitment);
      const structuredContent = {
        identity: {
          partNumber: result.identity.partNumber,
          description: result.identity.description,
          alternateNames: result.identity.alternateNames,
          manufacturerNotes: result.identity.manufacturerNotes,
          ...(result.identity.condition ? { catalogCondition: result.identity.condition } : {}),
          ...(result.identity.fitmentType ? { catalogFitmentType: result.identity.fitmentType } : {}),
          pncCodes: result.identity.pncCodes,
          replacedBy: result.identity.replacedBy,
          replaces: result.identity.replaces
        },
        brandCoverage: result.brandCoverage,
        pricingReference: {
          currency: result.pricing.currency,
          observedQuoteCount: result.pricing.observedQuoteCount,
          ...(result.pricing.listPriceReference !== undefined ? { listPriceReference: result.pricing.listPriceReference } : {}),
          ...(result.pricing.currentPriceLow !== undefined ? { currentPriceLow: result.pricing.currentPriceLow } : {}),
          ...(result.pricing.currentPriceHigh !== undefined ? { currentPriceHigh: result.pricing.currentPriceHigh } : {}),
          evidenceType: 'ANONYMOUS_OEM_SOURCE_REFERENCE' as const,
          ebayMarketValueVerified: false as const
        },
        fitmentVerdict: {
          status: 'VIN_REQUIRED' as const,
          tone: 'AMBER' as const,
          statusLabel: 'Fitment not verified' as const,
          explanation: 'Enter the buyer VIN for a vehicle-specific catalog verdict. The grouped applications below are potential reference applications only.',
          listingFitmentAllowed: false as const
        },
        imagePresentation,
        applicationSummary: applications,
        applicationGroupTotal: applications.length,
        fitmentRowCount: result.fitmentTotal,
        catalogChecks: result.catalogChecks,
        sellerListingReadiness: {
          status: 'NEEDS_SELLER_FACTS_AND_MARKET_EVIDENCE' as const,
          missingSellerFacts: [
            'Actual seller-item condition',
            'Quantity and package contents',
            'Seller-owned item photographs',
            'Shipping cost and seller acquisition cost',
            'Verified sold-market evidence'
          ],
          ebayMarketValueVerified: false as const,
          finalListingReady: false as const
        },
        dealerIdentityExposed: false as const,
        vinConfirmationRequired: true as const
      };
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
        content: [{ type: 'text', text: oemPartSummary(result, imagePresentation, applications) }],
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
        'Decode a buyer-provided 17-character Toyota, Lexus or Scion VIN and cross-check an exact OEM part number against three anonymous catalog paths. Returns an explicit GREEN Fits, AMBER May fit/not verified, or RED Does not fit verdict. Returns only the VIN last four, never stores the VIN, never exposes dealer identity and never writes to eBay.',
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
        statusLabel: z.enum(['Fits this vehicle', 'Does not fit this vehicle', 'May fit — not verified']),
        verdictTone: z.enum(['GREEN', 'RED', 'AMBER']),
        explanation: z.string(),
        matchingApplications: z.array(z.object({
          make: z.enum(['Lexus', 'Toyota', 'Scion']),
          model: z.string(),
          yearRanges: z.array(z.string())
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
      assertOemResearchAllowed();
      const verification = await vinVerifier(partNumber, vin);
      const structuredContent = {
        partNumber: verification.partNumber,
        vinLastFour: verification.vinLastFour,
        vehicle: verification.vehicle,
        status: verification.status,
        statusLabel: verification.statusLabel,
        verdictTone: verification.verdictTone,
        explanation: verification.explanation,
        matchingApplications: summarizeOemApplications(verification.matchingFitment),
        catalogChecks: verification.catalogChecks,
        listingFitmentAllowed: verification.listingFitmentAllowed,
        vinStored: verification.vinStored,
        dealerIdentityExposed: verification.dealerIdentityExposed
      };
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
    'find_correct_oem_part',
    {
      title: 'Find the correct OEM part for this vehicle',
      description:
        'Buyer-only recovery after verify_oem_part_vin returns RED. Reuses the buyer-provided VIN once to search the same part family and returns GREEN only for one unique VIN-filtered exact part-number match. Multiple or incomplete candidates remain AMBER. Never changes the seller item or listing, never stores or echoes the full VIN, never exposes dealer identity, and never writes to eBay.',
      inputSchema: {
        rejected_part_number: z.string().min(5).max(40),
        vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i)
      },
      outputSchema: {
        rejectedPartNumber: z.string(),
        partFamily: z.string(),
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
        status: z.enum(['EXACT_MATCH', 'MULTIPLE_MATCHES', 'NO_EXACT_MATCH']),
        statusLabel: z.enum(['Correct part found', 'Possible matching parts', 'Correct part not verified']),
        verdictTone: z.enum(['GREEN', 'AMBER']),
        explanation: z.string(),
        matchBasis: z.enum(['VIN_FILTERED_PNC', 'VIN_FILTERED_EXACT_FAMILY', 'NO_UNIQUE_CANDIDATE']),
        candidatePartNumbers: z.array(z.string()).max(5),
        correctPart: z.object({
          identity: z.object({
            partNumber: z.string(),
            description: z.string(),
            alternateNames: z.array(z.string()),
            manufacturerNotes: z.array(z.string()),
            catalogCondition: z.string().optional(),
            catalogFitmentType: z.string().optional(),
            pncCodes: z.array(z.string()),
            replacedBy: z.array(z.string()),
            replaces: z.array(z.string())
          }),
          brandCoverage: z.object({
            catalogBrands: z.array(z.enum(['Lexus', 'Toyota', 'Scion'])),
            fitmentBrands: z.array(z.enum(['Lexus', 'Toyota', 'Scion'])),
            crossoverStatus: z.enum(['SINGLE_BRAND', 'MULTI_BRAND'])
          }),
          pricingReference: z.object({
            currency: z.literal('USD'),
            observedQuoteCount: z.number().int(),
            listPriceReference: z.number().optional(),
            currentPriceLow: z.number().optional(),
            currentPriceHigh: z.number().optional(),
            evidenceType: z.literal('ANONYMOUS_OEM_SOURCE_REFERENCE'),
            ebayMarketValueVerified: z.literal(false)
          }),
          fitmentVerdict: z.object({
            status: z.literal('VIN_MATCHED_CORRECT_PART'),
            tone: z.literal('GREEN'),
            statusLabel: z.literal('Correct part for this vehicle'),
            explanation: z.string(),
            listingFitmentAllowed: z.literal(false)
          }),
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
          applicationSummary: z.array(z.object({
            make: z.enum(['Lexus', 'Toyota', 'Scion']),
            model: z.string(),
            yearRanges: z.array(z.string())
          })),
          applicationGroupTotal: z.number().int(),
          fitmentRowCount: z.number().int(),
          catalogChecks: z.object({
            attempted: z.literal(3),
            exactMatches: z.number().int(),
            unavailable: z.number().int(),
            retrievedAt: z.string()
          }),
          dealerIdentityExposed: z.literal(false),
          vinConfirmationRequired: z.literal(true)
        }).optional(),
        buyerFitmentVerified: z.boolean(),
        sellerListingChanged: z.literal(false),
        eBayWritePerformed: z.literal(false),
        vinStored: z.literal(false),
        dealerIdentityExposed: z.literal(false)
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: {
        ui: { visibility: ['model', 'app'] },
        'openai/toolInvocation/invoking': 'Finding the exact part for this VIN…',
        'openai/toolInvocation/invoked': 'Correct-part search complete'
      }
    },
    async ({ rejected_part_number: rejectedPartNumber, vin }) => {
      assertOemResearchAllowed();
      const correction = await correctPartFinder(rejectedPartNumber, vin);
      let correctPart;
      let partquillMedia: PartQuillMedia[] = [];
      if (correction.correctPart) {
        const prepared = await prepareResearchMedia(correction.correctPart, imageLoader);
        partquillMedia = prepared.partquillMedia;
        correctPart = researchCardData(
          correction.correctPart,
          prepared.imagePresentation,
          {
            status: 'VIN_MATCHED_CORRECT_PART',
            tone: 'GREEN',
            statusLabel: 'Correct part for this vehicle',
            explanation: `${correction.explanation} Buyer purchase assistance only; the seller listing was not changed.`,
            listingFitmentAllowed: false
          }
        );
      }
      const structuredContent = {
        rejectedPartNumber: correction.rejectedPartNumber,
        partFamily: correction.partFamily,
        vinLastFour: correction.vinLastFour,
        vehicle: correction.vehicle,
        status: correction.status,
        statusLabel: correction.statusLabel,
        verdictTone: correction.verdictTone,
        explanation: correction.explanation,
        matchBasis: correction.matchBasis,
        candidatePartNumbers: correction.candidatePartNumbers,
        ...(correctPart ? { correctPart } : {}),
        buyerFitmentVerified: correction.buyerFitmentVerified,
        sellerListingChanged: false as const,
        eBayWritePerformed: false as const,
        vinStored: false as const,
        dealerIdentityExposed: false as const
      };
      const text = correction.status === 'EXACT_MATCH' && correction.correctPart
        ? `GREEN — Correct part found. ${correction.rejectedPartNumber} does not fit the VIN ending ${correction.vinLastFour}; the unique VIN-filtered ${correction.partFamily} is ${correction.correctPart.identity.partNumber}. This is buyer purchase assistance only. The seller item and listing were not changed, the full VIN was not returned or stored, and nothing was written to eBay.`
        : `AMBER — ${correction.statusLabel}. ${correction.explanation} VIN ending ${correction.vinLastFour}. The seller item and listing were not changed, the full VIN was not returned or stored, and nothing was written to eBay.`;
      return {
        structuredContent,
        content: [{ type: 'text', text }],
        _meta: { partquillMedia }
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
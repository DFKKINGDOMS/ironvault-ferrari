import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.js';

export const listingCommandRequestSchema = z.object({
  command: z.string().trim().min(3).max(500)
});

const quantityWords: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

export type CommandPreviewStatus = 'ILLUSTRATIVE_SAMPLE' | 'HELD';

export interface ListingCommandIntent {
  partNumber: string | null;
  price: string | null;
  quantity: number;
  condition: 'New' | 'Used' | 'Remanufactured';
  conditionSource: 'COMMAND' | 'SELLER_DEFAULT_REQUIRES_CONFIRMATION';
  shipping: 'Seller default' | 'Free domestic shipping' | 'Calculated shipping' | 'Local pickup only';
  fitmentMode: 'CATALOG_CONTROLLED' | 'DO_NOT_PUBLISH';
  channel: 'eBay';
}

export interface SellerCommandPreview {
  schemaVersion: '2026-08-27';
  status: CommandPreviewStatus;
  command: string;
  intent: ListingCommandIntent;
  listing: {
    title: string;
    titleLength: number;
    format: 'Buy It Now · GTC';
    sku: string | null;
    description: string;
    category: string | null;
    aspects: Record<string, string>;
    handlingTime: '1 business day';
    returns: '30 days · buyer-paid';
    international: 'Held until origin is verified';
  };
  identity: {
    state: 'ILLUSTRATIVE_NOT_EVIDENCE' | 'NOT_VERIFIED';
    brand: string | null;
    manufacturerPartNumber: string | null;
    productType: string | null;
    sourceLabel: string;
    sourceDetail: string;
  };
  fitment: {
    state: 'NOT_VERIFIED' | 'OMITTED_BY_SELLER';
    totalApplications: number;
    sourceLabel: string;
    sourceDetail: string;
    applications: Array<{ vehicle: string; qualifier: string; state: 'NOT_VERIFIED' }>;
  };
  media: {
    state: 'SELLER_PHOTO_REQUIRED';
    sourceLabel: string;
    sourceDetail: string;
  };
  confirmations: Array<{ id: string; label: string; detail: string }>;
  issues: Array<{ code: string; message: string; blocking: boolean }>;
  recovery: {
    label: 'Find the correct part for a vehicle';
    enabled: true;
    requires: ['17-character VIN', 'part type'];
    privacyNote: string;
  };
  gates: {
    privatePreflight: 'SIMULATION_AVAILABLE' | 'HELD';
    publicEbayWrite: 'DISABLED';
    ebayHandoffUrl: 'https://www.ebay.com/';
  };
  noExternalRequestMade: true;
  fingerprint: string;
}

function normalizePrice(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) return null;
  return parsed.toFixed(2);
}

function quantityFrom(value: string | undefined): number {
  if (!value) return 1;
  const normalized = value.toLowerCase();
  const parsed = quantityWords[normalized] ?? Number(normalized);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : 1;
}

function findPartNumber(command: string): string | null {
  const explicit = command.match(
    /\b(?:part|mpn|oem(?:\s+part)?(?:\s+number)?)\s*(?:number|no\.?)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{3,})\b/i
  )?.[1];
  if (explicit && /\d/.test(explicit)) return explicit.toUpperCase();

  const candidate = command
    .match(/\b[a-z0-9][a-z0-9-]{4,}\b/gi)
    ?.find((token) => /\d/.test(token) && !/^\d{1,4}$/.test(token));
  return candidate?.toUpperCase() ?? null;
}

export function parseListingCommand(command: string): ListingCommandIntent {
  const normalized = command.toLowerCase();
  const explicitPrice = command.match(/\$\s*(\d+(?:\.\d{1,2})?)/)?.[1]
    ?? command.match(/\b(?:for|at|price(?:d)?(?:\s+at)?)\s+(\d+(?:\.\d{1,2})?)\b/i)?.[1];
  const quantityValue = command.match(/\b(?:quantity|qty)\s*[:=]?\s*(\d+)\b/i)?.[1]
    ?? command.match(/\b(?:sell|list|draft)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i)?.[1];
  const explicitCondition = /\bused\b/.test(normalized)
    ? 'Used' as const
    : /\breman(?:ufactured)?\b/.test(normalized)
      ? 'Remanufactured' as const
      : /\bnew\b/.test(normalized)
        ? 'New' as const
        : null;
  const shipping = normalized.includes('local pickup only')
    ? 'Local pickup only' as const
    : normalized.includes('free shipping')
      ? 'Free domestic shipping' as const
      : normalized.includes('calculated shipping')
        ? 'Calculated shipping' as const
        : 'Seller default' as const;

  return {
    partNumber: findPartNumber(command),
    price: normalizePrice(explicitPrice),
    quantity: quantityFrom(quantityValue),
    condition: explicitCondition ?? 'New',
    conditionSource: explicitCondition ? 'COMMAND' : 'SELLER_DEFAULT_REQUIRES_CONFIRMATION',
    shipping,
    fitmentMode: /\bno\s+fitment\b|\bwithout\s+fitment\b/.test(normalized) ? 'DO_NOT_PUBLISH' : 'CATALOG_CONTROLLED',
    channel: 'eBay'
  };
}

function titleGuard(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) return normalized;
  return normalized.slice(0, 80).replace(/\s+\S*$/, '').trim();
}

function buildDescription(intent: ListingCommandIntent, productType: string | null): string {
  const identity = productType ?? 'Automotive replacement part';
  const number = intent.partNumber ?? 'not yet identified';
  return `${identity}, part ${number}. Quantity ${intent.quantity}. Condition is set to ${intent.condition} and must be confirmed against the physical item. Unsupported fitment, origin, contents and media claims remain excluded until evidence is attached.`;
}

export function buildSellerCommandPreview(command: string): SellerCommandPreview {
  const intent = parseListingCommand(command);
  const isIllustrativeFixture = intent.partNumber === '58487514';
  const omittedFitment = intent.fitmentMode === 'DO_NOT_PUBLISH';
  const status: CommandPreviewStatus = isIllustrativeFixture ? 'ILLUSTRATIVE_SAMPLE' : 'HELD';
  const identity = isIllustrativeFixture
    ? {
        state: 'ILLUSTRATIVE_NOT_EVIDENCE' as const,
        brand: 'ACDelco',
        manufacturerPartNumber: intent.partNumber,
        productType: 'Cabin Air Filter',
        sourceLabel: 'Illustrative catalog-adapter fixture',
        sourceDetail: 'Shows the approved filled state. It is not live catalog evidence and cannot authorize an eBay claim.'
      }
    : {
        state: 'NOT_VERIFIED' as const,
        brand: null,
        manufacturerPartNumber: intent.partNumber,
        productType: null,
        sourceLabel: 'Catalog identity not verified',
        sourceDetail: 'A unique authorized catalog result is required before brand, product type, category or fitment can publish.'
      };
  const title = titleGuard(
    isIllustrativeFixture
      ? `ACDelco ${intent.partNumber} Cabin Air Filter OE Replacement ${intent.condition}`
      : `Part ${intent.partNumber ?? 'number required'} — catalog identity required`
  );
  const fitmentApplications = !omittedFitment && isIllustrativeFixture
    ? [
        { vehicle: '2018–2020 Chevrolet Equinox', qualifier: '1.5L Turbo · illustrative row', state: 'NOT_VERIFIED' as const },
        { vehicle: '2018–2020 GMC Terrain', qualifier: '1.5L Turbo · illustrative row', state: 'NOT_VERIFIED' as const }
      ]
    : [];
  const issues: SellerCommandPreview['issues'] = [];
  if (!intent.partNumber) issues.push({ code: 'PART_NUMBER_REQUIRED', message: 'Add a manufacturer part number.', blocking: true });
  if (!intent.price) issues.push({ code: 'PRICE_REQUIRED', message: 'Add the seller-owned Buy It Now price.', blocking: true });
  if (!isIllustrativeFixture) {
    issues.push({
      code: 'CATALOG_LOOKUP_REQUIRED',
      message: 'No unique authorized catalog identity has been attached to this command preview.',
      blocking: true
    });
  } else {
    issues.push({
      code: 'ILLUSTRATIVE_DATA_ONLY',
      message: 'The filled identity and fitment are an explicit UI fixture, not live catalog evidence.',
      blocking: true
    });
  }
  issues.push({ code: 'SELLER_PHOTO_REQUIRED', message: 'Add at least one seller-owned photo before a real submission.', blocking: true });

  const aspects: Record<string, string> = isIllustrativeFixture
    ? { Brand: 'ACDelco', 'Manufacturer Part Number': intent.partNumber ?? '', Type: 'Cabin Air Filter' }
    : intent.partNumber
      ? { 'Manufacturer Part Number': intent.partNumber }
      : {};

  const previewWithoutFingerprint = {
    schemaVersion: '2026-08-27' as const,
    status,
    command,
    intent,
    listing: {
      title,
      titleLength: title.length,
      format: 'Buy It Now · GTC' as const,
      sku: intent.partNumber ? `PQ-${intent.partNumber}` : null,
      description: buildDescription(intent, identity.productType),
      category: isIllustrativeFixture ? 'Air & Fuel Delivery › Filters' : null,
      aspects,
      handlingTime: '1 business day' as const,
      returns: '30 days · buyer-paid' as const,
      international: 'Held until origin is verified' as const
    },
    identity,
    fitment: {
      state: omittedFitment ? 'OMITTED_BY_SELLER' as const : 'NOT_VERIFIED' as const,
      totalApplications: fitmentApplications.length ? 12 : 0,
      sourceLabel: omittedFitment ? 'Seller instruction: do not publish fitment' : 'Fitment not verified',
      sourceDetail: omittedFitment
        ? 'Compatibility rows are excluded from the public payload.'
        : isIllustrativeFixture
          ? 'Twelve rows are represented only to demonstrate the review UI. They remain amber and are not publishable.'
          : 'No compatibility rows will publish until the catalog adapter returns a unique, supported result.',
      applications: fitmentApplications
    },
    media: {
      state: 'SELLER_PHOTO_REQUIRED' as const,
      sourceLabel: 'Seller-owned item photo required',
      sourceDetail: 'Licensed catalog media may assist presentation later, but a placeholder can never enter a listing payload.'
    },
    confirmations: [
      {
        id: 'part-in-hand',
        label: 'This is the exact part I have in hand',
        detail: `The number on the physical item or package matches ${intent.partNumber ?? 'the entered part number'}.`
      },
      {
        id: 'condition',
        label: `Condition = ${intent.condition}`,
        detail: intent.condition === 'New' ? 'Unused and never installed.' : 'The selected condition accurately describes the physical item.'
      }
    ],
    issues,
    recovery: {
      label: 'Find the correct part for a vehicle' as const,
      enabled: true as const,
      requires: ['17-character VIN', 'part type'] as ['17-character VIN', 'part type'],
      privacyNote: 'The full VIN is used transiently for the requested lookup and is not retained by the preview service.'
    },
    gates: {
      privatePreflight: isIllustrativeFixture && intent.price ? 'SIMULATION_AVAILABLE' as const : 'HELD' as const,
      publicEbayWrite: 'DISABLED' as const,
      ebayHandoffUrl: 'https://www.ebay.com/' as const
    },
    noExternalRequestMade: true as const
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(previewWithoutFingerprint)).digest('hex');
  return { ...previewWithoutFingerprint, fingerprint };
}

export function buildSellerUiBootstrap(config: AppConfig) {
  return {
    version: '0.10.0',
    mode: 'private-pilot',
    backendConnected: true,
    ebay: {
      environment: config.EBAY_ENV,
      mode: config.EBAY_MODE,
      writesEnabled: config.ALLOW_EBAY_WRITES,
      handoffUrl: 'https://www.ebay.com/'
    },
    persistence: config.DATABASE_URL ? 'postgres' : config.PILOT_EPHEMERAL_MODE ? 'ephemeral-memory-pilot' : 'memory',
    imageStudio: {
      mode: config.IMAGE_STUDIO_MODE,
      path: '/image-studio'
    },
    defaults: {
      listingFormat: 'Buy It Now · GTC',
      handlingTime: '1 business day',
      domesticShipping: 'Seller default',
      returns: '30 days · buyer-paid',
      international: 'Held until origin is verified'
    },
    safeguards: {
      unknownCatalogClaimsHeld: true,
      sellerPhotoRequired: true,
      dualApproval: true,
      publicEbayWritesDisabled: true
    }
  } as const;
}

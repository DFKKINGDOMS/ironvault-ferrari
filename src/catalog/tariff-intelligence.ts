import type { GmCatalogPart } from './gm-catalog.js';
import { CURRENT_HTS_RELEASE } from './tariff-release.js';

export interface TariffIntelligence {
  state: 'CANDIDATE_REQUIRES_SELLER_REVIEW' | 'NOT_CLASSIFIED';
  hsCode: string | null;
  htsCode: string | null;
  description: string | null;
  confidence: number;
  source: 'USITC_HTS_SNAPSHOT' | 'NONE';
  release: string | null;
  sourceUrl: string;
  basis: string[];
  sellerConfirmationRequired: true;
}

interface TariffRule {
  id: string;
  pattern: RegExp;
  hsCode: string;
  htsCode: string;
  description: string;
  confidence: number;
}

const USITC_SOURCE_URL = 'https://hts.usitc.gov/';

/**
 * Description-driven classification can propose a tariff heading, but it
 * cannot prove composition, principal use, country of origin or a binding CBP
 * classification. Narrow rules therefore return reviewable candidates only.
 */
const tariffRules: readonly TariffRule[] = [
  {
    id: 'brakes-and-servo-brakes',
    pattern: /\b(?:brake|servo[- ]?brake|hydrovac|vacuum\s*(?:cylinder|booster)|master\s*cylinder)\b/i,
    hsCode: '870830',
    htsCode: '8708.30.50.90',
    description: 'Brakes and servo-brakes; parts thereof — for other vehicles — other',
    confidence: 0.98
  },
  {
    id: 'road-wheel-parts',
    pattern: /\b(?:road\s*wheel|wheel\s*hub|hub\s*assembly)\b/i,
    hsCode: '870870',
    htsCode: '8708.70',
    description: 'Road wheels and parts and accessories thereof',
    confidence: 0.9
  },
  {
    id: 'suspension-parts',
    pattern: /\b(?:suspension|shock\s*absorber|strut|control\s*arm)\b/i,
    hsCode: '870880',
    htsCode: '8708.80',
    description: 'Suspension systems and parts thereof (including shock absorbers)',
    confidence: 0.9
  },
  {
    id: 'steering-parts',
    pattern: /\b(?:steering|tie\s*rod|pitman\s*arm|idler\s*arm)\b/i,
    hsCode: '870894',
    htsCode: '8708.94',
    description: 'Steering wheels, steering columns and steering boxes; parts thereof',
    confidence: 0.88
  },
  {
    id: 'mufflers-and-exhaust',
    pattern: /\b(?:muffler|silencer|exhaust\s*(?:pipe|system))\b/i,
    hsCode: '870892',
    htsCode: '8708.92',
    description: 'Silencers (mufflers) and exhaust pipes; parts thereof',
    confidence: 0.9
  },
  {
    id: 'radiators',
    pattern: /\b(?:radiator|radiator\s*core)\b/i,
    hsCode: '870891',
    htsCode: '8708.91',
    description: 'Radiators and parts thereof',
    confidence: 0.9
  }
];

function tariffText(catalog: GmCatalogPart): string {
  return [
    catalog.productType,
    catalog.description,
    ...catalog.applications.flatMap((application) => [
      application.partName,
      application.description,
      application.groupHeading,
      application.componentFamily
    ])
  ].filter(Boolean).join(' · ');
}

export function buildTariffIntelligence(catalog: GmCatalogPart): TariffIntelligence {
  const text = tariffText(catalog);
  const rule = tariffRules.find((candidate) => candidate.pattern.test(text));
  if (!rule) {
    return {
      state: 'NOT_CLASSIFIED',
      hsCode: null,
      htsCode: null,
      description: null,
      confidence: 0,
      source: 'NONE',
      release: null,
      sourceUrl: USITC_SOURCE_URL,
      basis: ['No narrow tariff rule matched the available catalog wording.'],
      sellerConfirmationRequired: true
    };
  }
  return {
    state: 'CANDIDATE_REQUIRES_SELLER_REVIEW',
    hsCode: rule.hsCode,
    htsCode: rule.htsCode,
    description: rule.description,
    confidence: rule.confidence,
    source: 'USITC_HTS_SNAPSHOT',
    release: CURRENT_HTS_RELEASE,
    sourceUrl: USITC_SOURCE_URL,
    basis: [
      `Matched tariff rule ${rule.id}.`,
      `Catalog wording used: ${text.slice(0, 240)}`,
      'The seller or customs reviewer must confirm product function, material, vehicle class and origin before international publication.'
    ],
    sellerConfirmationRequired: true
  };
}

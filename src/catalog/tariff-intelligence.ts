import type { GmCatalogPart } from './gm-catalog.js';
import { CURRENT_HTS_RELEASE } from './tariff-release.js';

export interface TariffAlternative {
  hsCode: string;
  description: string;
  useWhen: string;
}

export interface TariffIntelligence {
  state: 'CANDIDATE_REQUIRES_SELLER_REVIEW';
  hsCode: string;
  htsCode: string;
  description: string;
  confidence: number;
  source: 'USITC_HTS_SNAPSHOT';
  release: string;
  sourceUrl: string;
  classificationMode: 'IDENTITY_RULE' | 'FUNCTION_RULE' | 'AUTOMOTIVE_FALLBACK';
  basis: string[];
  reasoning: string;
  alternatives: TariffAlternative[];
  missingFacts: string[];
  sellerConfirmationRequired: true;
}

interface TariffRule {
  id: string;
  mode: 'IDENTITY_RULE' | 'FUNCTION_RULE';
  pattern: RegExp;
  hsCode: string;
  htsCode: string;
  description: string;
  confidence: number;
  missingFacts: string[];
  alternatives?: TariffAlternative[];
}

const USITC_SOURCE_URL = 'https://hts.usitc.gov/';

const identityRules: readonly TariffRule[] = [
  {
    id: 'iron-steel-screws-bolts-studs',
    mode: 'IDENTITY_RULE',
    pattern: /\b(?:bolt|screw|stud)\b/i,
    hsCode: '731815',
    htsCode: '7318.15',
    description: 'Other screws and bolts, whether or not with their nuts or washers',
    confidence: 0.92,
    missingFacts: ['Base material or alloy', 'Thread and shank diameter', 'Whether entered with a nut or washer']
  },
  {
    id: 'iron-steel-nuts',
    mode: 'IDENTITY_RULE',
    pattern: /\bnut(?:s)?\b/i,
    hsCode: '731816',
    htsCode: '7318.16',
    description: 'Nuts of iron or steel',
    confidence: 0.9,
    missingFacts: ['Base material or alloy', 'Locking design', 'Surface finish']
  },
  {
    id: 'iron-steel-washers',
    mode: 'IDENTITY_RULE',
    pattern: /\bwasher(?:s)?\b/i,
    hsCode: '731822',
    htsCode: '7318.22',
    description: 'Other washers of iron or steel',
    confidence: 0.86,
    missingFacts: ['Base material or alloy', 'Whether the washer is a spring or locking washer']
  },
  {
    id: 'iron-steel-clamps-brackets-clips',
    mode: 'IDENTITY_RULE',
    pattern: /\b(?:clamp|bracket|retainer|clip)\b/i,
    hsCode: '732690',
    htsCode: '7326.90',
    description: 'Other articles of iron or steel',
    confidence: 0.64,
    missingFacts: ['Base material', 'Principal function', 'Whether the article is more specifically provided for elsewhere'],
    alternatives: [{
      hsCode: '870899',
      description: 'Other motor-vehicle parts and accessories',
      useWhen: 'Use only if the item is identifiable as a motor-vehicle part and Section XVII rules do not exclude it.'
    }]
  }
];

const functionRules: readonly TariffRule[] = [
  {
    id: 'brakes-and-servo-brakes',
    mode: 'FUNCTION_RULE',
    pattern: /\b(?:brake|servo[- ]?brake|hydrovac|vacuum\s*(?:cylinder|booster)|master\s*cylinder)\b/i,
    hsCode: '870830',
    htsCode: '8708.30.50.90',
    description: 'Brakes and servo-brakes; parts thereof — for other vehicles — other',
    confidence: 0.98,
    missingFacts: ['Vehicle class', 'Exact brake-system function', 'Material and whether another heading controls']
  },
  {
    id: 'road-wheel-parts',
    mode: 'FUNCTION_RULE',
    pattern: /\b(?:road\s*wheel|wheel\s*hub|hub\s*assembly)\b/i,
    hsCode: '870870',
    htsCode: '8708.70',
    description: 'Road wheels and parts and accessories thereof',
    confidence: 0.9,
    missingFacts: ['Vehicle class', 'Material', 'Whether the item incorporates bearings']
  },
  {
    id: 'suspension-parts',
    mode: 'FUNCTION_RULE',
    pattern: /\b(?:suspension|shock\s*absorber|strut|control\s*arm)\b/i,
    hsCode: '870880',
    htsCode: '8708.80',
    description: 'Suspension systems and parts thereof, including shock absorbers',
    confidence: 0.9,
    missingFacts: ['Vehicle class', 'Exact suspension function', 'Material']
  },
  {
    id: 'steering-parts',
    mode: 'FUNCTION_RULE',
    pattern: /\b(?:steering|tie\s*rod|pitman\s*arm|idler\s*arm)\b/i,
    hsCode: '870894',
    htsCode: '8708.94',
    description: 'Steering wheels, steering columns and steering boxes; parts thereof',
    confidence: 0.88,
    missingFacts: ['Vehicle class', 'Exact steering function', 'Material']
  },
  {
    id: 'mufflers-and-exhaust',
    mode: 'FUNCTION_RULE',
    pattern: /\b(?:muffler|silencer|exhaust\s*(?:pipe|system))\b/i,
    hsCode: '870892',
    htsCode: '8708.92',
    description: 'Silencers (mufflers) and exhaust pipes; parts thereof',
    confidence: 0.9,
    missingFacts: ['Vehicle class', 'Exact exhaust function', 'Material']
  },
  {
    id: 'radiators',
    mode: 'FUNCTION_RULE',
    pattern: /\b(?:radiator|radiator\s*core)\b/i,
    hsCode: '870891',
    htsCode: '8708.91',
    description: 'Radiators and parts thereof',
    confidence: 0.9,
    missingFacts: ['Vehicle class', 'Whether the item is a complete radiator or part', 'Material']
  }
];

function identityText(catalog: GmCatalogPart): string {
  return [catalog.productType, catalog.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' · ')
    .slice(0, 600);
}

export function buildTariffIntelligence(catalog: GmCatalogPart): TariffIntelligence {
  const text = identityText(catalog);
  const rule = identityRules.find((candidate) => candidate.pattern.test(text))
    ?? functionRules.find((candidate) => candidate.pattern.test(text));
  if (rule) {
    return {
      state: 'CANDIDATE_REQUIRES_SELLER_REVIEW',
      hsCode: rule.hsCode,
      htsCode: rule.htsCode,
      description: rule.description,
      confidence: rule.confidence,
      source: 'USITC_HTS_SNAPSHOT',
      release: CURRENT_HTS_RELEASE,
      sourceUrl: USITC_SOURCE_URL,
      classificationMode: rule.mode,
      basis: [
        `Matched identity-first tariff rule ${rule.id}.`,
        `Item identity wording used: ${text || 'No usable identity wording'}.`,
        'Vehicle fitment prose was excluded from classification to prevent adjacent-system contamination.'
      ],
      reasoning: `The candidate follows the item identity itself, not unrelated words in its compatibility rows. ${rule.description} is the narrowest supported six-digit candidate available from the current catalog facts.`,
      alternatives: rule.alternatives ?? [],
      missingFacts: rule.missingFacts,
      sellerConfirmationRequired: true
    };
  }
  return {
    state: 'CANDIDATE_REQUIRES_SELLER_REVIEW',
    hsCode: '870899',
    htsCode: '8708.99',
    description: 'Other parts and accessories of motor vehicles',
    confidence: 0.35,
    source: 'USITC_HTS_SNAPSHOT',
    release: CURRENT_HTS_RELEASE,
    sourceUrl: USITC_SOURCE_URL,
    classificationMode: 'AUTOMOTIVE_FALLBACK',
    basis: [
      `No narrower identity rule matched: ${text || 'catalog identity wording unavailable'}.`,
      'A six-digit automotive fallback is supplied so the draft is never silently blank.',
      'Vehicle fitment prose was excluded from classification to prevent adjacent-system contamination.'
    ],
    reasoning: 'The catalog proves an automotive part identity but does not provide enough composition and function detail for a narrower automated heading.',
    alternatives: [
      { hsCode: '732690', description: 'Other articles of iron or steel', useWhen: 'Consider if the item is a general iron or steel article rather than a vehicle part under Section XVII.' },
      { hsCode: '401699', description: 'Other articles of vulcanized rubber', useWhen: 'Consider if the item is principally a vulcanized-rubber article and not more specifically provided for.' }
    ],
    missingFacts: ['Principal function', 'Base material and construction', 'Vehicle class', 'Country of origin'],
    sellerConfirmationRequired: true
  };
}

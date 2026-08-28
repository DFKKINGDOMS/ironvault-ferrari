import type { GmCatalogPart } from './gm-catalog.js';

export interface EbayCategorySuggestion {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
}

export interface CatalogListingIntelligence {
  category: {
    state: 'EBAY_TAXONOMY_VERIFIED' | 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION' | 'NOT_CLASSIFIED';
    source: 'EBAY_TAXONOMY_API' | 'PARTQUILL_CLASSIFIER' | 'NONE';
    categoryId: string | null;
    categoryName: string | null;
    categoryPath: string | null;
    query: string;
    confidence: number;
    basis: string[];
  };
  shipping: {
    state: 'ESTIMATED_REQUIRES_CONFIRMATION' | 'MEASUREMENT_REQUIRED';
    source: 'APPROVED_PRODUCT_FAMILY_PRESET' | 'MEASURED_VALUES_REQUIRED';
    profileId: string | null;
    profileLabel: string | null;
    packageType: 'BOX' | 'MAILER' | 'TUBE' | 'FREIGHT' | null;
    estimatedItemWeightLb: { min: number; max: number; suggested: number } | null;
    suggestedPackageIn: { length: number; width: number; height: number } | null;
    dimensionalWeightLb: number | null;
    estimatedBillableWeightLb: number | null;
    dimDivisor: 139;
    confidence: number;
    basis: string[];
    confirmationRequired: true;
  };
}

interface IntelligenceRule {
  id: string;
  profileLabel: string;
  pattern: RegExp;
  categoryName: string;
  categoryPath: string;
  categoryKeywords: string;
  packageType: CatalogListingIntelligence['shipping']['packageType'];
  itemWeight: { min: number; max: number; suggested: number };
  packageIn: { length: number; width: number; height: number };
  confidence: number;
}

const motorsRoot = 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories';

const rules: IntelligenceRule[] = [
  {
    id: 'air-filter-element',
    profileLabel: 'Small boxed filter',
    pattern: /\b(?:air\s*cleaner|air\s*filter|filter\s*element|element[^;,.]{0,30}cleaner|cleaner[^;,.]{0,30}element)\b/i,
    categoryName: 'Air Filters',
    categoryPath: `${motorsRoot} › Air & Fuel Delivery › Air Filters`,
    categoryKeywords: 'automotive air cleaner filter element',
    packageType: 'BOX',
    itemWeight: { min: 0.25, max: 1.5, suggested: 0.75 },
    packageIn: { length: 8, width: 8, height: 4 },
    confidence: 0.9
  },
  {
    id: 'brake-booster',
    profileLabel: 'Large mechanical component',
    pattern: /\b(?:power\s*brake|brake\s*booster|vacuum\s*booster|hydrovac)\b/i,
    categoryName: 'Brake Boosters & Parts',
    categoryPath: `${motorsRoot} › Brakes & Brake Parts › Brake Boosters & Parts`,
    categoryKeywords: 'automotive brake booster part',
    packageType: 'BOX',
    itemWeight: { min: 5, max: 25, suggested: 14 },
    packageIn: { length: 18, width: 15, height: 12 },
    confidence: 0.84
  },
  {
    id: 'master-cylinder',
    profileLabel: 'Medium dense component',
    pattern: /\bmaster\s*cyl(?:inder)?\b/i,
    categoryName: 'Master Cylinders',
    categoryPath: `${motorsRoot} › Brakes & Brake Parts › Master Cylinders`,
    categoryKeywords: 'automotive brake master cylinder',
    packageType: 'BOX',
    itemWeight: { min: 2, max: 12, suggested: 6 },
    packageIn: { length: 14, width: 10, height: 8 },
    confidence: 0.88
  },
  {
    id: 'gasket-seal',
    profileLabel: 'Flat small-parts mailer',
    pattern: /\b(?:gasket|seal|o[ -]?ring|packing)\b/i,
    categoryName: 'Gaskets, Seals & O-Rings',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Gaskets, Seals & O-Rings`,
    categoryKeywords: 'automotive gasket seal o-ring',
    packageType: 'MAILER',
    itemWeight: { min: 0.05, max: 1.5, suggested: 0.35 },
    packageIn: { length: 10, width: 8, height: 1 },
    confidence: 0.78
  },
  {
    id: 'lighting-switch-control',
    profileLabel: 'Small electrical component box',
    pattern: /\b(?:(?:lamp|headlamp|light)[^;,.]{0,35}(?:switch|control)|(?:switch|control)[^;,.]{0,35}(?:lamp|headlamp|light))\b/i,
    categoryName: 'Lighting Switches & Controls',
    categoryPath: `${motorsRoot} › Lighting & Lamps › Switches & Controls`,
    categoryKeywords: 'automotive headlamp lighting switch control',
    packageType: 'BOX',
    itemWeight: { min: 0.1, max: 2, suggested: 0.6 },
    packageIn: { length: 8, width: 6, height: 4 },
    confidence: 0.86
  },
  {
    id: 'sensor-switch-relay',
    profileLabel: 'Small electrical component box',
    pattern: /\b(?:sensor|switch|relay|solenoid|sending\s*unit)\b/i,
    categoryName: 'Sensors & Switches',
    categoryPath: `${motorsRoot} › Electrical & Ignition › Sensors & Switches`,
    categoryKeywords: 'automotive electrical sensor switch relay',
    packageType: 'BOX',
    itemWeight: { min: 0.1, max: 3, suggested: 0.75 },
    packageIn: { length: 8, width: 6, height: 4 },
    confidence: 0.76
  },
  {
    id: 'lamp-lens',
    profileLabel: 'Protected lighting component box',
    pattern: /\b(?:lamp|light|lens|bezel|headlamp|taillamp|tail\s*lamp)\b/i,
    categoryName: 'Lighting & Lamps',
    categoryPath: `${motorsRoot} › Lighting & Lamps`,
    categoryKeywords: 'automotive lamp light lens bezel',
    packageType: 'BOX',
    itemWeight: { min: 0.25, max: 12, suggested: 3 },
    packageIn: { length: 16, width: 12, height: 8 },
    confidence: 0.74
  },
  {
    id: 'steering-knuckle-hub',
    profileLabel: 'Heavy mechanical component box',
    pattern: /\b(?:steering\s*knuckle|spindle|wheel\s*hub|hub\s*assembly)\b/i,
    categoryName: 'Wheel Hubs, Bearings & Parts',
    categoryPath: `${motorsRoot} › Steering & Suspension › Wheel Hubs, Bearings & Parts`,
    categoryKeywords: 'automotive steering knuckle spindle wheel hub',
    packageType: 'BOX',
    itemWeight: { min: 8, max: 40, suggested: 22 },
    packageIn: { length: 16, width: 14, height: 12 },
    confidence: 0.83
  },
  {
    id: 'bearing-bushing',
    profileLabel: 'Small dense component box',
    pattern: /\b(?:bearing|bushing|race)\b/i,
    categoryName: 'Bearings & Bushings',
    categoryPath: `${motorsRoot} › Steering & Suspension › Bearings & Bushings`,
    categoryKeywords: 'automotive bearing bushing race',
    packageType: 'BOX',
    itemWeight: { min: 0.1, max: 10, suggested: 2 },
    packageIn: { length: 9, width: 7, height: 5 },
    confidence: 0.7
  },
  {
    id: 'molding-trim',
    profileLabel: 'Long trim carton or tube',
    pattern: /\b(?:molding|moulding|trim|weatherstrip|ornament|emblem)\b/i,
    categoryName: 'Moldings & Trim',
    categoryPath: `${motorsRoot} › Exterior Parts & Accessories › Moldings & Trim`,
    categoryKeywords: 'automotive exterior molding trim ornament emblem',
    packageType: 'TUBE',
    itemWeight: { min: 0.1, max: 8, suggested: 2 },
    packageIn: { length: 48, width: 6, height: 6 },
    confidence: 0.69
  },
  {
    id: 'glass',
    profileLabel: 'Fragile oversize freight pack',
    pattern: /\b(?:windshield|windscreen|door\s*glass|quarter\s*glass|back\s*glass)\b/i,
    categoryName: 'Auto Glass',
    categoryPath: `${motorsRoot} › Exterior Parts & Accessories › Glass & Window Parts`,
    categoryKeywords: 'automotive windshield window glass',
    packageType: 'FREIGHT',
    itemWeight: { min: 12, max: 70, suggested: 35 },
    packageIn: { length: 64, width: 38, height: 8 },
    confidence: 0.72
  },
  {
    id: 'engine-transmission-assembly',
    profileLabel: 'Freight pallet',
    pattern: /\b(?:engine\s*assembly|motor\s*assembly|transmission\s*assembly|rear\s*axle\s*assembly)\b/i,
    categoryName: 'Complete Engines or Transmissions',
    categoryPath: `${motorsRoot} › Engines & Engine Parts`,
    categoryKeywords: 'automotive complete engine transmission assembly',
    packageType: 'FREIGHT',
    itemWeight: { min: 150, max: 900, suggested: 400 },
    packageIn: { length: 48, width: 40, height: 42 },
    confidence: 0.68
  }
];

function intelligenceText(catalog: GmCatalogPart): string {
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

function categoryQuery(catalog: GmCatalogPart, keywords: string): string {
  const division = catalog.divisions[0] ?? catalog.manufacturer;
  return `${division} ${keywords} ${catalog.description ?? ''} ${catalog.partNumber}`.replace(/\s+/g, ' ').trim();
}

export function buildCatalogListingIntelligence(catalog: GmCatalogPart): CatalogListingIntelligence {
  const text = intelligenceText(catalog);
  const rule = rules.find((candidate) => candidate.pattern.test(text));
  if (!rule) {
    return {
      category: {
        state: 'NOT_CLASSIFIED',
        source: 'NONE',
        categoryId: null,
        categoryName: null,
        categoryPath: null,
        query: categoryQuery(catalog, 'automotive replacement part'),
        confidence: 0,
        basis: ['No sufficiently specific PartQuill product-family rule matched the catalog wording.']
      },
      shipping: {
        state: 'MEASUREMENT_REQUIRED',
        source: 'MEASURED_VALUES_REQUIRED',
        profileId: null,
        profileLabel: null,
        packageType: null,
        estimatedItemWeightLb: null,
        suggestedPackageIn: null,
        dimensionalWeightLb: null,
        estimatedBillableWeightLb: null,
        dimDivisor: 139,
        confidence: 0,
        basis: ['Weight and dimensions cannot be safely inferred from the available catalog wording.'],
        confirmationRequired: true
      }
    };
  }

  const dimensionalWeight = Math.ceil(
    (rule.packageIn.length * rule.packageIn.width * rule.packageIn.height) / 139
  );
  return {
    category: {
      state: 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION',
      source: 'PARTQUILL_CLASSIFIER',
      categoryId: null,
      categoryName: rule.categoryName,
      categoryPath: rule.categoryPath,
      query: categoryQuery(catalog, rule.categoryKeywords),
      confidence: rule.confidence,
      basis: [
        `Matched PartQuill product-family rule ${rule.id}.`,
        `Catalog wording used: ${text.slice(0, 240)}`
      ]
    },
    shipping: {
      state: 'ESTIMATED_REQUIRES_CONFIRMATION',
      source: 'APPROVED_PRODUCT_FAMILY_PRESET',
      profileId: rule.id,
      profileLabel: rule.profileLabel,
      packageType: rule.packageType,
      estimatedItemWeightLb: rule.itemWeight,
      suggestedPackageIn: rule.packageIn,
      dimensionalWeightLb: dimensionalWeight,
      estimatedBillableWeightLb: Math.max(Math.ceil(rule.itemWeight.suggested), dimensionalWeight),
      dimDivisor: 139,
      confidence: Math.max(0.4, rule.confidence - 0.18),
      basis: [
        `PartQuill approved automotive package preset: ${rule.profileLabel} (${rule.id}).`,
        'This is a product-family starting point, not a measured item or carrier promise.',
        'DIM estimate uses L × W × H ÷ 139 and rounds up; the carrier bills the greater of dimensional or actual weight.'
      ],
      confirmationRequired: true
    }
  };
}

export function applyEbayCategorySuggestion(
  intelligence: CatalogListingIntelligence,
  suggestion: EbayCategorySuggestion
): CatalogListingIntelligence {
  return {
    ...intelligence,
    category: {
      ...intelligence.category,
      state: 'EBAY_TAXONOMY_VERIFIED',
      source: 'EBAY_TAXONOMY_API',
      categoryId: suggestion.categoryId,
      categoryName: suggestion.categoryName,
      categoryPath: suggestion.categoryPath,
      confidence: 1,
      basis: [
        `eBay Taxonomy API returned leaf category ${suggestion.categoryId}.`,
        ...intelligence.category.basis
      ]
    }
  };
}
import type { GmCatalogPart } from './gm-catalog.js';

export interface EbayCategorySuggestion {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
}

export interface CatalogListingIntelligence {
  category: {
    state: 'EBAY_TAXONOMY_VERIFIED' | 'EBAY_OFFICIAL_LEAF_REQUIRES_REVIEW' | 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION' | 'NOT_CLASSIFIED';
    source: 'EBAY_TAXONOMY_API' | 'EBAY_OFFICIAL_CATEGORY_FILE' | 'PARTQUILL_CLASSIFIER' | 'NONE';
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
    productFamilyProfileId: string | null;
    profileLabel: string | null;
    packageType: 'BOX' | 'MAILER' | 'TUBE' | 'FREIGHT' | null;
    packageSelectionState: 'SMALLEST_SAVED_PACKAGE_ESTIMATE' | 'CUSTOM_PACKAGE_REQUIRED' | 'FREIGHT_REQUIRED' | 'MEASUREMENT_REQUIRED';
    shippingClass: 'PARCEL' | 'TRUCK_FREIGHT' | 'SPECIAL_TRUCK_FREIGHT' | 'MEASUREMENT_REQUIRED';
    estimatedItemWeightLb: { min: number; max: number; suggested: number } | null;
    estimatedItemPackageIn: { length: number; width: number; height: number } | null;
    suggestedPackageIn: { length: number; width: number; height: number } | null;
    emptyPackageWeightLb: number | null;
    estimatedPackedWeightLb: number | null;
    dimensionalWeightLb: number | null;
    estimatedBillableWeightLb: number | null;
    dimDivisor: 139;
    checkoutGate: boolean;
    confidence: number;
    basis: string[];
    confirmationRequired: true;
  };
}

interface IntelligenceRule {
  id: string;
  profileLabel: string;
  pattern: RegExp;
  officialCategoryId?: string;
  categoryName: string;
  categoryPath: string;
  categoryKeywords: string;
  packageType: CatalogListingIntelligence['shipping']['packageType'];
  itemWeight: { min: number; max: number; suggested: number };
  packageIn: { length: number; width: number; height: number };
  confidence: number;
}

const motorsRoot = 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories';
const officialMotorsTreeVersion = 'US_JUNE_2026';


export interface IronVaultPackageProfile {
  name: `P${number}`;
  length: number;
  width: number;
  height: number;
  emptyPackageWeightLb: number;
}

/**
 * The seller's saved Shopify package ladder, shared with the Deere workflow.
 * The last value is empty-carton weight, never product capacity.
 */
export const IRONVAULT_PACKAGE_LADDER: readonly IronVaultPackageProfile[] = [
  ['P1', 6, 4, 1, 0.5],
  ['P2', 6, 4, 2, 0.5],
  ['P3', 8, 6, 2, 1],
  ['P4', 8, 6, 4, 1],
  ['P5', 12, 9, 4, 1],
  ['P6', 10, 8, 4, 1],
  ['P7', 12, 10, 6, 1],
  ['P8', 14, 12, 6, 1],
  ['P9', 16, 12, 8, 1],
  ['P10', 18, 14, 8, 1],
  ['P11', 20, 16, 10, 2],
  ['P12', 24, 18, 12, 2],
  ['P13', 28, 20, 14, 3],
  ['P14', 32, 24, 18, 3],
  ['P15', 36, 24, 20, 4],
  ['P16', 42, 30, 24, 10],
  ['P17', 48, 40, 28, 20]
].map(([name, length, width, height, emptyPackageWeightLb]) => ({
  name: name as `P${number}`,
  length: length as number,
  width: width as number,
  height: height as number,
  emptyPackageWeightLb: emptyPackageWeightLb as number
}));

function packageFits(
  required: { length: number; width: number; height: number },
  profile: IronVaultPackageProfile
): boolean {
  const item = [required.length, required.width, required.height].sort((a, b) => b - a);
  const box = [profile.length, profile.width, profile.height].sort((a, b) => b - a);
  return item.every((value, index) => value <= (box[index] ?? 0));
}

export function selectSmallestIronVaultPackage(
  required: { length: number; width: number; height: number }
): IronVaultPackageProfile | null {
  return [...IRONVAULT_PACKAGE_LADDER]
    .filter((profile) => packageFits(required, profile))
    .sort((left, right) =>
      (left.length * left.width * left.height) - (right.length * right.width * right.height)
      || Number(left.name.slice(1)) - Number(right.name.slice(1))
    )[0] ?? null;
}

const rules: IntelligenceRule[] = [
  {
    id: 'small-hardware',
    profileLabel: 'Ferrari/Deere small-hardware estimate',
    pattern: /\b(?:circlip|retaining\s*ring|snap\s*ring|washer|bolt|screw|dowel|knob)\b/i,
    categoryName: 'Other Engine Parts',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Other Engine Parts`,
    categoryKeywords: 'automotive engine mounting hardware bolt screw washer retaining ring',
    packageType: 'BOX',
    itemWeight: { min: 0.05, max: 1.5, suggested: 0.5 },
    packageIn: { length: 8, width: 6, height: 3 },
    confidence: 0.82
  },
  {
    id: 'exhaust-silencer',
    profileLabel: 'Ferrari exhaust-silencer estimate',
    pattern: /\b(?:main\s*silencer|muffler)\b/i,
    categoryName: 'Mufflers & Resonators',
    categoryPath: `${motorsRoot} › Exhaust & Emission Systems › Mufflers & Resonators`,
    categoryKeywords: 'automotive exhaust muffler silencer',
    packageType: 'BOX',
    itemWeight: { min: 15, max: 45, suggested: 28 },
    packageIn: { length: 38, width: 18, height: 12 },
    confidence: 0.84
  },
  {
    id: 'exhaust-manifold',
    profileLabel: 'Ferrari exhaust-manifold estimate',
    pattern: /\b(?:front|rear|exhaust)\s*manifold\b/i,
    categoryName: 'Exhaust Manifolds & Headers',
    categoryPath: `${motorsRoot} › Exhaust & Emission Systems › Manifolds & Headers`,
    categoryKeywords: 'automotive exhaust manifold header',
    packageType: 'BOX',
    itemWeight: { min: 8, max: 35, suggested: 18 },
    packageIn: { length: 34, width: 16, height: 10 },
    confidence: 0.82
  },
  {
    id: 'flywheel',
    profileLabel: 'Ferrari flywheel estimate',
    pattern: /\bflywheel\b/i,
    categoryName: 'Flywheels & Flexplates',
    categoryPath: `${motorsRoot} › Transmission & Drivetrain › Flywheels & Flexplates`,
    categoryKeywords: 'automotive flywheel flexplate',
    packageType: 'BOX',
    itemWeight: { min: 12, max: 40, suggested: 24 },
    packageIn: { length: 16, width: 16, height: 6 },
    confidence: 0.86
  },
  {
    id: 'connecting-rod',
    profileLabel: 'Ferrari connecting-rod estimate',
    pattern: /\b(?:connecting\s*rod|con\s*rod)\b/i,
    categoryName: 'Connecting Rods & Parts',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Connecting Rods & Parts`,
    categoryKeywords: 'automotive engine connecting rod',
    packageType: 'BOX',
    itemWeight: { min: 1.5, max: 8, suggested: 4 },
    packageIn: { length: 13, width: 7, height: 5 },
    confidence: 0.84
  },
  {
    id: 'pulley-gear',
    profileLabel: 'Ferrari pulley/gear estimate',
    pattern: /\b(?:damper\s*pulley|pulley|timing\s*gear)\b/i,
    categoryName: 'Pulleys & Tensioners',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Pulleys & Tensioners`,
    categoryKeywords: 'automotive engine pulley timing gear',
    packageType: 'BOX',
    itemWeight: { min: 2, max: 15, suggested: 7 },
    packageIn: { length: 14, width: 14, height: 6 },
    confidence: 0.8
  },
  {
    id: 'timing-chain',
    profileLabel: 'Ferrari timing-chain estimate',
    pattern: /\b(?:timing\s*)?chain\b/i,
    categoryName: 'Timing Chains',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Timing Components & Kits`,
    categoryKeywords: 'automotive engine timing chain',
    packageType: 'BOX',
    itemWeight: { min: 1, max: 7, suggested: 3 },
    packageIn: { length: 11, width: 9, height: 4 },
    confidence: 0.82
  },
  {
    id: 'engine-valve',
    profileLabel: 'Ferrari engine-valve estimate',
    pattern: /\b(?:inlet|intake|exhaust)?\s*valve\b/i,
    categoryName: 'Valves',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Valves`,
    categoryKeywords: 'automotive engine intake exhaust valve',
    packageType: 'BOX',
    itemWeight: { min: 0.2, max: 3, suggested: 1.25 },
    packageIn: { length: 12, width: 5, height: 4 },
    confidence: 0.79
  },
  {
    id: 'piston-pin',
    profileLabel: 'Ferrari piston-pin estimate',
    pattern: /\b(?:gudgeon|piston)\s*pin\b/i,
    categoryName: 'Pistons, Rings & Rods',
    categoryPath: `${motorsRoot} › Engines & Engine Parts › Pistons, Rings & Rods`,
    categoryKeywords: 'automotive engine piston pin gudgeon pin',
    packageType: 'BOX',
    itemWeight: { min: 0.5, max: 4, suggested: 1.5 },
    packageIn: { length: 9, width: 5, height: 4 },
    confidence: 0.8
  },
  {
    id: 'heat-shield',
    profileLabel: 'Ferrari heat-shield estimate',
    pattern: /\bheat\s*shield\b/i,
    categoryName: 'Heat Shields',
    categoryPath: `${motorsRoot} › Exhaust & Emission Systems › Heat Shields`,
    categoryKeywords: 'automotive exhaust heat shield',
    packageType: 'BOX',
    itemWeight: { min: 1, max: 8, suggested: 4 },
    packageIn: { length: 22, width: 16, height: 5 },
    confidence: 0.76
  },
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
    id: 'power-brake-repair-kit',
    profileLabel: 'Small brake repair-kit box',
    pattern: /\b(?:(?:power\s*brake|brake)[^;,.]{0,40}(?:repair|overhaul)\s*kit|(?:repair|overhaul)\s*kit[^;,.]{0,40}(?:power\s*brake|brake))\b/i,
    officialCategoryId: '174021',
    categoryName: 'Brake Boosters',
    categoryPath: `${motorsRoot} › Brakes & Brake Parts › Brake Boosters`,
    categoryKeywords: 'automotive power brake vacuum booster cylinder repair overhaul kit',
    packageType: 'BOX',
    itemWeight: { min: 0.25, max: 3, suggested: 1 },
    packageIn: { length: 9, width: 7, height: 4 },
    confidence: 0.88
  },
  {
    id: 'brake-booster',
    profileLabel: 'Large mechanical component',
    pattern: /\b(?:brake\s*booster|vacuum\s*(?:booster|cylinder)|hydrovac|servo[- ]?brake)\b/i,
    officialCategoryId: '174021',
    categoryName: 'Brake Boosters',
    categoryPath: `${motorsRoot} › Brakes & Brake Parts › Brake Boosters`,
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
    id: 'spacer-plate-bracket',
    profileLabel: 'Ferrari fabricated-part estimate',
    pattern: /\b(?:spacer|plate|bracket|support)\b/i,
    categoryName: 'Brackets & Hardware',
    categoryPath: `${motorsRoot} › Other Parts & Accessories`,
    categoryKeywords: 'automotive bracket support spacer plate hardware',
    packageType: 'BOX',
    itemWeight: { min: 0.25, max: 8, suggested: 3 },
    packageIn: { length: 14, width: 10, height: 5 },
    confidence: 0.68
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

function embeddedOfficialCategory(
  catalog: GmCatalogPart,
  query: string,
  fallbackBasis: string[]
): CatalogListingIntelligence['category'] | null {
  const embedded = catalog.ebayCategory;
  if (!embedded || !/^\d+$/.test(embedded.categoryId) || !embedded.categoryName.trim()) return null;
  const exact = embedded.classificationMode === 'RULE_EXACT_LEAF';
  return {
    state: exact ? 'EBAY_TAXONOMY_VERIFIED' : 'EBAY_OFFICIAL_LEAF_REQUIRES_REVIEW',
    source: 'EBAY_OFFICIAL_CATEGORY_FILE',
    categoryId: embedded.categoryId,
    categoryName: embedded.categoryName,
    categoryPath: embedded.categoryPath,
    query,
    confidence: exact ? 0.95 : 0.25,
    basis: [
      `Official eBay US Motors leaf ${embedded.categoryId} from category tree ${embedded.categoryTreeId} (${embedded.categoryTreeVersion}).`,
      exact
        ? 'PartQuill matched the catalog product family to an exact active leaf name.'
        : 'This is the active Other Car & Truck Parts fallback; review the leaf before submission.',
      ...fallbackBasis
    ]
  };
}

function emptyShipping(): CatalogListingIntelligence['shipping'] {
  return {
    state: 'MEASUREMENT_REQUIRED',
    source: 'MEASURED_VALUES_REQUIRED',
    profileId: null,
    productFamilyProfileId: null,
    profileLabel: null,
    packageType: null,
    packageSelectionState: 'MEASUREMENT_REQUIRED',
    shippingClass: 'MEASUREMENT_REQUIRED',
    estimatedItemWeightLb: null,
    estimatedItemPackageIn: null,
    suggestedPackageIn: null,
    emptyPackageWeightLb: null,
    estimatedPackedWeightLb: null,
    dimensionalWeightLb: null,
    estimatedBillableWeightLb: null,
    dimDivisor: 139,
    checkoutGate: true,
    confidence: 0,
    basis: ['Weight and dimensions cannot be safely inferred from the available catalog wording.'],
    confirmationRequired: true
  };
}

export function buildCatalogListingIntelligence(catalog: GmCatalogPart): CatalogListingIntelligence {
  const text = intelligenceText(catalog);
  const matchingRules = rules.filter((candidate) => candidate.pattern.test(text));
  const rule = matchingRules.find((candidate) => candidate.officialCategoryId) ?? matchingRules[0];
  const query = categoryQuery(catalog, rule?.categoryKeywords ?? 'automotive replacement part');
  const ruleBasis = rule
    ? [`Matched PartQuill product-family rule ${rule.id}.`, `Catalog wording used: ${text.slice(0, 240)}`]
    : ['No sufficiently specific PartQuill product-family rule matched the catalog wording.'];
  const embeddedCategory = embeddedOfficialCategory(catalog, query, ruleBasis);
  const exactRuleCategory: CatalogListingIntelligence['category'] | null = rule?.officialCategoryId
    ? {
        state: 'EBAY_TAXONOMY_VERIFIED',
        source: 'EBAY_OFFICIAL_CATEGORY_FILE',
        categoryId: rule.officialCategoryId,
        categoryName: rule.categoryName,
        categoryPath: rule.categoryPath,
        query,
        confidence: Math.max(0.95, rule.confidence),
        basis: [
          `Official eBay US Motors leaf ${rule.officialCategoryId} from category tree 100 (${officialMotorsTreeVersion}).`,
          `Matched PartQuill product-family rule ${rule.id} to the exact active leaf.`,
          ...ruleBasis
        ]
      }
    : null;

  // A previously stored generic fallback must never outrank a current exact
  // product-family leaf. A stored exact assignment still remains authoritative.
  const category: CatalogListingIntelligence['category'] = embeddedCategory?.state === 'EBAY_TAXONOMY_VERIFIED'
    ? embeddedCategory
    : exactRuleCategory ?? embeddedCategory ?? (rule
    ? {
        state: 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION',
        source: 'PARTQUILL_CLASSIFIER',
        categoryId: null,
        categoryName: rule.categoryName,
        categoryPath: rule.categoryPath,
        query,
        confidence: rule.confidence,
        basis: ruleBasis
      }
    : {
        state: 'NOT_CLASSIFIED',
        source: 'NONE',
        categoryId: null,
        categoryName: null,
        categoryPath: null,
        query,
        confidence: 0,
        basis: ruleBasis
      });

  if (!rule) return { category, shipping: emptyShipping() };

  const shippingClass = rule.itemWeight.suggested > 500
    ? 'SPECIAL_TRUCK_FREIGHT' as const
    : rule.itemWeight.suggested > 150 || rule.packageType === 'FREIGHT'
      ? 'TRUCK_FREIGHT' as const
      : 'PARCEL' as const;
  const selectedPackage = shippingClass === 'PARCEL'
    ? selectSmallestIronVaultPackage(rule.packageIn)
    : null;
  const packageSelectionState = shippingClass !== 'PARCEL'
    ? 'FREIGHT_REQUIRED' as const
    : selectedPackage
      ? 'SMALLEST_SAVED_PACKAGE_ESTIMATE' as const
      : 'CUSTOM_PACKAGE_REQUIRED' as const;
  const suggestedPackage = selectedPackage
    ? { length: selectedPackage.length, width: selectedPackage.width, height: selectedPackage.height }
    : rule.packageIn;
  const emptyPackageWeightLb = selectedPackage?.emptyPackageWeightLb ?? null;
  const estimatedPackedWeightLb = Number(
    (rule.itemWeight.suggested + (emptyPackageWeightLb ?? 0)).toFixed(2)
  );
  const dimensionalWeight = shippingClass === 'PARCEL'
    ? Math.ceil((suggestedPackage.length * suggestedPackage.width * suggestedPackage.height) / 139)
    : null;

  return {
    category,
    shipping: {
      state: 'ESTIMATED_REQUIRES_CONFIRMATION',
      source: 'APPROVED_PRODUCT_FAMILY_PRESET',
      profileId: selectedPackage?.name ?? null,
      productFamilyProfileId: rule.id,
      profileLabel: selectedPackage
        ? `${selectedPackage.name} · ${selectedPackage.length} × ${selectedPackage.width} × ${selectedPackage.height} in · ${rule.profileLabel}`
        : shippingClass === 'PARCEL'
          ? `Custom package required · ${rule.profileLabel}`
          : `Freight review · ${rule.profileLabel}`,
      packageType: rule.packageType,
      packageSelectionState,
      shippingClass,
      estimatedItemWeightLb: rule.itemWeight,
      estimatedItemPackageIn: rule.packageIn,
      suggestedPackageIn: suggestedPackage,
      emptyPackageWeightLb,
      estimatedPackedWeightLb,
      dimensionalWeightLb: dimensionalWeight,
      estimatedBillableWeightLb: dimensionalWeight == null
        ? null
        : Math.max(Math.ceil(estimatedPackedWeightLb), dimensionalWeight),
      dimDivisor: 139,
      checkoutGate: packageSelectionState !== 'SMALLEST_SAVED_PACKAGE_ESTIMATE',
      confidence: Math.max(0.4, rule.confidence - 0.18),
      basis: [
        `PartQuill automotive family estimate: ${rule.profileLabel} (${rule.id}).`,
        selectedPackage
          ? `Dimension-first IronVault selector chose the smallest saved carton that contains the estimate: ${selectedPackage.name}.`
          : packageSelectionState === 'CUSTOM_PACKAGE_REQUIRED'
            ? 'The estimate exceeds every P1–P17 saved carton; a reusable custom package is required.'
            : 'The estimated item requires freight review and cannot inherit a parcel carton.',
        'P1–P17 carton weights are empty-package weights, never maximum product capacity.',
        'This is a working estimate, not a measured item or carrier promise.',
        ...(dimensionalWeight == null
          ? []
          : ['DIM estimate uses L × W × H ÷ 139 and rounds up; billable weight uses the greater of packed or dimensional weight.'])
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

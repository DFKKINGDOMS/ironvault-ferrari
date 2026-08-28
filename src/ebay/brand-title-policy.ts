export const EBAY_INTELLECTUAL_PROPERTY_POLICY_URL =
  'https://www.ebay.com/help/policies/listing-policies/selling-policies/intellectual-property-vero-program?id=4349';
export const EBAY_VERO_PROFILE_INDEX_URL =
  'https://www.ebay.com/sellercenter/resources/verified-rights-owner-profiles';

export type BrandRelationship =
  | 'GENUINE_BRANDED_ITEM'
  | 'AFTERMARKET_COMPATIBLE'
  | 'AUTHENTICITY_NOT_CONFIRMED';

export interface BrandTitlePolicyInput {
  itemBrand: string | null;
  compatibleBrand: string | null;
  relationship: BrandRelationship;
  manufacturerPartNumber: string;
  productName: string;
  applicationYears?: string | null;
}

export interface BrandTitlePolicyResult {
  title: string;
  state: 'COMPLIANT' | 'SELLER_CONFIRMATION_REQUIRED';
  rule: 'GENUINE_BRAND_ALLOWED' | 'FITS_FOR_PREFIX_REQUIRED' | 'AUTHENTICITY_HELD';
  itemBrand: string | null;
  compatibleBrand: string | null;
  veroParticipant: string | null;
  registryCompleteness: 'OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE';
  sourceUrl: string;
  profileIndexUrl: string;
  sellerConfirmationRequired: boolean;
  explanation: string;
}

const brandOwnerProfiles: Readonly<Record<string, string>> = {
  acdelco: 'General Motors',
  buick: 'General Motors',
  cadillac: 'General Motors',
  chevrolet: 'General Motors',
  generalmotors: 'General Motors',
  gmc: 'General Motors',
  oldsmobile: 'General Motors',
  pontiac: 'General Motors',
  johndeere: 'John Deere'
};

function brandKey(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const preservedTitleTokens: Readonly<Record<string, string>> = {
  acdelco: 'ACDelco',
  abs: 'ABS',
  ac: 'AC',
  awd: 'AWD',
  cv: 'CV',
  ecm: 'ECM',
  ecu: 'ECU',
  egr: 'EGR',
  gm: 'GM',
  hvac: 'HVAC',
  nos: 'NOS',
  oe: 'OE',
  oem: 'OEM',
  pcm: 'PCM',
  srs: 'SRS'
};
const lowerTitleWords = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

function properCaseTitle(value: string): string {
  return compact(value)
    .split(' ')
    .map((token, tokenIndex) => {
      if (/\d/.test(token)) return token.replace(/[a-z]+/gi, (letters) => letters.toUpperCase());
      return token.split(/([/\u2013\u2014-])/).map((segment) => {
        if (/^[/\u2013\u2014-]$/.test(segment)) return segment;
        const preserved = preservedTitleTokens[brandKey(segment)];
        if (preserved) return preserved;
        const lower = segment.toLowerCase();
        if (tokenIndex > 0 && lowerTitleWords.has(lower)) return lower;
        return lower.replace(/[a-z]/, (letter) => letter.toUpperCase());
      }).join('');
    })
    .join(' ');
}

function removeBareCompatibleBrand(value: string, compatibleBrand: string | null): string {
  const brand = compact(compatibleBrand);
  if (!brand) return compact(value);
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return compact(value.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' '));
}

function guardTitle(value: string): string {
  const clean = properCaseTitle(value);
  if (clean.length <= 80) return clean;
  return clean.slice(0, 80).replace(/\s+\S*$/, '').trim();
}

export function ebayVeroParticipantForBrand(brand: string | null): string | null {
  return brandOwnerProfiles[brandKey(brand)] ?? null;
}

/**
 * eBay's current rule is relationship-based, not a blanket "Fits" rule:
 * truthful genuine-brand items may name their brand; parts merely compatible
 * with another brand must place Fits/For before that compatible brand.
 */
export function applyEbayBrandTitlePolicy(input: BrandTitlePolicyInput): BrandTitlePolicyResult {
  const itemBrand = compact(input.itemBrand) || null;
  const compatibleBrand = compact(input.compatibleBrand) || null;
  const mpn = compact(input.manufacturerPartNumber);
  const productName = removeBareCompatibleBrand(input.productName, compatibleBrand);
  const years = compact(input.applicationYears) || null;
  const veroParticipant = ebayVeroParticipantForBrand(compatibleBrand ?? itemBrand);

  if (input.relationship === 'GENUINE_BRANDED_ITEM' && itemBrand) {
    const compatibilityPhrase = compatibleBrand && brandKey(compatibleBrand) !== brandKey(itemBrand)
      ? `Fits ${compatibleBrand}`
      : null;
    const titleBrand = brandKey(itemBrand) === 'generalmotors' ? 'GM' : itemBrand;
    return {
      title: guardTitle([titleBrand, mpn, productName, compatibilityPhrase, years].filter(Boolean).join(' ')),
      state: 'COMPLIANT',
      rule: 'GENUINE_BRAND_ALLOWED',
      itemBrand,
      compatibleBrand,
      veroParticipant,
      registryCompleteness: 'OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE',
      sourceUrl: EBAY_INTELLECTUAL_PROPERTY_POLICY_URL,
      profileIndexUrl: EBAY_VERO_PROFILE_INDEX_URL,
      sellerConfirmationRequired: false,
      explanation: compatibilityPhrase
        ? 'The genuine item brand is stated directly and the different compatible vehicle brand is introduced by Fits.'
        : 'The physical item is set as genuinely branded, so the truthful item brand may appear without Fits/For.'
    };
  }

  const compatibilityPhrase = compatibleBrand ? `Fits ${compatibleBrand}` : null;
  const aftermarketBrand = input.relationship === 'AFTERMARKET_COMPATIBLE'
    && itemBrand
    && brandKey(itemBrand) !== brandKey(compatibleBrand)
    ? itemBrand
    : null;
  return {
    title: guardTitle([aftermarketBrand, mpn, productName, compatibilityPhrase, years].filter(Boolean).join(' ')),
    state: input.relationship === 'AFTERMARKET_COMPATIBLE'
      ? 'COMPLIANT'
      : 'SELLER_CONFIRMATION_REQUIRED',
    rule: input.relationship === 'AFTERMARKET_COMPATIBLE'
      ? 'FITS_FOR_PREFIX_REQUIRED'
      : 'AUTHENTICITY_HELD',
    itemBrand: aftermarketBrand,
    compatibleBrand,
    veroParticipant,
    registryCompleteness: 'OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE',
    sourceUrl: EBAY_INTELLECTUAL_PROPERTY_POLICY_URL,
    profileIndexUrl: EBAY_VERO_PROFILE_INDEX_URL,
    sellerConfirmationRequired: input.relationship !== 'AFTERMARKET_COMPATIBLE',
    explanation: input.relationship === 'AFTERMARKET_COMPATIBLE'
      ? 'The compatible vehicle brand is introduced by Fits, while the actual aftermarket item brand remains separate.'
      : 'Catalog fitment does not prove the physical item is genuine OEM; the compatible brand is therefore introduced by Fits until the seller confirms authenticity.'
  };
}

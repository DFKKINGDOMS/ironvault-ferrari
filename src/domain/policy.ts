import type { EvidenceRecord, ExceptionRecord, ListingPayload, StoredImage } from './types.js';

const SAFETY_CRITICAL_TERMS = ['airbag', 'inflator', 'squib', 'seat belt pretensioner'];
const CORE_PART_TERMS = ['alternator', 'starter', 'caliper', 'compressor'];
const REQUIRED_EBAY_ASPECTS = [
  'Brand',
  'Manufacturer Part Number',
  'OE/OEM Part Number',
  'California Prop 65 Warning'
] as const;

export function evaluateDraft(
  payload: ListingPayload,
  evidence: EvidenceRecord[],
  images: StoredImage[]
): ExceptionRecord[] {
  const exceptions: ExceptionRecord[] = [];
  const searchable = `${payload.title} ${payload.description}`.toLowerCase();
  const supersededIds = new Set(evidence.map((row) => row.supersedesId).filter((id): id is string => Boolean(id)));
  const activeEvidence = evidence.filter((row) => !supersededIds.has(row.id));

  if (activeEvidence.some((row) => row.state === 'CONFLICTING_EVIDENCE' || row.state === 'BLOCKED')) {
    exceptions.push({
      code: 'EVIDENCE_CONFLICT',
      severity: 'BLOCK',
      message: 'The evidence ledger contains a conflict or explicit block.',
      nextAction: 'Resolve the cited evidence conflict; append a sourced superseding record rather than deleting history.'
    });
  }

  if (!payload.brand || !payload.mpn) {
    exceptions.push({
      code: 'IDENTITY_INCOMPLETE',
      severity: 'HOLD',
      field: 'brand/mpn',
      message: 'Brand and manufacturer part number are not both resolved.',
      nextAction: 'Confirm the readable brand and MPN from the item or package.'
    });
  }

  if (!payload.conditionId) {
    exceptions.push({
      code: 'EBAY_CATEGORY_CONDITION_ID_REQUIRED',
      severity: 'HOLD',
      field: 'conditionId',
      message: 'The listing condition must be selected from the current eBay policy for its primary category.',
      nextAction: 'Refresh the category condition policy and select an exact eBay condition.'
    });
  }

  if (payload.secondaryCategoryId) {
    exceptions.push({
      code: 'SECONDARY_CATEGORY_TRADING_API_REQUIRED',
      severity: 'HOLD',
      field: 'secondaryCategoryId',
      message: 'The eBay Inventory API cannot publish a secondary category.',
      nextAction: 'Remove the second category or route this listing through the eBay Trading API after fee review.'
    });
  }

  const missingAspects = REQUIRED_EBAY_ASPECTS.filter((name) =>
    !(payload.aspects[name]?.some((value) => value.trim().length > 0))
  );
  if (missingAspects.length > 0) {
    exceptions.push({
      code: 'REQUIRED_EBAY_ASPECTS_MISSING',
      severity: 'HOLD',
      field: 'aspects',
      message: `Required eBay item specifics are incomplete: ${missingAspects.join(', ')}.`,
      nextAction: 'Complete all four pinned item specifics before private preflight.'
    });
  }

  const numericPrice = Number(payload.price.value);
  if (!Number.isFinite(numericPrice) || numericPrice < 0.99) {
    exceptions.push({
      code: 'EBAY_MOTORS_MINIMUM_PRICE_REQUIRED',
      severity: 'HOLD',
      field: 'price',
      message: 'eBay Motors fixed-price listings must be priced at $0.99 or more.',
      nextAction: 'Enter a Buy It Now price of at least $0.99.'
    });
  }
  if (payload.saleMode === 'GIVEAWAY') {
    exceptions.push({
      code: 'GIVEAWAY_CHANNEL_HOLD',
      severity: 'BLOCK',
      field: 'price',
      message: 'Giveaway mode is not supported for eBay Motors listings.',
      nextAction: 'Use fixed-price mode and enter at least $0.99.'
    });
  }

  if (payload.compatibility.length > 0) {
    const compatibilityEvidence = activeEvidence.some((row) => row.state === 'EBAY_COMPATIBILITY');
    if (!compatibilityEvidence) {
      exceptions.push({
        code: 'FITMENT_NOT_VERIFIED',
        severity: 'BLOCK',
        field: 'compatibility',
        message: 'Compatibility exists in the payload without permitted eBay compatibility evidence.',
        nextAction: 'Remove compatibility or attach the current eBay-returned compatibility record.'
      });
    }
  }

  if (activeEvidence.some((row) => row.state === 'COMPATIBILITY_REOPENED')) {
    exceptions.push({
      code: 'FITMENT_REVIEW_REOPENED',
      severity: 'HOLD',
      field: 'compatibility',
      message: 'A does-not-fit report or seller correction reopened the compatibility evidence chain.',
      nextAction: 'Review the cited evidence row and re-resolve compatibility before republishing.'
    });
  }

  if (activeEvidence.some((row) => row.state === 'REMOTE_CHANGE_DETECTED')) {
    exceptions.push({
      code: 'REMOTE_CHANGE_REVIEW',
      severity: 'HOLD',
      field: 'remoteSnapshot',
      message: 'The current eBay offer differs from the last known local snapshot.',
      nextAction: 'Explicitly accept the remote state, prepare a local revision, or withdraw the offer.'
    });
  }

  if (SAFETY_CRITICAL_TERMS.some((term) => searchable.includes(term))) {
    exceptions.push({
      code: 'SAFETY_CRITICAL_REVIEW',
      severity: 'BLOCK',
      message: 'The item appears safety-critical or restricted in the launch pilot.',
      nextAction: 'Route to policy review; public publishing remains disabled.'
    });
  }

  if (payload.condition === 'REMANUFACTURED' && CORE_PART_TERMS.some((term) => searchable.includes(term)) && !payload.core) {
    exceptions.push({
      code: 'CORE_TERMS_REQUIRED',
      severity: 'BLOCK',
      field: 'core',
      message: 'A remanufactured core part needs structured core-return terms.',
      nextAction: 'Enter the core amount, window, criteria and checkout treatment.'
    });
  }

  if (payload.internationalEligible && (!payload.countryOfOrigin || !payload.hsCode)) {
    exceptions.push({
      code: 'INTERNATIONAL_CUSTOMS_HOLD',
      severity: 'HOLD',
      field: 'internationalEligible',
      message: 'International shipping lacks proven origin or an approved HS code.',
      nextAction: 'Disable international shipping or confirm traceable customs evidence.'
    });
  }

  if (images.some((image) => image.watermarkStatus === 'SUSPECTED_THIRD_PARTY')) {
    exceptions.push({
      code: 'IMAGE_RIGHTS_HOLD',
      severity: 'BLOCK',
      field: 'imageIds',
      message: 'An image may carry a third-party ownership watermark.',
      nextAction: 'Use an original photograph or record verifiable written permission.'
    });
  }

  if (images.some((image) => image.kind === 'DETERMINISTIC_DERIVATIVE' && image.itemPixelsPreserved !== true)) {
    exceptions.push({
      code: 'IMAGE_FOREGROUND_CHANGED',
      severity: 'BLOCK',
      field: 'imageIds',
      message: 'A used-part derivative did not pass foreground preservation.',
      nextAction: 'Reject the derivative and regenerate from the immutable original.'
    });
  }

  return exceptions;
}

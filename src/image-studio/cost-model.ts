import type { StudioQuote } from './types.js';

const PRICING_VERSION = 'adaptive-partquill-qa-2026-08-28';

/*
 * Conservative operating estimates, not a representation of an OpenAI invoice.
 *
 * Hero: GPT Image 2 high, square output ($0.211 published output allowance)
 * plus a high-fidelity input allowance.
 * Secondary: GPT Image 1 Mini high, square output ($0.036 published output
 * allowance) plus a high-fidelity input allowance.
 * QA, storage, and a 12% retry reserve are included so the retail price is not
 * based on output tokens alone.
 */
const HERO_DIRECT_USD = 0.27;
const SECONDARY_DIRECT_USD = 0.05;
const QA_PER_IMAGE_USD = 0.003;
const STORAGE_AND_QUEUE_PER_BATCH_USD = 0.06;
const RETRY_RESERVE = 0.12;

function retailForCount(count: number): number {
  if (count <= 5) return 0.99;
  if (count <= 12) return 1.49;
  return 2.49;
}

function money(value: number): string {
  return value.toFixed(2);
}

export function quoteStudioBatch(imageCount: number): StudioQuote {
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 24) {
    throw new RangeError('imageCount must be an integer between 1 and 24');
  }
  const base = HERO_DIRECT_USD + Math.max(0, imageCount - 1) * SECONDARY_DIRECT_USD;
  const qa = imageCount * QA_PER_IMAGE_USD;
  const estimatedDirect = (base + qa) * (1 + RETRY_RESERVE) + STORAGE_AND_QUEUE_PER_BATCH_USD;
  const retail = retailForCount(imageCount);
  const margin = Math.max(0, retail - estimatedDirect);
  return {
    imageCount,
    customerPriceUsd: money(retail),
    estimatedDirectCostUsd: money(estimatedDirect),
    estimatedGrossMarginUsd: money(margin),
    estimatedGrossMarginPercent: Math.round((margin / retail) * 1_000) / 10,
    includes: {
      heroPremiumImages: 1,
      economyHighFidelityImages: Math.max(0, imageCount - 1),
      qaComparisons: imageCount,
      retryReservePercent: RETRY_RESERVE * 100
    },
    pricingVersion: PRICING_VERSION,
    caveat:
      'Estimate uses published model rates plus conservative input, QA, storage and retry allowances; actual telemetry can move the final launch price.'
  };
}

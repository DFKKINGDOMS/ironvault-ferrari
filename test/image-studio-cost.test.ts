import { describe, expect, it } from 'vitest';
import { quoteStudioBatch } from '../src/image-studio/cost-model.js';

describe('Image Studio batch pricing', () => {
  it('prices a full eBay-sized 24-image batch, not 24 retail edits', () => {
    const quote = quoteStudioBatch(24);
    expect(quote.customerPriceUsd).toBe('2.49');
    expect(Number(quote.estimatedDirectCostUsd)).toBeLessThan(Number(quote.customerPriceUsd));
    expect(quote.includes.heroPremiumImages).toBe(1);
    expect(quote.includes.economyHighFidelityImages).toBe(23);
    expect(quote.includes.qaComparisons).toBe(24);
  });

  it('rejects counts outside the eBay launch limit', () => {
    expect(() => quoteStudioBatch(0)).toThrow(RangeError);
    expect(() => quoteStudioBatch(25)).toThrow(RangeError);
  });
});

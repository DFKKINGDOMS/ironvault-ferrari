import { describe, expect, it, vi } from 'vitest';
import { researchRevolutionParts } from '../src/catalog/revolutionparts.js';

function productPage(sku = '90915-YZZS1'): string {
  return `<html><script type="application/json" id="product_data">${JSON.stringify({
    sku,
    title: `Oil Filter - Toyota (${sku})`,
    price: 5.23,
    msrp: 6.57,
    also_known_as: 'Engine Oil Filter',
    images: [{ main: { url: '//cdn-product-images.revolutionparts.io/assets/filter.webp' }, type: 'CATALOG' }],
    fitment: [
      { year: '2016', make: 'Scion', model: 'FR-S', trims: ['Base'], engines: ['2.0L H4 - Gas'] },
      { year: '2017', make: 'Toyota', model: '86', trims: ['Base'], engines: ['2.0L H4 - Gas'] }
    ]
  })}</script></html>`;
}

describe('third exact OEM catalog parser', () => {
  it('uses deterministic description URLs but accepts only an exact returned SKU', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(productPage(), { status: 200 }));
    const result = await researchRevolutionParts('90915-YZZS1', {
      fetch: fetcher,
      now: () => new Date('2026-08-27T12:00:00.000Z'),
      descriptionHints: ['Oil Filter']
    });
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain('/oem-parts/toyota-oil-filter-90915yzzs1');
    expect(result.identity).toMatchObject({ partNumber: '90915-YZZS1', description: 'Oil Filter' });
    expect(result.pricing).toMatchObject({ listPrice: 6.57, dealerSalePrice: 5.23 });
    expect(result.fitment.map((row) => row.make)).toEqual(['Scion', 'Toyota']);
  });

  it('rejects a page whose SKU differs from the request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(productPage('90915-YZZN1'), { status: 200 }));
    await expect(researchRevolutionParts('90915-YZZS1', {
      fetch: fetcher,
      descriptionHints: ['Oil Filter']
    })).rejects.toThrow('No exact third-catalog result');
  });
});

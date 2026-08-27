import { describe, expect, it, vi } from 'vitest';
import { researchLexusPart } from '../src/catalog/lexuspartsnow.js';

function productPage(partNumber = '75443-78210'): string {
  const store = {
    partNumber: {
      canonical: `/parts/lexus-plate-back-door-nam~${partNumber}.html`,
      partInfo: {
        partNumber,
        mainDesc: 'PLATE, BACK DOOR NAM',
        subDesc: 'Rear name plate',
        pncCode: '75443',
        replacedBy: '75443-78211',
        replaces: ['75443-78200'],
        priceInfo: {
          price: '$44.36',
          rawPrice: 44.36,
          retail: '$59.03',
          save: '25%',
          partStatus: 'Available'
        },
        specificationList: [
          { name: 'Manufacturer Note', desc: 'NX350H AWD' },
          { name: 'Condition', desc: 'New' },
          { name: 'Fitment Type', desc: 'Direct Replacement' }
        ],
        actualPictures: [
          {
            largeImg:
              'https://www.lexuspartsnow.com/resources/encry/actual-picture/lpn/large/example.jpg',
            alt: 'Actual Lexus part photo'
          }
        ]
      },
      imageList: [
        {
          largeImg:
            'https://www.lexuspartsnow.com/resources/encry/part-picture/motor/2024/large/example.png',
          alt: 'Catalog illustration'
        }
      ],
      fitVehicleList: [
        ['2022-2025 Lexus NX250', '4 Cyl 2.5L', 'A25AFXS; AAZH25L'],
        ['2022-2024 Lexus NX450h+', '4 Cyl 2.5L', 'Plug-in hybrid']
      ]
    }
  };
  return `<html><script id="initialState">window.__INITIAL_STORE__ = ${JSON.stringify(store)};</script></html>`;
}

function lookupFetch(pagePartNumber = '75443-78210') {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/api/search/search-words') {
      return new Response(
        JSON.stringify({
          code: 200,
          data: { redirectUrl: `/parts/lexus-plate-back-door-nam~${pagePartNumber}.html` }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(productPage(pagePartNumber), {
      status: 200,
      headers: { 'content-type': 'text/html' }
    });
  });
}

describe('LexusPartsNow evidence lookup', () => {
  it('returns exact identity, pricing, labeled images, fitment and dealer-anchored quick-sale guidance', async () => {
    const fetcher = lookupFetch();
    const result = await researchLexusPart('75443-78210', {
      fetch: fetcher,
      now: () => new Date('2026-08-27T12:00:00.000Z')
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const searchHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(searchHeaders.get('site')).toBe('LPN');
    expect(result.source).toMatchObject({
      provider: 'LexusPartsNow',
      retrievedAt: '2026-08-27T12:00:00.000Z',
      evidenceStatus: 'DEALER_CATALOG_REFERENCE'
    });
    expect(result.identity).toMatchObject({
      partNumber: '75443-78210',
      description: 'PLATE, BACK DOOR NAM',
      manufacturerNote: 'NX350H AWD',
      replacedBy: '75443-78211'
    });
    expect(result.pricing).toMatchObject({ listPrice: 59.03, dealerSalePrice: 44.36, savingsPercent: 25 });
    expect(result.quickSale).toMatchObject({
      targetPrice: 35.49,
      lowPrice: 33.27,
      highPrice: 37.71,
      discountPercent: 20,
      basis: 'DEALER_SALE_PRICE'
    });
    expect(result.images.map((image) => image.type)).toEqual([
      'ACTUAL_PRODUCT_PHOTO',
      'CATALOG_ILLUSTRATION'
    ]);
    expect(result.fitment[0]).toMatchObject({
      yearStart: 2022,
      yearEnd: 2025,
      make: 'Lexus',
      model: 'NX250',
      trimEngine: '4 Cyl 2.5L'
    });
    expect(result.vinConfirmationRequired).toBe(true);
  });

  it('refuses invalid input before contacting the dealer', async () => {
    const fetcher = lookupFetch();
    await expect(researchLexusPart('https://evil.example/a', { fetch: fetcher })).rejects.toThrow(
      'exact Lexus part number'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a non-exact dealer result instead of guessing', async () => {
    const fetcher = lookupFetch('75443-78211');
    await expect(researchLexusPart('75443-78210', { fetch: fetcher })).rejects.toThrow('did not exactly match');
  });

  it('refuses an unexpected redirect outside the dealer part catalog', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ code: 200, data: { redirectUrl: 'https://evil.example/parts/a' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    await expect(researchLexusPart('75443-78210', { fetch: fetcher })).rejects.toThrow('unsafe or unexpected');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { researchToyotaPart } from '../src/catalog/lexuspartsnow.js';

function toyotaProductPage(): string {
  const store = {
    partNumber: {
      partInfo: {
        partNumber: '13568-29025',
        mainDesc: 'Timing Belt',
        subDesc: 'Belt, Timing',
        pncCode: '13568',
        replacedBy: '13568-YZZ10',
        priceInfo: { price: '49.97', retail: '69.84', save: '19.87' },
        specificationList: [
          { name: 'Condition', desc: 'New' },
          { name: 'Fitment Type', desc: 'Direct Replacement' }
        ],
        actualPictures: [{
          largeImg: '/resources/encry/actual-picture/tpd/large/timing-belt.jpg',
          alt: 'Toyota timing belt'
        }]
      },
      fitVehicleList: [
        ['1997-2004 Toyota Avalon', 'XL, XLS|6 Cyl 3.0L', '1MZFE'],
        ['2001-2011 Toyota Highlander', 'Limited|6 Cyl 3.3L', '3MZFE']
      ]
    }
  };
  return `<html><script id="initialState">window.__INITIAL_STORE__ = ${JSON.stringify(store)};</script></html>`;
}

describe('Toyota exact catalog lookup', () => {
  it('uses the Toyota catalog header and returns exact identity, price, images and fitment', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/api/search/search-words') {
        return new Response(JSON.stringify({ data: { redirectUrl: '/oem/toyota~belt~timing~13568-29025.html' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(toyotaProductPage(), { status: 200 });
    });
    const result = await researchToyotaPart('13568-29025', { fetch: fetcher });
    const searchHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(searchHeaders.get('site')).toBe('TPD');
    expect(result.identity).toMatchObject({
      manufacturer: 'Toyota',
      partNumber: '13568-29025',
      description: 'Timing Belt',
      replacedBy: '13568-YZZ10'
    });
    expect(result.pricing).toMatchObject({ listPrice: 69.84, dealerSalePrice: 49.97 });
    expect(result.fitment[0]).toMatchObject({ make: 'Toyota', model: 'Avalon' });
  });
});

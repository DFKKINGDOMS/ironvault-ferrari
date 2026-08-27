import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPartQuillMcpServer } from '../src/mcp/server.js';

const lexusResearchFixture = {
  identity: {
    partNumber: '75443-78210',
    description: 'PLATE, BACK DOOR NAM',
    alternateNames: [],
    manufacturerNotes: [],
    pncCodes: ['75443'],
    replacedBy: [],
    replaces: []
  },
  brandCoverage: {
    catalogBrands: ['Lexus' as const],
    fitmentBrands: ['Lexus' as const],
    crossoverStatus: 'SINGLE_BRAND' as const
  },
  pricing: {
    currency: 'USD' as const,
    observedQuoteCount: 1,
    listPriceReference: 59.03,
    currentPriceLow: 44.36,
    currentPriceHigh: 44.36,
    anonymousQuotes: [{ quote: 'Quote A', listPrice: 59.03, currentPrice: 44.36 }]
  },
  quickSale: {
    targetPrice: 35.49,
    lowPrice: 33.27,
    highPrice: 37.71,
    discountPercent: 20,
    basis: 'LOWEST_CURRENT_OEM_QUOTE' as const,
    disclaimer: 'Anonymous OEM-catalog estimate only.'
  },
  images: [
    {
      url: 'https://api.partquill.com/v1/catalog/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      type: 'ACTUAL_PRODUCT_PHOTO' as const,
      alt: 'Exact product reference photograph'
    },
    {
      url: 'https://api.partquill.com/v1/catalog/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      type: 'CATALOG_ILLUSTRATION' as const,
      alt: 'Catalog illustration'
    }
  ],
  fitment: [
    {
      yearStart: 2022,
      yearEnd: 2025,
      make: 'Lexus' as const,
      model: 'NX250',
      raw: '2022-2025 Lexus NX250'
    }
  ],
  fitmentTotal: 1,
  catalogChecks: {
    attempted: 3 as const,
    exactMatches: 1,
    unavailable: 2,
    retrievedAt: '2026-08-27T12:00:00.000Z'
  },
  dealerIdentityExposed: false as const,
  vinConfirmationRequired: true as const
};

describe('PartQuill connected ChatGPT contract', () => {
  let server: ReturnType<typeof buildPartQuillMcpServer>;
  let client: Client;

  beforeEach(async () => {
    server = buildPartQuillMcpServer({
      researchOemPart: async () => lexusResearchFixture,
      verifyOemPartVin: async (partNumber, vin) => ({
        partNumber,
        vinLastFour: vin.slice(-4),
        vehicle: {
          make: 'Lexus',
          model: 'NX250',
          modelYear: 2023,
          engineModel: 'A25A-FKS',
          displacementL: 2.5,
          cylinders: 4
        },
        status: 'CATALOG_MATCH',
        statusLabel: 'Fits this vehicle',
        verdictTone: 'GREEN',
        explanation: 'The decoded vehicle matches exact catalog evidence.',
        matchingFitment: lexusResearchFixture.fitment,
        catalogChecks: { attempted: 3, exactPartMatches: 1, unavailable: 2, matchingRows: 1 },
        listingFitmentAllowed: true,
        vinStored: false,
        dealerIdentityExposed: false
      }),
      loadCatalogImage: async (url) => ({
        data: Buffer.from(url.includes('aaaa') ? 'product-image' : 'diagram-image').toString('base64'),
        mimeType: url.includes('aaaa') ? 'image/jpeg' : 'image/png'
      })
    });
    client = new Client({ name: 'partquill-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('advertises the OEM result card, VIN verifier and protected image tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'open_oem_part_finder',
      'research_oem_part',
      'verify_oem_part_vin',
      'open_image_studio',
      'prepare_protected_image_job',
      'return_edited_images'
    ]);

    const research = tools.tools.find((tool) => tool.name === 'research_oem_part');
    const verify = tools.tools.find((tool) => tool.name === 'verify_oem_part_vin');
    const prepare = tools.tools.find((tool) => tool.name === 'prepare_protected_image_job');
    const returned = tools.tools.find((tool) => tool.name === 'return_edited_images');
    expect(research?._meta?.ui).toMatchObject({ resourceUri: 'ui://partquill/oem-part-finder-v2.html' });
    expect(verify?._meta?.ui).toMatchObject({ resourceUri: 'ui://partquill/oem-part-finder-v2.html' });
    expect(prepare?._meta?.['openai/fileParams']).toEqual(['images']);
    expect(returned?._meta?.['openai/fileParams']).toEqual(['images']);
    expect(prepare?._meta?.ui).toBeUndefined();
    expect(prepare?._meta?.['openai/outputTemplate']).toBeUndefined();
  });

  it('returns Lexus catalog research without an eBay write', async () => {
    const result = await client.callTool({
      name: 'research_oem_part',
      arguments: { part_number: '75443-78210' }
    });
    expect(result.structuredContent).toMatchObject({
      identity: { partNumber: '75443-78210', description: 'PLATE, BACK DOOR NAM' },
      pricingReference: {
        listPriceReference: 59.03,
        currentPriceLow: 44.36,
        ebayMarketValueVerified: false
      },
      fitmentVerdict: {
        status: 'VIN_REQUIRED',
        tone: 'AMBER',
        statusLabel: 'Fitment not verified',
        listingFitmentAllowed: false
      },
      applicationSummary: [{ make: 'Lexus', model: 'NX250', yearRanges: ['2022–2025'] }],
      sellerListingReadiness: {
        status: 'NEEDS_SELLER_FACTS_AND_MARKET_EVIDENCE',
        ebayMarketValueVerified: false,
        finalListingReady: false
      },
      imagePresentation: {
        productPhotoAvailable: true,
        diagramAvailable: true,
        visualCard: 'PARTQUILL_INLINE_CARD',
        transcriptAttachments: false,
        diagramCallouts: ['75443'],
        productPhotoUsage: 'REFERENCE_ONLY_UNLESS_RIGHTS_CONFIRMED',
        catalogDiagramUsage: 'INTERNAL_REFERENCE_ONLY',
        primaryEbayImageApproved: false
      },
      vinConfirmationRequired: true
    });
    expect((result.content as Array<{ type: string }>).map((content) => content.type)).toEqual(['text']);
    expect(result._meta).toMatchObject({
      partquillMedia: [
        { role: 'PRODUCT_PHOTO', mimeType: 'image/jpeg' },
        { role: 'CATALOG_DIAGRAM', mimeType: 'image/png' }
      ]
    });
    expect(JSON.stringify(result.content)).toContain('Diagram callout / PNC:** 75443');
    expect(JSON.stringify(result.content)).toContain('not transcript attachments');
    expect(JSON.stringify(result.content)).toContain('AMBER — not verified');
    expect(JSON.stringify(result.content)).not.toContain('2022-2025 Lexus NX250');
    expect(JSON.stringify(result.structuredContent)).not.toContain('raw');
    expect(JSON.stringify(result.structuredContent)).not.toContain('targetPrice');
    expect(JSON.stringify(result.content)).toContain('No eBay listing or price was changed.');
    expect(JSON.stringify(result)).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts/i);
    expect(JSON.stringify(result)).not.toMatch(/(?:telephone|phone|street address|contact us)/i);
  });

  it('returns a masked buyer VIN decision without storing or exposing the full VIN', async () => {
    const vin = 'JT2BF22K1W0123456';
    const result = await client.callTool({
      name: 'verify_oem_part_vin',
      arguments: { part_number: '75443-78210', vin }
    });
    expect(result.structuredContent).toMatchObject({
      partNumber: '75443-78210',
      vinLastFour: '3456',
      status: 'CATALOG_MATCH',
      statusLabel: 'Fits this vehicle',
      verdictTone: 'GREEN',
      listingFitmentAllowed: true,
      vinStored: false,
      dealerIdentityExposed: false
    });
    expect(JSON.stringify(result)).not.toContain(vin);
    expect(JSON.stringify(result)).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts/i);
  });

  it('serves the inline OEM widget with product, diagram and VIN controls', async () => {
    const resources = await client.listResources();
    expect(resources.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: 'ui://partquill/oem-part-finder-v2.html' })
    ]));
    const resource = await client.readResource({ uri: 'ui://partquill/oem-part-finder-v2.html' });
    const firstContent = resource.contents[0];
    const html = firstContent && 'text' in firstContent ? firstContent.text : '';
    expect(html).toContain('PartQuill OEM Part Finder');
    expect(html).toContain('Buyer VIN (optional)');
    expect(html).toContain('Exact product reference photo');
    expect(html).toContain('Catalog diagram');
    expect(html).toContain('Fitment not verified');
    expect(html).toContain('May fit — not verified');
    expect(html).toContain('Potential applications');
    expect(html).not.toContain('Catalog fitment preview');
    expect(html).toContain('verify_oem_part_vin');
    expect(html).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts/i);
  });

  it('prepares a deterministic, rights-confirmed two-image preservation job', async () => {
    const files = [
      {
        download_url: 'https://files.example.test/source-one.jpg',
        file_id: 'file_source_one',
        mime_type: 'image/jpeg',
        file_name: 'front.jpg'
      },
      {
        download_url: 'https://files.example.test/source-two.jpg',
        file_id: 'file_source_two',
        mime_type: 'image/jpeg',
        file_name: 'reverse.jpg'
      }
    ];
    const first = await client.callTool({
      name: 'prepare_protected_image_job',
      arguments: { images: files, rights_confirmed: true }
    });
    const second = await client.callTool({
      name: 'prepare_protected_image_job',
      arguments: { images: files, rights_confirmed: true }
    });
    const firstData = first.structuredContent as Record<string, unknown>;
    const secondData = second.structuredContent as Record<string, unknown>;
    expect(firstData.job_code).toBe(secondData.job_code);
    expect(firstData.source_count).toBe(2);
    expect(firstData.source_order).toEqual(['front.jpg', 'reverse.jpg']);
    expect(firstData.protected_prompt).toContain('Never crop an item edge');
    expect(firstData.protected_prompt).not.toContain('Do not ask the user to upload them again.');
    expect(JSON.stringify(first.content)).toContain('Do not ask the user to upload them again.');
  });

  it('accepts returned file references without performing an eBay write', async () => {
    const result = await client.callTool({
      name: 'return_edited_images',
      arguments: {
        job_code: 'PQ-C-1A2B3C4D',
        images: [
          {
            download_url: 'https://files.example.test/result-one.png',
            file_id: 'file_result_one',
            mime_type: 'image/png',
            file_name: 'front-clean.png'
          }
        ]
      }
    });
    expect(result.structuredContent).toMatchObject({
      job_code: 'PQ-C-1A2B3C4D',
      returned_count: 1,
      status: 'READY_FOR_REVIEW',
      eBay_write_performed: false
    });
  });
});

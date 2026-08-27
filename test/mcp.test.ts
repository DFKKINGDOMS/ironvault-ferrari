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
      url: 'https://api.partquill.com/v1/catalog/images/0123456789abcdef0123456789abcdef01234567',
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
    server = buildPartQuillMcpServer({ researchOemPart: async () => lexusResearchFixture });
    client = new Client({ name: 'partquill-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('advertises the upload-once tools without a broken embedded-card dependency', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'research_oem_part',
      'open_image_studio',
      'prepare_protected_image_job',
      'return_edited_images'
    ]);

    const prepare = tools.tools.find((tool) => tool.name === 'prepare_protected_image_job');
    const returned = tools.tools.find((tool) => tool.name === 'return_edited_images');
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
      pricing: { listPriceReference: 59.03, currentPriceLow: 44.36 },
      quickSale: { targetPrice: 35.49, basis: 'LOWEST_CURRENT_OEM_QUOTE' },
      vinConfirmationRequired: true
    });
    expect(JSON.stringify(result.content)).toContain('No eBay listing or price was changed.');
    expect(JSON.stringify(result)).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts/i);
    expect(JSON.stringify(result)).not.toMatch(/(?:telephone|phone|street address|contact us)/i);
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

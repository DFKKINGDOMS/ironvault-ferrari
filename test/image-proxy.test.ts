import { describe, expect, it, vi } from 'vitest';
import {
  loadCatalogImageAttachment,
  registerCatalogImage
} from '../src/catalog/image-proxy.js';

describe('catalog image MCP attachments', () => {
  it('loads a registered private source into a base64 MCP image attachment', async () => {
    const publicUrl = registerCatalogImage(
      'https://www.toyotapartsdeal.com/resources/encry/actual-picture/example.jpg'
    );
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      })
    );
    const attachment = await loadCatalogImageAttachment(publicUrl, { fetch: fetcher });
    expect(attachment).toEqual({
      data: Buffer.from([255, 216, 255, 217]).toString('base64'),
      mimeType: 'image/jpeg'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(attachment)).not.toMatch(/toyotapartsdeal|https?:\/\//i);
  });

  it('refuses unregistered URLs and non-image responses', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response('not an image', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    await expect(loadCatalogImageAttachment('https://api.partquill.com/v1/catalog/images/cccccccccccccccccccccccccccccccccccccccc', {
      fetch: fetcher
    })).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();

    const publicUrl = registerCatalogImage(
      'https://www.lexuspartsnow.com/resources/encry/part-picture/example.png'
    );
    await expect(loadCatalogImageAttachment(publicUrl, { fetch: fetcher })).resolves.toBeUndefined();
  });
});

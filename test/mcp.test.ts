import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPartQuillMcpServer } from '../src/mcp/server.js';
import { PARTQUILL_WIDGET_ORIGIN, PARTQUILL_WIDGET_URI } from '../src/mcp/widget.js';

describe('PartQuill connected ChatGPT contract', () => {
  let server: ReturnType<typeof buildPartQuillMcpServer>;
  let client: Client;

  beforeEach(async () => {
    server = buildPartQuillMcpServer();
    client = new Client({ name: 'partquill-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('advertises the upload-once tools, widget and exact file parameter metadata', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'open_image_studio',
      'prepare_protected_image_job',
      'return_edited_images'
    ]);

    const prepare = tools.tools.find((tool) => tool.name === 'prepare_protected_image_job');
    const returned = tools.tools.find((tool) => tool.name === 'return_edited_images');
    expect(prepare?._meta?.['openai/fileParams']).toEqual(['images']);
    expect(returned?._meta?.['openai/fileParams']).toEqual(['images']);
    expect(prepare?._meta?.ui).toMatchObject({ resourceUri: PARTQUILL_WIDGET_URI });

    const resource = await client.readResource({ uri: PARTQUILL_WIDGET_URI });
    const html = resource.contents[0];
    expect(html?.mimeType).toBe('text/html;profile=mcp-app');
    expect(html?._meta?.ui).toMatchObject({ domain: PARTQUILL_WIDGET_ORIGIN });
    expect(html?._meta?.['openai/widgetDomain']).toBe(PARTQUILL_WIDGET_ORIGIN);
    expect(html && 'text' in html ? html.text : '').toContain('Upload once. Edit in this conversation.');
    expect(html && 'text' in html ? html.text : '').toContain('window.openai.sendFollowUpMessage');
    expect(html && 'text' in html ? html.text : '').toContain('window.openai.uploadFile');
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

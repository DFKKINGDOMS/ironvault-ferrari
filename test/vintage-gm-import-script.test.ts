import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

let temporaryDirectory: string | undefined;
afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe('Vintage GM private importer', () => {
  it('keeps legitimate E-series GM keys and holds only explicit spreadsheet scientific notation', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'partquill-vintage-gm-'));
    const source = join(temporaryDirectory, 'Products_Vintage_Test.csv');
    const bundle = join(temporaryDirectory, 'test.vintage-gm-private.jsonl');
    writeFileSync(source, [
      'Product Name,SKU,Brand,Description,Quantity,Price,Weight',
      '2540-18E1149,18E1149,GM FACTORY MOTOR PARTS,CYLINDER,2,14.25,0.9',
      '2540-18E13,1.80E+14,GM FACTORY MOTOR PARTS,CYLINDER,1,10,0.5',
      'other-1,123456,OTHER BRAND,OTHER,4,1.00,0.1'
    ].join('\n') + '\n');

    const result = spawnSync('python3', [
      'scripts/import-vintage-gm.py',
      '--csv', source,
      '--output', bundle
    ], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceTotalRows: 3,
      gmRows: 2,
      normalizedRows: 1,
      rejectedRows: 1,
      uploaded: false
    });
    const [manifestLine, exactLine, rejectedLine] = readFileSync(bundle, 'utf8').trim().split('\n');
    expect(JSON.parse(manifestLine!)).toMatchObject({ expectedGmRows: 2, sourceTotalRows: 3 });
    expect(JSON.parse(exactLine!)).toMatchObject({
      sku: '18E1149',
      partNumber: '18E1149',
      normalizationState: 'NORMALIZED_EXACT_KEY'
    });
    expect(JSON.parse(rejectedLine!)).toMatchObject({
      sku: '1.80E+14',
      partNumber: null,
      normalizationState: 'REJECTED_SCIENTIFIC_NOTATION'
    });
  });
});

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

describe('seller listing private importer', () => {
  it('keeps only bounded seller evidence and excludes marketplace item identifiers', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'partquill-seller-listings-'));
    const source = join(temporaryDirectory, 'active-listings-2026-08-08.csv');
    const bundle = join(temporaryDirectory, 'seller-listings.private.jsonl');
    const header = [
      'Item number', 'Title', 'Variation details', 'Custom label (SKU)', 'Available quantity', 'Format',
      'Currency', 'Start price', 'Auction Buy It Now price', 'Reserve price', 'Current price', 'Sold quantity',
      'Watchers', 'Bids', 'Start date', 'End date', 'eBay category 1 name', 'eBay category 1 number',
      'eBay category 2 name', 'eBay category 2 number', 'Condition', 'CD:Professional Grader - (ID: 27501)',
      'CD:Grade - (ID: 27502)', 'CDA:Certification Number - (ID: 27503)', 'CD:Card Condition - (ID: 40001)',
      'eBay Product ID(ePID)', 'Listing site', 'P:UPC', 'P:EAN', 'P:ISBN'
    ];
    const row = [
      '178272512743', '1990-1995 Corvette ZR-1 Actuator Part 1996743', '', '1996743', '282', 'FIXED_PRICE',
      'USD', '79.99', '', '', '79.99', '2', '1', '0', 'Jul-01-26', 'Sep-01-26', 'Other Parts', '9886',
      '', '', 'New', '', '', '', '', '', 'US', '', '', ''
    ];
    writeFileSync(source, `${header.join(',')}\n${row.join(',')}\n`);

    const result = spawnSync('python3', [
      'scripts/import-seller-listings.py', '--csv', source, '--output', bundle
    ], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      snapshotDate: '2026-08-08',
      sourceTotalRows: 1,
      expectedRows: 1,
      normalizedRows: 1,
      uploaded: false
    });
    const lines = readFileSync(bundle, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[1]).toMatchObject({
      sku: '1996743',
      partNumber: '1996743',
      availableQuantity: 282,
      askingPrice: '79.99',
      normalizationState: 'NORMALIZED_EXACT_KEY'
    });
    expect(readFileSync(bundle, 'utf8')).not.toContain('178272512743');
  });
});

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { loadAzureCatalogScan } from './azure-blob-media.js';
import type {
  GmCatalogCalloutBox,
  GmCatalogCalloutEvidence,
  GmCatalogPart
} from './gm-catalog.js';

const MAX_SCAN_BYTES = 20 * 1024 * 1024;
const DETECTOR_TIMEOUT_MS = 75_000;
const ORANGE = '#d9571b';
const ORANGE_BRIGHT = '#f97316';

const detectorResultSchema = z.object({
  state: z.enum(['EXACT_ROW_AND_CALLOUT', 'EXACT_ROW_ONLY', 'NOT_RESOLVED']),
  partNumber: z.string().regex(/^[A-Z0-9]+$/),
  calloutId: z.string().regex(/^\d{1,3}$/).nullable(),
  catalogGroup: z.string().max(32).nullable(),
  description: z.string().max(240).nullable(),
  rowBox: z.object({
    left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    image_width: z.number().int().positive(),
    image_height: z.number().int().positive()
  }).nullable(),
  rowConfidence: z.number().min(0).max(1),
  calloutBoxes: z.array(z.object({
    left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    image_width: z.number().int().positive(),
    image_height: z.number().int().positive(),
    confidence: z.number().min(0).max(1)
  })).max(24)
});

const detectionCache = new Map<string, Promise<GmCatalogCalloutEvidence | undefined>>();
const pageCache = new Map<number, Promise<Buffer | undefined>>();
let detectorQueue: Promise<void> = Promise.resolve();

async function withDetectorSlot<T>(operation: () => Promise<T>): Promise<T> {
  const predecessor = detectorQueue;
  let release!: () => void;
  detectorQueue = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  await predecessor;
  try {
    return await operation();
  } finally {
    release();
  }
}

function boundedCacheSet<K, T>(cache: Map<K, T>, key: K, value: T, limit: number): void {
  cache.set(key, value);
  if (cache.size <= limit) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

export async function loadGmCatalogPage(config: AppConfig, pageId: number): Promise<Buffer | undefined> {
  const cached = pageCache.get(pageId);
  if (cached) return cached;
  const pending = (async () => {
    const pageFolder = String(pageId).padStart(6, '0');
    const localPath = resolve(config.GM_CATALOG_SCAN_DIR, pageFolder, 'full_page.png');
    if (existsSync(localPath)) {
      const bytes = await readFile(localPath);
      return bytes.length && bytes.length <= MAX_SCAN_BYTES ? bytes : undefined;
    }
    const azureScan = await loadAzureCatalogScan(config, pageFolder);
    if (azureScan) return azureScan.bytes;
    if (!config.GM_CATALOG_MEDIA_BASE_URL) return undefined;
    const base = config.GM_CATALOG_MEDIA_BASE_URL.replace(/\/$/, '');
    const response = await fetch(`${base}/${pageFolder}/full_page.png`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= MAX_SCAN_BYTES ? bytes : undefined;
  })().catch(() => undefined);
  boundedCacheSet(pageCache, pageId, pending, 48);
  void pending.then((page) => {
    if (!page && pageCache.get(pageId) === pending) pageCache.delete(pageId);
  });
  return pending;
}

function validBox(value: Record<string, unknown> | null): GmCatalogCalloutBox | undefined {
  if (!value) return undefined;
  const box = {
    left: Number(value.left),
    top: Number(value.top),
    width: Number(value.width),
    height: Number(value.height),
    image_width: Number(value.image_width),
    image_height: Number(value.image_height),
    confidence: Number(value.confidence)
  };
  if (![box.left, box.top, box.width, box.height, box.image_width, box.image_height].every(Number.isFinite)) return undefined;
  if (box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0 || box.image_width <= 0 || box.image_height <= 0) return undefined;
  const { confidence: rawConfidence, ...coordinates } = box;
  return {
    ...coordinates,
    ...(Number.isFinite(rawConfidence)
      ? { confidence: Math.max(0, Math.min(1, rawConfidence)) }
      : {})
  };
}

async function runDetector(scan: Buffer, partNumber: string): Promise<z.infer<typeof detectorResultSchema> | undefined> {
  const detectorPath = resolve(process.env.GM_CALLOUT_DETECTOR_PATH ?? 'scripts/detect-gm-callout.py');
  if (!existsSync(detectorPath)) return undefined;
  return withDetectorSlot(() => new Promise((resolveResult) => {
    const child = spawn('python3', [detectorPath, '--part-number', partNumber], {
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), DETECTOR_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= 256 * 1024) chunks.push(chunk);
      else child.kill('SIGKILL');
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolveResult(undefined);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolveResult(undefined);
      try {
        resolveResult(detectorResultSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      } catch {
        resolveResult(undefined);
      }
    });
    child.stdin.end(scan);
  }));
}

function catalogPageCandidates(catalog: GmCatalogPart): number[] {
  const pages = new Set<number>();
  for (const diagram of [...catalog.diagrams].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))) {
    pages.add(diagram.pageId);
  }
  for (const application of [...catalog.applications].sort((left, right) => right.sourcePageId - left.sourcePageId)) {
    pages.add(application.sourcePageId);
  }
  if (catalog.rollup.representativePageId) pages.add(catalog.rollup.representativePageId);
  return [...pages].slice(0, 3);
}

function directDiagramEvidence(catalog: GmCatalogPart): GmCatalogCalloutEvidence | undefined {
  for (const diagram of [...catalog.diagrams].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))) {
    const coordinateSpace = String(diagram.evidenceBox?.coordinate_space ?? '').toLowerCase();
    const boxRotation = Number(diagram.evidenceBox?.rotation_degrees ?? diagram.displayRotationDegrees ?? 0);
    // Legacy display-rotated boxes are not safe to paint onto the immutable
    // source scan. Let spatial OCR recover source-image coordinates instead.
    if (coordinateSpace === 'display_rotated' || (Number.isFinite(boxRotation) && boxRotation % 360 !== 0)) continue;
    const box = validBox(diagram.evidenceBox);
    if (!diagram.calloutLabel?.match(/^\d{1,3}$/) || !box || !diagram.exactPartDepiction) continue;
    const pageId = diagram.pageId;
    return {
      state: 'EXACT_ROW_AND_CALLOUT',
      partNumber: catalog.partNumber,
      pageId,
      calloutId: diagram.calloutLabel,
      catalogGroup: diagram.catalogGroup ?? catalog.catalogGroup,
      description: catalog.description ?? catalog.productType,
      rowBox: box,
      rowConfidence: diagram.confidence,
      calloutBoxes: [box],
      sourceImageUrl: `/v1/gm-catalog/pages/${pageId}/image`,
      annotatedImageUrl: `/v1/gm-catalog/parts/${encodeURIComponent(catalog.partNumber)}/callout-image`,
      method: 'CATALOG_DIAGRAM_COORDINATES'
    };
  }
  return undefined;
}

export async function resolveGmCatalogCallout(config: AppConfig, catalog: GmCatalogPart): Promise<GmCatalogCalloutEvidence | undefined> {
  const cacheKey = catalog.partNumber;
  const cached = detectionCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    const direct = directDiagramEvidence(catalog);
    if (direct) return direct;
    for (const pageId of catalogPageCandidates(catalog)) {
      const scan = await loadGmCatalogPage(config, pageId);
      if (!scan) continue;
      const detected = await runDetector(scan, catalog.partNumber);
      if (detected?.state !== 'EXACT_ROW_AND_CALLOUT' || !detected.calloutId || !detected.rowBox || !detected.calloutBoxes.length) continue;
      return {
        state: 'EXACT_ROW_AND_CALLOUT' as const,
        partNumber: catalog.partNumber,
        pageId,
        calloutId: detected.calloutId,
        catalogGroup: detected.catalogGroup,
        description: detected.description,
        rowBox: detected.rowBox,
        rowConfidence: detected.rowConfidence,
        calloutBoxes: detected.calloutBoxes,
        sourceImageUrl: `/v1/gm-catalog/pages/${pageId}/image`,
        annotatedImageUrl: `/v1/gm-catalog/parts/${encodeURIComponent(catalog.partNumber)}/callout-image`,
        method: 'CERTIFIED_ROW_SPATIAL_OCR' as const
      };
    }
    return undefined;
  })();
  boundedCacheSet(detectionCache, cacheKey, pending, 512);
  void pending.then((evidence) => {
    if (!evidence && detectionCache.get(cacheKey) === pending) detectionCache.delete(cacheKey);
  });
  return pending;
}

function svgEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character] ?? character);
}

export async function renderGmCalloutImage(scan: Buffer, evidence: GmCatalogCalloutEvidence): Promise<Buffer> {
  const metadata = await sharp(scan).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error('Catalog scan dimensions are unavailable');
  const scaleX = width / evidence.calloutBoxes[0]!.image_width;
  const scaleY = height / evidence.calloutBoxes[0]!.image_height;
  const stroke = Math.max(8, Math.round(width * 0.0045));
  const labelFont = Math.max(34, Math.round(width * 0.022));
  const numberFont = Math.max(28, Math.round(width * 0.018));
  const callout = svgEscape(evidence.calloutId);
  const overlays = evidence.calloutBoxes.map((box, index) => {
    const x = (box.left + box.width / 2) * scaleX;
    const y = (box.top + box.height / 2) * scaleY;
    const radiusX = Math.max(box.width * scaleX * 0.62, width * 0.015);
    const radiusY = Math.max(box.height * scaleY * 0.62, height * 0.011);
    const labelX = Math.max(16, Math.min(width - labelFont * 5.8, x - radiusX));
    const labelY = Math.max(labelFont + 16, y - radiusY - labelFont * 0.55);
    return `
      <ellipse cx="${x}" cy="${y}" rx="${radiusX}" ry="${radiusY}" fill="#fff7ed" fill-opacity="0.82" stroke="${ORANGE_BRIGHT}" stroke-width="${stroke}"/>
      <text x="${x}" y="${y + numberFont * 0.35}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${numberFont}" font-weight="900" fill="${ORANGE}">${callout}</text>
      ${index === 0 ? `<rect x="${labelX}" y="${labelY - labelFont}" width="${labelFont * 5.5}" height="${labelFont * 1.35}" rx="${labelFont * 0.18}" fill="${ORANGE}"/><text x="${labelX + labelFont * 0.28}" y="${labelY - labelFont * 0.12}" font-family="Arial,Helvetica,sans-serif" font-size="${labelFont * 0.62}" font-weight="800" letter-spacing="1" fill="white">CALLOUT REF ${callout}</text>` : ''}
    `;
  }).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${overlays}</svg>`);
  return sharp(scan).composite([{ input: svg, top: 0, left: 0 }]).png({ compressionLevel: 9 }).toBuffer();
}

export function clearGmCalloutCaches(): void {
  detectionCache.clear();
  pageCache.clear();
}

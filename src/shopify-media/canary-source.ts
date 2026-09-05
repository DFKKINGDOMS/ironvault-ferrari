import {
  shopifyCandidateFromRow,
  shopifyCandidateKey,
  type ShopifyMediaCandidate
} from './export-stream.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function nodes(value: unknown): JsonObject[] {
  const connection = object(value);
  return Array.isArray(connection?.nodes)
    ? connection.nodes.map(object).filter((row): row is JsonObject => Boolean(row))
    : [];
}

export function exactCanaryCandidates(payload: unknown, canaryPartNumber: string): ShopifyMediaCandidate[] {
  const root = object(payload);
  const canonicalCanary = canaryPartNumber.trim().toUpperCase();
  const candidates: ShopifyMediaCandidate[] = [];
  const seen = new Set<string>();

  for (const variant of nodes(root?.productVariants)) {
    const sku = String(variant.sku || '').trim();
    if (!sku || sku.toUpperCase() !== canonicalCanary) continue;
    const product = object(variant.product);
    const productId = String(product?.id || '');
    if (!productId.startsWith('gid://shopify/Product/')) continue;
    const productSkus = new Map<string, string[]>([[productId, [sku]]]);

    for (const media of nodes(product?.media)) {
      const candidate = shopifyCandidateFromRow({ ...media, __parentId: productId }, productSkus);
      if (!candidate || candidate.source !== 'SHOPIFY_PRODUCT_MEDIA' || !candidate.partNumbers.includes(canonicalCanary)) continue;
      const key = shopifyCandidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

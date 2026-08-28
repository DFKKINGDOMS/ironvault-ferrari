export function referenceAssetFilename(sku: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('reference image index must be a non-negative integer');
  const safeSku = sku
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!safeSku) throw new Error('reference image SKU is required');
  return `${safeSku}${index === 0 ? '' : `_${index}`}.png`;
}

export function referenceAssetUrl(sku: string, index: number): string {
  return `/v1/reference-assets/${referenceAssetFilename(sku, index)}`;
}

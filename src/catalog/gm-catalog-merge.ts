import type {
  GmCatalogApplication,
  GmCatalogDiagram,
  GmCatalogIdentityEvidence,
  GmCatalogPart
} from './gm-catalog.js';
import { canonicalOemPartNumber, credibleCatalogIdentityText } from './gm-catalog-quality.js';

export const GM_EXACT_LINK_METHOD = 'gmpartswiki_exact_part_link';

function pageIds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is number =>
    Number.isInteger(value) && Number(value) > 0
  ))].sort((left, right) => left - right);
}

export function exactLinkSourcePages(catalog: GmCatalogPart | undefined): number[] {
  const evidence = catalog?.identityEvidence;
  if (
    evidence?.method !== GM_EXACT_LINK_METHOD
    || evidence.verificationState.toLowerCase() !== 'catalog_stated'
  ) return [];
  return pageIds(evidence.sourcePages);
}

function mergeIdentityEvidence(
  current: GmCatalogIdentityEvidence | undefined,
  incoming: GmCatalogIdentityEvidence | undefined
): GmCatalogIdentityEvidence | undefined {
  const exactEvidence = [current, incoming].filter((value): value is GmCatalogIdentityEvidence =>
    value?.method === GM_EXACT_LINK_METHOD
  );
  if (exactEvidence.length) {
    return {
      method: GM_EXACT_LINK_METHOD,
      verificationState: 'catalog_stated',
      sourcePages: pageIds(exactEvidence.flatMap((value) => value.sourcePages))
    };
  }
  const preferred = current ?? incoming;
  if (!preferred) return undefined;
  const sameMethod = [current, incoming].filter((value): value is GmCatalogIdentityEvidence =>
    value?.method === preferred.method
  );
  return {
    ...preferred,
    sourcePages: pageIds(sameMethod.flatMap((value) => value.sourcePages))
  };
}

function applicationKey(application: GmCatalogApplication): string {
  return JSON.stringify([
    application.sourcePageId,
    application.catalogGroup,
    application.applicationText,
    application.description,
    application.yearStart,
    application.yearEnd,
    application.modelScope
  ]);
}

function applicationScore(application: GmCatalogApplication): number {
  const relation = application.relationMethod.toLowerCase();
  return (relation.includes('curated') ? 100 : relation.includes('exact_html_part_link') ? 70 : 0)
    + (application.verificationState.toLowerCase() === 'catalog_stated' ? 20 : 0)
    + Math.max(0, Math.min(1, application.confidence || 0)) * 10
    + [
      application.description,
      application.catalogGroup,
      application.applicationText,
      application.yearStart,
      application.division,
      application.evidenceBox
    ].filter((value) => value != null && value !== '').length;
}

function mergeApplications(
  current: GmCatalogApplication[] | undefined,
  incoming: GmCatalogApplication[] | undefined
): GmCatalogApplication[] {
  const merged = new Map<string, GmCatalogApplication>();
  for (const application of [...(current ?? []), ...(incoming ?? [])]) {
    const key = applicationKey(application);
    const existing = merged.get(key);
    if (!existing || applicationScore(application) > applicationScore(existing)) {
      merged.set(key, application);
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.sourcePageId - right.sourcePageId
    || (left.catalogGroup ?? '').localeCompare(right.catalogGroup ?? '')
    || (left.applicationText ?? '').localeCompare(right.applicationText ?? '')
  );
}

function diagramKey(diagram: GmCatalogDiagram): string {
  return JSON.stringify([
    diagram.pageId,
    diagram.catalogGroup,
    diagram.calloutLabel,
    diagram.illustrationNumber
  ]);
}

function mergeDiagrams(
  current: GmCatalogDiagram[] | undefined,
  incoming: GmCatalogDiagram[] | undefined
): GmCatalogDiagram[] {
  const merged = new Map<string, GmCatalogDiagram>();
  for (const diagram of [...(current ?? []), ...(incoming ?? [])]) {
    const key = diagramKey(diagram);
    const existing = merged.get(key);
    if (!existing || diagram.confidence > existing.confidence) merged.set(key, diagram);
  }
  return [...merged.values()].sort((left, right) => left.pageId - right.pageId);
}

function textValue(
  current: string | null | undefined,
  incoming: string | null | undefined,
  partNumber: string
): string | null {
  if (credibleCatalogIdentityText(current, partNumber)) return current!.trim();
  if (credibleCatalogIdentityText(incoming, partNumber)) return incoming!.trim();
  return current?.trim() || incoming?.trim() || null;
}

function recordScore(catalog: GmCatalogPart, partNumber: string): number {
  const applications = catalog.applications ?? [];
  return (exactLinkSourcePages(catalog).length ? 30 : 0)
    + (credibleCatalogIdentityText(catalog.description, partNumber) ? 20 : 0)
    + (credibleCatalogIdentityText(catalog.productType, partNumber) ? 10 : 0)
    + (catalog.ebayCategory ? 15 : 0)
    + Math.min(20, (catalog.diagrams ?? []).length * 2)
    + Math.min(140, Math.max(0, ...applications.map(applicationScore)));
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function rangesAreDisjoint(current: GmCatalogPart, incoming: GmCatalogPart): boolean {
  const currentFirst = positiveInteger(current.rollup?.firstPageId);
  const currentLast = positiveInteger(current.rollup?.lastPageId);
  const incomingFirst = positiveInteger(incoming.rollup?.firstPageId);
  const incomingLast = positiveInteger(incoming.rollup?.lastPageId);
  return Boolean(
    currentFirst && currentLast && incomingFirst && incomingLast
    && (currentLast < incomingFirst || incomingLast < currentFirst)
  );
}

function rollupValue(catalog: GmCatalogPart, key: keyof GmCatalogPart['rollup']): number {
  const value = catalog.rollup?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Merge a versioned catalog import without allowing sparse new OCR output to
 * erase existing curated rows, diagrams, categories, or descriptions.
 */
export function mergeGmCatalogParts(current: GmCatalogPart, incoming: GmCatalogPart): GmCatalogPart {
  const currentKey = canonicalOemPartNumber(current.partNumber);
  const incomingKey = canonicalOemPartNumber(incoming.partNumber);
  if (!currentKey || currentKey !== incomingKey) {
    throw new Error('GM catalog merge requires one exact normalized part number');
  }

  const identityEvidence = mergeIdentityEvidence(current.identityEvidence, incoming.identityEvidence);
  const applications = mergeApplications(current.applications, incoming.applications);
  const diagrams = mergeDiagrams(current.diagrams, incoming.diagrams);
  const representative = recordScore(current, currentKey) >= recordScore(incoming, incomingKey)
    ? current
    : incoming;
  const disjoint = rangesAreDisjoint(current, incoming);
  const exactPages = pageIds(identityEvidence?.sourcePages);
  const firstPageCandidates = [
    positiveInteger(current.rollup?.firstPageId),
    positiveInteger(incoming.rollup?.firstPageId),
    exactPages.at(0) ?? null
  ].filter((value): value is number => value != null);
  const lastPageCandidates = [
    positiveInteger(current.rollup?.lastPageId),
    positiveInteger(incoming.rollup?.lastPageId),
    exactPages.at(-1) ?? null
  ].filter((value): value is number => value != null);
  const combineCount = (key: 'occurrenceCount' | 'pageCount' | 'catalogStatedOccurrences') => {
    const currentValue = rollupValue(current, key);
    const incomingValue = rollupValue(incoming, key);
    return disjoint ? currentValue + incomingValue : Math.max(currentValue, incomingValue);
  };
  const verificationState = [current.verificationState, incoming.verificationState]
    .some((value) => value?.toLowerCase() === 'catalog_stated')
    ? 'catalog_stated'
    : current.verificationState || incoming.verificationState;

  return {
    ...incoming,
    ...current,
    partNumber: currentKey,
    manufacturer: current.manufacturer || incoming.manufacturer || 'General Motors',
    divisions: [...new Set([...(current.divisions ?? []), ...(incoming.divisions ?? [])])].sort(),
    productType: textValue(current.productType, incoming.productType, currentKey),
    description: textValue(current.description, incoming.description, currentKey),
    catalogGroup: current.catalogGroup || incoming.catalogGroup || null,
    verificationState,
    ...(identityEvidence ? { identityEvidence } : {}),
    ...(current.ebayCategory || incoming.ebayCategory
      ? { ebayCategory: current.ebayCategory ?? incoming.ebayCategory }
      : {}),
    rollup: {
      occurrenceCount: Math.max(exactPages.length, combineCount('occurrenceCount')),
      pageCount: Math.max(exactPages.length, combineCount('pageCount')),
      catalogStatedOccurrences: Math.max(exactPages.length, combineCount('catalogStatedOccurrences')),
      firstPageId: firstPageCandidates.length ? Math.min(...firstPageCandidates) : 0,
      lastPageId: lastPageCandidates.length ? Math.max(...lastPageCandidates) : 0,
      representativePageId: representative.rollup?.representativePageId ?? exactPages.at(0) ?? null,
      representativeImageRef: representative.rollup?.representativeImageRef
        ?? (representative.rollup?.representativePageId
          ? `GM${representative.rollup.representativePageId}-FULL`
          : null),
      bestLayoutConfidence: Math.max(
        rollupValue(current, 'bestLayoutConfidence'),
        rollupValue(incoming, 'bestLayoutConfidence')
      ) || null
    },
    applications,
    diagrams
  };
}

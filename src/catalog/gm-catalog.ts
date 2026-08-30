export interface GmCatalogModel {
  year: number | null;
  division: string | null;
  modelName: string;
  seriesCode: string | null;
  derivationMethod: string;
  confidence: number;
  verificationState: string;
  sourcePageId: number;
}

export interface GmCatalogApplication {
  claimId: number;
  manufacturer: string;
  division: string | null;
  catalogTitle: string | null;
  catalogGroup: string | null;
  partName: string | null;
  description: string | null;
  groupHeading: string | null;
  componentFamily: string | null;
  supplier: string | null;
  applicationText: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  modelScope: string | null;
  equipmentQualifier: string | null;
  exclusion: string | null;
  position: string | null;
  quantity: string | null;
  sourcePageId: number;
  sourceUrl: string | null;
  imageRef: string | null;
  imageBlobKey: string | null;
  evidenceBox: Record<string, unknown> | null;
  evidenceContext: string | null;
  layoutLine: string | null;
  crossReference: string | null;
  relationMethod: string;
  confidence: number;
  verificationState: string;
  modelExpansionState: string;
  models: GmCatalogModel[];
}

export interface GmCatalogDiagram {
  pageId: number;
  catalogGroup: string | null;
  calloutLabel: string | null;
  title: string | null;
  illustrationNumber: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  sourceUrl: string;
  imageRef: string;
  imageBlobKey: string;
  displayRotationDegrees: number | null;
  evidenceBox: Record<string, unknown> | null;
  relationshipState: string;
  linkMethod: string;
  confidence: number;
  supplierMatch: string;
  yearRelationship: string;
  exactPartDepiction: boolean;
  isPrimary: boolean;
  rationale: string;
  verificationState: string;
}

export interface GmCatalogEbayCategory {
  marketplaceId: string;
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  source: 'EBAY_OFFICIAL_CATEGORY_FILE';
  classificationMode: 'RULE_EXACT_LEAF' | 'OTHER_FALLBACK_REVIEWED' | 'PENDING_RULE_REFINEMENT';
  categoryTreeId: string;
  categoryTreeVersion: string;
  verifiedAt: string;
}

export interface GmCatalogIdentityEvidence {
  method: string;
  verificationState: string;
  sourcePages: number[];
}

export interface GmCatalogCalloutBox {
  left: number;
  top: number;
  width: number;
  height: number;
  image_width: number;
  image_height: number;
  confidence?: number;
}

export interface GmCatalogCalloutEvidence {
  state: 'EXACT_ROW_AND_CALLOUT';
  partNumber: string;
  pageId: number;
  calloutId: string;
  catalogGroup: string | null;
  description: string | null;
  rowBox: GmCatalogCalloutBox;
  rowConfidence: number;
  calloutBoxes: GmCatalogCalloutBox[];
  sourceImageUrl: string;
  annotatedImageUrl: string;
  method: 'CERTIFIED_ROW_SPATIAL_OCR' | 'CATALOG_DIAGRAM_COORDINATES';
}

export interface GmCatalogPart {
  partNumber: string;
  manufacturer: string;
  divisions: string[];
  productType: string | null;
  description: string | null;
  catalogGroup: string | null;
  verificationState: string;
  identityEvidence?: GmCatalogIdentityEvidence;
  calloutEvidence?: GmCatalogCalloutEvidence;
  ebayCategory?: GmCatalogEbayCategory;
  rollup: {
    occurrenceCount: number;
    pageCount: number;
    catalogStatedOccurrences: number;
    firstPageId: number;
    lastPageId: number;
    representativePageId: number | null;
    representativeImageRef: string | null;
    bestLayoutConfidence: number | null;
  };
  applications: GmCatalogApplication[];
  diagrams: GmCatalogDiagram[];
}

export interface GmCatalogStatus {
  datasetId: string | null;
  status: 'not_started' | 'running' | 'completed' | 'failed';
  importedParts: number;
  availableParts: number;
  lastPartNumber: string | null;
}

export interface GmCatalogImportOptions {
  complete?: boolean;
  datasetId?: string;
}

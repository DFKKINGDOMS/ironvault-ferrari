export const MIGRATION_TABLE_NAMES = [
  'items',
  'evidence',
  'approvals',
  'listings',
  'images',
  'audit_events',
  'publish_slots',
  'seller_acknowledgements',
  'gm_catalog_parts',
  'gm_catalog_imports',
  'ebay_reference_cache',
  'community_submissions',
  'community_images',
  'ebay_categories',
  'ebay_category_assignments',
  'ebay_category_sync_state'
] as const;

export type MigrationTableName = (typeof MIGRATION_TABLE_NAMES)[number];

export interface MigrationTableManifest {
  table: MigrationTableName;
  rows: number;
  bytes: number;
}

export interface MigrationManifest {
  version: 1;
  generatedAt: string;
  excludedTables: readonly ['seller_connections', 'oauth_nonces', 'partquill_migrations'];
  tables: MigrationTableManifest[];
}

export interface MigrationExportPage {
  table: MigrationTableName;
  offset: number;
  nextOffset: number | null;
  rows: Record<string, unknown>[];
}

export interface MigrationImportResult {
  table: MigrationTableName;
  imported: number;
  totalRows: number;
}

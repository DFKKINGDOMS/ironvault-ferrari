CREATE SCHEMA IF NOT EXISTS partquill;

CREATE TABLE IF NOT EXISTS partquill.vintage_gm_imports (
  dataset_id text PRIMARY KEY,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_file_name text NOT NULL,
  source_total_rows integer NOT NULL CHECK (source_total_rows >= 0),
  expected_gm_rows integer NOT NULL CHECK (expected_gm_rows >= 0),
  imported_rows integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  normalized_rows integer NOT NULL DEFAULT 0 CHECK (normalized_rows >= 0),
  rejected_rows integer NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  distinct_part_numbers integer NOT NULL DEFAULT 0 CHECK (distinct_part_numbers >= 0),
  catalog_key_matches integer NOT NULL DEFAULT 0 CHECK (catalog_key_matches >= 0),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  active boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_detail text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vintage_gm_imports_active
  ON partquill.vintage_gm_imports(active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS partquill.vintage_gm_inventory (
  dataset_id text NOT NULL REFERENCES partquill.vintage_gm_imports(dataset_id) ON DELETE CASCADE,
  source_row integer NOT NULL CHECK (source_row >= 2),
  product_name text NOT NULL,
  sku text NOT NULL,
  part_number text,
  brand text NOT NULL CHECK (brand IN ('GM NA', 'GM FACTORY MOTOR PARTS', 'GM DIRECT ACCOUNTS')),
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  source_price numeric(16,4) NOT NULL CHECK (source_price >= 0),
  source_weight numeric(16,4) NOT NULL CHECK (source_weight >= 0),
  normalization_state text NOT NULL CHECK (normalization_state IN (
    'NORMALIZED_EXACT_KEY',
    'REJECTED_SCIENTIFIC_NOTATION',
    'REJECTED_EMPTY_SKU',
    'REJECTED_NO_DIGIT'
  )),
  normalization_issue text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, source_row),
  CHECK (
    (normalization_state = 'NORMALIZED_EXACT_KEY' AND part_number IS NOT NULL AND part_number ~ '^[A-Z0-9]+$')
    OR (normalization_state <> 'NORMALIZED_EXACT_KEY' AND part_number IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_vintage_gm_inventory_part_number
  ON partquill.vintage_gm_inventory(dataset_id, part_number)
  WHERE part_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_vintage_gm_inventory_in_stock
  ON partquill.vintage_gm_inventory(dataset_id, quantity, part_number)
  WHERE quantity > 0 AND part_number IS NOT NULL;

CREATE OR REPLACE VIEW partquill.vintage_gm_catalog_crosswalk AS
SELECT
  inventory.dataset_id,
  inventory.source_row,
  inventory.product_name,
  inventory.sku,
  inventory.part_number,
  inventory.brand,
  inventory.description,
  inventory.quantity,
  inventory.source_price,
  inventory.source_weight,
  inventory.normalization_state,
  inventory.normalization_issue,
  CASE
    WHEN inventory.part_number IS NULL THEN 'INVALID_SOURCE_SKU'
    WHEN catalog.part_number IS NULL THEN 'NOT_IN_GM_CATALOG'
    ELSE 'EXACT_CATALOG_KEY'
  END AS catalog_key_state,
  catalog.verification_state AS catalog_verification_state,
  catalog.data AS catalog_data
FROM partquill.vintage_gm_inventory AS inventory
JOIN partquill.vintage_gm_imports AS import_state
  ON import_state.dataset_id = inventory.dataset_id
LEFT JOIN partquill.gm_catalog_parts AS catalog
  ON catalog.part_number = inventory.part_number
WHERE import_state.active = true
  AND import_state.status = 'completed';

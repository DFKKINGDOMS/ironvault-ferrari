CREATE SCHEMA IF NOT EXISTS partquill;

CREATE TABLE IF NOT EXISTS partquill.seller_listing_imports (
  dataset_id text PRIMARY KEY,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_file_name text NOT NULL,
  snapshot_date date NOT NULL,
  source_total_rows integer NOT NULL CHECK (source_total_rows >= 0),
  expected_rows integer NOT NULL CHECK (expected_rows >= 0),
  imported_rows integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  normalized_rows integer NOT NULL DEFAULT 0 CHECK (normalized_rows >= 0),
  rejected_rows integer NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  distinct_part_numbers integer NOT NULL DEFAULT 0 CHECK (distinct_part_numbers >= 0),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  active boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_detail text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_listing_imports_active
  ON partquill.seller_listing_imports(active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS partquill.seller_listing_rows (
  dataset_id text NOT NULL REFERENCES partquill.seller_listing_imports(dataset_id) ON DELETE CASCADE,
  source_row integer NOT NULL CHECK (source_row >= 2),
  sku text NOT NULL,
  part_number text,
  title text NOT NULL,
  available_quantity integer NOT NULL CHECK (available_quantity >= 0),
  sold_quantity integer NOT NULL CHECK (sold_quantity >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  asking_price numeric(16,4) NOT NULL CHECK (asking_price >= 0),
  condition text NOT NULL,
  normalization_state text NOT NULL CHECK (normalization_state IN (
    'NORMALIZED_EXACT_KEY',
    'REJECTED_EMPTY_SKU',
    'REJECTED_SCIENTIFIC_NOTATION',
    'REJECTED_NO_DIGIT'
  )),
  normalization_issue text,
  title_search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, source_row),
  CHECK (
    (normalization_state = 'NORMALIZED_EXACT_KEY' AND part_number IS NOT NULL AND part_number ~ '^[A-Z0-9]+$')
    OR (normalization_state <> 'NORMALIZED_EXACT_KEY' AND part_number IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_seller_listing_rows_part_number
  ON partquill.seller_listing_rows(dataset_id, part_number)
  WHERE part_number IS NOT NULL AND available_quantity > 0;

CREATE INDEX IF NOT EXISTS ix_seller_listing_rows_title_search
  ON partquill.seller_listing_rows USING gin(title_search);

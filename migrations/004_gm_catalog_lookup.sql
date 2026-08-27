CREATE SCHEMA IF NOT EXISTS partquill;

CREATE TABLE IF NOT EXISTS partquill.gm_catalog_parts (
  part_number text PRIMARY KEY,
  verification_state text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gm_catalog_parts_verification
  ON partquill.gm_catalog_parts(verification_state);

CREATE TABLE IF NOT EXISTS partquill.gm_catalog_imports (
  dataset_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  row_count integer NOT NULL DEFAULT 0,
  last_part_number text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_detail text
);

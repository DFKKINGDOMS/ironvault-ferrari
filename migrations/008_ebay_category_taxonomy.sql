CREATE SCHEMA IF NOT EXISTS partquill;

CREATE TABLE IF NOT EXISTS partquill.ebay_categories (
  marketplace_id text NOT NULL DEFAULT 'EBAY_US',
  category_tree_id text NOT NULL,
  category_tree_version text NOT NULL,
  root_category_id text NOT NULL DEFAULT '6028',
  category_id text NOT NULL,
  parent_category_id text,
  category_name text NOT NULL,
  category_path text[] NOT NULL DEFAULT ARRAY[]::text[],
  category_level integer NOT NULL DEFAULT 0,
  leaf_category boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marketplace_id, category_id)
);

CREATE INDEX IF NOT EXISTS ix_ebay_categories_parent
  ON partquill.ebay_categories(marketplace_id, parent_category_id);
CREATE INDEX IF NOT EXISTS ix_ebay_categories_leaf
  ON partquill.ebay_categories(marketplace_id, leaf_category)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS partquill.ebay_category_assignments (
  part_number text PRIMARY KEY,
  marketplace_id text NOT NULL DEFAULT 'EBAY_US',
  category_id text,
  category_name text,
  category_path text,
  query text NOT NULL,
  source text NOT NULL CHECK (source IN ('EBAY_TAXONOMY_API', 'NO_SUGGESTION', 'OUTSIDE_MOTORS')),
  status text NOT NULL CHECK (status IN ('ASSIGNED', 'NO_SUGGESTION', 'OUTSIDE_MOTORS')),
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now(),
  raw_suggestion jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_ebay_category_assignments_category
  ON partquill.ebay_category_assignments(category_id)
  WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ebay_category_assignments_status
  ON partquill.ebay_category_assignments(status, verified_at);

CREATE TABLE IF NOT EXISTS partquill.ebay_category_sync_state (
  sync_name text PRIMARY KEY,
  status text NOT NULL,
  category_tree_id text,
  category_tree_version text,
  categories_imported integer NOT NULL DEFAULT 0,
  products_assigned bigint NOT NULL DEFAULT 0,
  products_pending bigint NOT NULL DEFAULT 0,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_detail text
);

COMMENT ON TABLE partquill.ebay_categories IS
  'Read-only EBAY_US Motors Parts & Accessories taxonomy rooted at category 6028.';
COMMENT ON TABLE partquill.ebay_category_assignments IS
  'Read-only eBay Taxonomy API category assignments for PartQuill catalog parts; never used to write to eBay.';

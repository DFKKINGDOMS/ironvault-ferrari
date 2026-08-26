CREATE TABLE IF NOT EXISTS partquill_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY,
  seller_id text NOT NULL,
  sku text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, sku)
);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_item_idx ON evidence(item_id, created_at);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('PREFLIGHT', 'PUBLIC')),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_item_hash_idx ON approvals(item_id, payload_hash, stage);

CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  seller_id text NOT NULL,
  offer_id text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_connections (
  seller_id text PRIMARY KEY,
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS images (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  seller_id text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  bytes bytea NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_item_idx ON images(item_id, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  seller_id text NOT NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'REJECTED', 'FAILED')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_item_idx ON audit_events(item_id, created_at);
CREATE INDEX IF NOT EXISTS audit_seller_action_idx ON audit_events(seller_id, action, outcome);

COMMENT ON TABLE approvals IS 'Append-only approval ledger. Approval validity is determined by exact payload hash and stage.';
COMMENT ON TABLE images IS 'Immutable image originals and derivatives. Binary bytes remain separate from JSON metadata.';

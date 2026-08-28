CREATE SCHEMA IF NOT EXISTS partquill;

CREATE TABLE IF NOT EXISTS partquill.ebay_reference_cache (
  part_number text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('MATCHED_LIVE_REFERENCE', 'NO_EXACT_MATCH', 'RIGHTS_CLEARED_ARCHIVE')),
  record jsonb NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz,
  retry_after timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ebay_reference_cache_expiry
  ON partquill.ebay_reference_cache(expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE partquill.ebay_reference_cache IS
  'Short-lived, visually isolated eBay references plus terminal rights-cleared archive markers. eBay seller photos are never durable assets without separate rights evidence.';

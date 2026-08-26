CREATE TABLE IF NOT EXISTS seller_acknowledgements (
  seller_id text NOT NULL,
  acknowledgement_type text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, acknowledgement_type)
);

COMMENT ON TABLE seller_acknowledgements IS 'Versioned seller disclosures required before the first Inventory API staging approval.';

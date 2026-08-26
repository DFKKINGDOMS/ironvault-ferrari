CREATE TABLE IF NOT EXISTS publish_slots (
  item_id uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  seller_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RESERVED', 'SUCCEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_slots_seller_status_idx ON publish_slots(seller_id, status);

CREATE TABLE IF NOT EXISTS oauth_nonces (
  nonce text PRIMARY KEY,
  seller_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_nonces_expiry_idx ON oauth_nonces(expires_at);

COMMENT ON TABLE publish_slots IS 'Atomic free-launch reservations. Failed external publishes release their reservation.';
COMMENT ON TABLE oauth_nonces IS 'One-time OAuth state nonces; signatures alone do not prevent state replay.';

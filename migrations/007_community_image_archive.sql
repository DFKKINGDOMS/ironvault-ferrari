CREATE SCHEMA IF NOT EXISTS partquill;

CREATE TABLE IF NOT EXISTS partquill.community_submissions (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  status_token_hash text NOT NULL CHECK (length(status_token_hash)=64),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_community_submissions_review
  ON partquill.community_submissions(status,created_at);

CREATE TABLE IF NOT EXISTS partquill.community_images (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES partquill.community_submissions(id) ON DELETE CASCADE,
  part_number text NOT NULL,
  status text NOT NULL,
  source_sha256 text NOT NULL CHECK (length(source_sha256)=64),
  visual_hash text NOT NULL CHECK (length(visual_hash)=16),
  source_bytes bytea NOT NULL,
  derivative_bytes bytea,
  archive_filename text,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(source_sha256),
  UNIQUE(archive_filename)
);

CREATE INDEX IF NOT EXISTS ix_community_images_submission
  ON partquill.community_images(submission_id,created_at);
CREATE INDEX IF NOT EXISTS ix_community_images_part
  ON partquill.community_images(part_number,status,updated_at);

COMMENT ON TABLE partquill.community_submissions IS
  'Rights-attested community reference-image submissions. Public credit is retained; private receipt and attestation fingerprints are never exposed.';
COMMENT ON TABLE partquill.community_images IS
  'Quarantined originals and approved derivatives. Only human-approved, AI-screened, source-QA-passed derivatives may reach the public reference archive.';

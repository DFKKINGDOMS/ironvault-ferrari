ALTER TABLE partquill.ebay_reference_cache
  DROP CONSTRAINT IF EXISTS ebay_reference_cache_status_check;

ALTER TABLE partquill.ebay_reference_cache
  ADD CONSTRAINT ebay_reference_cache_status_check
  CHECK (status IN ('MATCHED_LIVE_REFERENCE', 'NO_EXACT_MATCH', 'PRIVATE_REFERENCE_ARCHIVE', 'RIGHTS_CLEARED_ARCHIVE'));

COMMENT ON TABLE partquill.ebay_reference_cache IS
  'Short-lived eBay references, private personal-use archives, and terminal rights-cleared archive markers.';

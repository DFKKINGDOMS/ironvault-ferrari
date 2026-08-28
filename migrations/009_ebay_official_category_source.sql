ALTER TABLE partquill.ebay_category_assignments
  DROP CONSTRAINT IF EXISTS ebay_category_assignments_source_check;

ALTER TABLE partquill.ebay_category_assignments
  ADD CONSTRAINT ebay_category_assignments_source_check
  CHECK (
    source IN (
      'EBAY_TAXONOMY_API',
      'EBAY_OFFICIAL_CATEGORY_FILE',
      'NO_SUGGESTION',
      'OUTSIDE_MOTORS'
    )
  );

COMMENT ON TABLE partquill.ebay_categories IS
  'Read-only EBAY_US Motors Parts & Accessories taxonomy tree 100 rooted at category 6028, downloaded from the official eBay category structure file.';

COMMENT ON TABLE partquill.ebay_category_assignments IS
  'Internal PartQuill category assignments using the downloaded eBay taxonomy; this table is never used to write to eBay.';

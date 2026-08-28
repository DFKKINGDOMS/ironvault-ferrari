import pg from 'pg';
import type { AppConfig } from '../config.js';
import { buildCatalogListingIntelligence } from '../catalog/listing-intelligence.js';
import { normalizeGmCatalogPart } from '../catalog/gm-catalog-quality.js';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';

const { Pool } = pg;
const MARKETPLACE_ID = 'EBAY_US';
const MOTORS_ROOT_CATEGORY_ID = '6028';
const MOTORS_CATEGORY_TREE_ID = '100';
const OFFICIAL_CATEGORY_TREE_VERSION = 'US_JUNE_2026';
const OFFICIAL_CATEGORY_CSV_URL =
  'https://ir.ebaystatic.com/cr/v/c01/US_New_Structure_Jun2026.csv';
const OTHER_CAR_TRUCK_PARTS_CATEGORY_ID = '9886';
const TREE_REFRESH_MS = 24 * 60 * 60_000;
const ASSIGNMENT_INTERVAL_MS = 30_000;
const ASSIGNMENT_BATCH = 250;

interface CategoryRow {
  category_id: string;
  parent_category_id: string | null;
  category_name: string;
  category_path: string[];
  category_level: number;
  leaf_category: boolean;
}

interface StoredLeafCategory {
  category_id: string;
  category_name: string;
  category_path: string[];
}

interface LocalCategoryChoice extends StoredLeafCategory {
  classificationMode: 'RULE_EXACT_LEAF' | 'OTHER_FALLBACK_REVIEWED';
  confidence: number;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseOfficialMotorsPartsCsv(text: string): CategoryRow[] {
  const csv = parseCsv(text.replace(/^\uFEFF/, ''));
  const title = csv[0]?.[0]?.trim() ?? '';
  if (!title.includes('New Category Structure from June 1st, 2026 - US')) {
    throw new Error('Official eBay category file version was not the expected June 2026 US structure');
  }

  const pathNames: string[] = [];
  const pathIds: string[] = [];
  const result: CategoryRow[] = [];
  let insidePartsSubtree = false;

  for (const raw of csv) {
    const categoryId = (raw[6] ?? '').trim();
    let level = -1;
    let categoryName = '';
    for (let candidateLevel = 0; candidateLevel < 6; candidateLevel += 1) {
      const value = (raw[candidateLevel] ?? '').trim();
      if (value) {
        level = candidateLevel;
        categoryName = value;
        break;
      }
    }
    if (level < 0 || !categoryId || !/^\d+$/.test(categoryId)) continue;

    if (!insidePartsSubtree) {
      if (categoryId !== MOTORS_ROOT_CATEGORY_ID) continue;
      insidePartsSubtree = true;
      pathNames[0] = 'eBay Motors';
      pathIds[0] = '6000';
    } else if (level <= 1 && categoryId !== MOTORS_ROOT_CATEGORY_ID) {
      break;
    }

    pathNames.length = level;
    pathIds.length = level;
    pathNames[level] = categoryName;
    pathIds[level] = categoryId;

    const parentCategoryId =
      categoryId === MOTORS_ROOT_CATEGORY_ID ? null : (pathIds[level - 1] ?? null);
    if (categoryId !== MOTORS_ROOT_CATEGORY_ID && !parentCategoryId) {
      throw new Error('Official eBay category file contained an incomplete Motors category path');
    }

    result.push({
      category_id: categoryId,
      parent_category_id: parentCategoryId,
      category_name: categoryName,
      category_path: pathNames.slice(0, level + 1),
      category_level: Math.max(0, level - 1),
      leaf_category: false
    });
  }

  const parentIds = new Set(
    result
      .map((category) => category.parent_category_id)
      .filter((categoryId): categoryId is string => Boolean(categoryId))
  );
  for (const category of result) {
    category.leaf_category = !parentIds.has(category.category_id);
  }

  const ids = new Set(result.map((category) => category.category_id));
  if (
    result.length < 1_500 ||
    !ids.has(MOTORS_ROOT_CATEGORY_ID) ||
    !ids.has('6030') ||
    !ids.has(OTHER_CAR_TRUCK_PARTS_CATEGORY_ID)
  ) {
    throw new Error('Official eBay Motors Parts & Accessories category subtree was incomplete');
  }
  return result;
}

class ReadOnlyOfficialEbayCategoryClient {
  async categories(): Promise<CategoryRow[]> {
    const response = await fetch(OFFICIAL_CATEGORY_CSV_URL, {
      method: 'GET',
      headers: { Accept: 'text/csv,text/plain;q=0.9' },
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) {
      throw new Error('Official eBay category file download failed (' + response.status + ')');
    }
    const body = await response.text();
    if (body.length < 100_000) {
      throw new Error('Official eBay category file download was unexpectedly small');
    }
    return parseOfficialMotorsPartsCsv(body);
  }
}

function normalizeCategoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseLocalCategory(
  categories: StoredLeafCategory[],
  catalog: GmCatalogPart | undefined
): LocalCategoryChoice | undefined {
  const intelligence = catalog ? buildCatalogListingIntelligence(catalog) : undefined;
  const candidateName = intelligence?.category.categoryName?.trim();
  const candidatePath = intelligence?.category.categoryPath?.trim();
  const expectedName = candidateName ? normalizeCategoryText(candidateName) : '';
  const expectedPath = candidatePath ? normalizeCategoryText(candidatePath) : '';

  if (expectedName) {
    const exactNameMatches = categories
      .filter((category) => normalizeCategoryText(category.category_name) === expectedName)
      .sort((left, right) => {
        const leftPath = normalizeCategoryText(left.category_path.join(' › '));
        const rightPath = normalizeCategoryText(right.category_path.join(' › '));
        const leftExact = leftPath === expectedPath ? 1 : 0;
        const rightExact = rightPath === expectedPath ? 1 : 0;
        if (leftExact !== rightExact) return rightExact - leftExact;
        const leftCarTruck = left.category_path.includes('Car & Truck Parts & Accessories') ? 1 : 0;
        const rightCarTruck = right.category_path.includes('Car & Truck Parts & Accessories') ? 1 : 0;
        if (leftCarTruck !== rightCarTruck) return rightCarTruck - leftCarTruck;
        return right.category_path.length - left.category_path.length;
      });
    const exact = exactNameMatches[0];
    if (exact) {
      return {
        ...exact,
        classificationMode: 'RULE_EXACT_LEAF',
        confidence: Math.max(0.5, intelligence?.category.confidence ?? 0.5)
      };
    }
  }

  const fallback = categories.find(
    (category) => category.category_id === OTHER_CAR_TRUCK_PARTS_CATEGORY_ID
  );
  return fallback
    ? {
        ...fallback,
        classificationMode: 'OTHER_FALLBACK_REVIEWED',
        confidence: 0.25
      }
    : undefined;
}

export interface EbayCategorySyncController {
  stop(): Promise<void>;
}

export function startEbayCategoryTaxonomySync(
  config: AppConfig
): EbayCategorySyncController | undefined {
  if (!config.DATABASE_URL) return undefined;
  if (!/^(1|true|yes|on)$/i.test(String(process.env.EBAY_CATEGORY_SYNC_ENABLED ?? 'false'))) {
    console.log('PARTQUILL_EBAY_CATEGORY_SYNC_DISABLED');
    return undefined;
  }
  if (config.ALLOW_EBAY_WRITES || config.EBAY_MODE !== 'mock') {
    throw new Error(
      'Read-only category sync requires EBAY_MODE=mock and ALLOW_EBAY_WRITES=false'
    );
  }

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 30_000
  });
  const treeClient = new ReadOnlyOfficialEbayCategoryClient();
  let stopped = false;
  let treeRunning = false;
  let assignmentRunning = false;
  let leafCategoryCache: StoredLeafCategory[] = [];

  const refreshCounts = async (): Promise<void> => {
    await pool.query(
      [
        'WITH counts AS (',
        '  SELECT',
        "    count(*) FILTER (WHERE a.status='ASSIGNED') AS assigned,",
        '    count(*) FILTER (WHERE',
        "      a.part_number IS NULL OR a.status<>'ASSIGNED' OR",
        "      a.raw_suggestion->>'classificationMode'='PENDING_RULE_REFINEMENT'",
        '    ) AS pending',
        '  FROM partquill.gm_catalog_parts p',
        '  LEFT JOIN partquill.ebay_category_assignments a',
        '    ON a.part_number=p.part_number',
        ')',
        'INSERT INTO partquill.ebay_category_sync_state(',
        '  sync_name,status,products_assigned,products_pending,updated_at',
        ')',
        "SELECT 'EBAY_US_MOTORS',",
        "  CASE WHEN pending=0 THEN 'completed' ELSE 'running' END,",
        '  assigned,pending,now()',
        'FROM counts',
        'ON CONFLICT(sync_name) DO UPDATE SET',
        '  status=EXCLUDED.status,',
        '  products_assigned=EXCLUDED.products_assigned,',
        '  products_pending=EXCLUDED.products_pending,',
        '  updated_at=now()'
      ].join('\n')
    );
  };

  const ensureFallbackCoverage = async (): Promise<number> => {
    const fallback = leafCategoryCache.find(
      (category) => category.category_id === OTHER_CAR_TRUCK_PARTS_CATEGORY_ID
    );
    if (!fallback) throw new Error('eBay category 9886 fallback was not imported');

    const fallbackPath = fallback.category_path.join(' › ');
    const covered = await pool.query(
      [
        'WITH upserted AS (',
        '  INSERT INTO partquill.ebay_category_assignments(',
        '    part_number,marketplace_id,category_id,category_name,category_path,',
        '    query,source,status,confidence,assigned_at,verified_at,raw_suggestion',
        '  )',
        '  SELECT',
        '    p.part_number,$1,$2,$3,$4,',
        "    'automotive replacement part ' || p.part_number,",
        "    'EBAY_OFFICIAL_CATEGORY_FILE','ASSIGNED',0.25,now(),now(),",
        '    jsonb_build_object(',
        "      'classificationMode','PENDING_RULE_REFINEMENT',",
        "      'taxonomySource',$5::text,",
        "      'categoryTreeId',$6::text,",
        "      'categoryTreeVersion',$7::text",
        '    )',
        '  FROM partquill.gm_catalog_parts p',
        '  ON CONFLICT(part_number) DO UPDATE SET',
        '    marketplace_id=EXCLUDED.marketplace_id,',
        '    category_id=EXCLUDED.category_id,',
        '    category_name=EXCLUDED.category_name,',
        '    category_path=EXCLUDED.category_path,',
        '    source=EXCLUDED.source,',
        '    status=EXCLUDED.status,',
        '    confidence=EXCLUDED.confidence,',
        '    verified_at=now(),',
        '    raw_suggestion=EXCLUDED.raw_suggestion',
        "  WHERE partquill.ebay_category_assignments.status<>'ASSIGNED'",
        '  RETURNING part_number',
        ')',
        'UPDATE partquill.gm_catalog_parts p SET',
        '  data=jsonb_set(',
        "    p.data,'{ebayCategory}',",
        '    jsonb_build_object(',
        "      'marketplaceId',$1::text,",
        "      'categoryId',$2::text,",
        "      'categoryName',$3::text,",
        "      'categoryPath',$4::text,",
        "      'source','EBAY_OFFICIAL_CATEGORY_FILE',",
        "      'classificationMode','PENDING_RULE_REFINEMENT',",
        "      'categoryTreeId',$6::text,",
        "      'categoryTreeVersion',$7::text,",
        "      'verifiedAt',now()",
        '    ),true',
        '  ),',
        '  updated_at=now()',
        'FROM upserted u',
        'WHERE p.part_number=u.part_number'
      ].join('\n'),
      [
        MARKETPLACE_ID,
        fallback.category_id,
        fallback.category_name,
        fallbackPath,
        OFFICIAL_CATEGORY_CSV_URL,
        MOTORS_CATEGORY_TREE_ID,
        OFFICIAL_CATEGORY_TREE_VERSION
      ]
    );
    return covered.rowCount ?? 0;
  };

  const syncTree = async (): Promise<void> => {
    if (stopped || treeRunning) return;
    treeRunning = true;
    try {
      await pool.query(
        [
          'INSERT INTO partquill.ebay_category_sync_state(',
          '  sync_name,status,last_started_at,updated_at',
          ')',
          "VALUES('EBAY_US_MOTORS','running',now(),now())",
          'ON CONFLICT(sync_name) DO UPDATE SET',
          "  status='running',last_started_at=now(),updated_at=now(),error_detail=NULL"
        ].join('\n')
      );

      const rows = await treeClient.categories();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          [
            'UPDATE partquill.ebay_categories SET active=false',
            'WHERE marketplace_id=$1 AND root_category_id=$2'
          ].join('\n'),
          [MARKETPLACE_ID, MOTORS_ROOT_CATEGORY_ID]
        );
        for (let offset = 0; offset < rows.length; offset += 500) {
          const batch = rows.slice(offset, offset + 500);
          await client.query(
            [
              'INSERT INTO partquill.ebay_categories(',
              '  marketplace_id,category_tree_id,category_tree_version,root_category_id,',
              '  category_id,parent_category_id,category_name,category_path,',
              '  category_level,leaf_category,active,fetched_at',
              ')',
              'SELECT $1,$2,$3,$4,',
              '  item.category_id,item.parent_category_id,item.category_name,item.category_path,',
              '  item.category_level,item.leaf_category,true,now()',
              'FROM jsonb_to_recordset($5::jsonb) AS item(',
              '  category_id text,parent_category_id text,category_name text,category_path text[],',
              '  category_level integer,leaf_category boolean',
              ')',
              'ON CONFLICT(marketplace_id,category_id) DO UPDATE SET',
              '  category_tree_id=EXCLUDED.category_tree_id,',
              '  category_tree_version=EXCLUDED.category_tree_version,',
              '  root_category_id=EXCLUDED.root_category_id,',
              '  parent_category_id=EXCLUDED.parent_category_id,',
              '  category_name=EXCLUDED.category_name,',
              '  category_path=EXCLUDED.category_path,',
              '  category_level=EXCLUDED.category_level,',
              '  leaf_category=EXCLUDED.leaf_category,',
              '  active=true,',
              '  fetched_at=now()'
            ].join('\n'),
            [
              MARKETPLACE_ID,
              MOTORS_CATEGORY_TREE_ID,
              OFFICIAL_CATEGORY_TREE_VERSION,
              MOTORS_ROOT_CATEGORY_ID,
              JSON.stringify(batch)
            ]
          );
        }
        await client.query(
          [
            'UPDATE partquill.ebay_category_sync_state SET',
            "  status='running',category_tree_id=$2,category_tree_version=$3,",
            '  categories_imported=$4,last_completed_at=now(),updated_at=now(),error_detail=NULL',
            'WHERE sync_name=$1'
          ].join('\n'),
          [
            'EBAY_US_MOTORS',
            MOTORS_CATEGORY_TREE_ID,
            OFFICIAL_CATEGORY_TREE_VERSION,
            rows.length
          ]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      leafCategoryCache = rows
        .filter((category) => category.leaf_category)
        .map((category) => ({
          category_id: category.category_id,
          category_name: category.category_name,
          category_path: category.category_path
        }));
      const fallbackCovered = await ensureFallbackCoverage();
      await refreshCounts();
      console.log(
        'PARTQUILL_EBAY_MOTORS_TREE_SYNCED',
        JSON.stringify({
          marketplace: MARKETPLACE_ID,
          rootCategoryId: MOTORS_ROOT_CATEGORY_ID,
          treeId: MOTORS_CATEGORY_TREE_ID,
          version: OFFICIAL_CATEGORY_TREE_VERSION,
          categories: rows.length,
          fallbackCovered,
          source: OFFICIAL_CATEGORY_CSV_URL,
          requestMethod: 'GET',
          sellerTokenUsed: false,
          readOnly: true
        })
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message.slice(0, 1_000) : 'unknown taxonomy failure';
      await pool
        .query(
          [
            'INSERT INTO partquill.ebay_category_sync_state(',
            '  sync_name,status,error_detail,updated_at',
            ')',
            "VALUES('EBAY_US_MOTORS','failed',$1,now())",
            'ON CONFLICT(sync_name) DO UPDATE SET',
            "  status='failed',error_detail=$1,updated_at=now()"
          ].join('\n'),
          [detail]
        )
        .catch(() => undefined);
      console.error('PARTQUILL_EBAY_MOTORS_TREE_SYNC_FAILED', detail);
    } finally {
      treeRunning = false;
    }
  };

  const loadLeafCategories = async (): Promise<StoredLeafCategory[]> => {
    if (leafCategoryCache.length) return leafCategoryCache;
    const stored = await pool.query<StoredLeafCategory>(
      [
        'SELECT category_id,category_name,category_path',
        'FROM partquill.ebay_categories',
        'WHERE marketplace_id=$1 AND root_category_id=$2',
        '  AND active=true AND leaf_category=true'
      ].join('\n'),
      [MARKETPLACE_ID, MOTORS_ROOT_CATEGORY_ID]
    );
    leafCategoryCache = stored.rows;
    return leafCategoryCache;
  };

  const assignBatch = async (): Promise<number> => {
    if (stopped || assignmentRunning) return 0;
    assignmentRunning = true;
    try {
      const categories = await loadLeafCategories();
      if (categories.length < 500) {
        console.log('PARTQUILL_EBAY_CATEGORY_BATCH_DEFERRED', JSON.stringify({
          reason: 'taxonomy_not_ready',
          readOnly: true
        }));
        return 0;
      }

      const pending = await pool.query<{ part_number: string; data: GmCatalogPart }>(
        [
          'SELECT p.part_number,p.data',
          'FROM partquill.gm_catalog_parts p',
          'LEFT JOIN partquill.ebay_category_assignments a',
          '  ON a.part_number=p.part_number',
          'WHERE a.part_number IS NULL',
          "   OR a.status<>'ASSIGNED'",
          "   OR a.raw_suggestion->>'classificationMode'='PENDING_RULE_REFINEMENT'",
          '   OR NOT EXISTS(',
          '     SELECT 1 FROM partquill.ebay_categories c',
          '     WHERE c.marketplace_id=$1 AND c.category_id=a.category_id AND c.active=true',
          '   )',
          'ORDER BY',
          "  CASE WHEN a.raw_suggestion->>'classificationMode'='PENDING_RULE_REFINEMENT'",
          '    THEN 0 ELSE 1 END,',
          '  a.verified_at NULLS FIRST,',
          '  p.part_number',
          'LIMIT $2'
        ].join('\n'),
        [MARKETPLACE_ID, ASSIGNMENT_BATCH]
      );

      let specific = 0;
      let fallback = 0;
      for (const row of pending.rows) {
        if (stopped) break;
        const catalog = normalizeGmCatalogPart(row.data, row.part_number);
        const intelligence = catalog ? buildCatalogListingIntelligence(catalog) : undefined;
        const query =
          intelligence?.category.query || 'automotive replacement part ' + row.part_number;
        const choice = chooseLocalCategory(categories, catalog);
        if (!choice) continue;
        if (choice.classificationMode === 'RULE_EXACT_LEAF') specific += 1;
        else fallback += 1;

        const categoryPath = choice.category_path.join(' › ');
        await pool.query(
          [
            'INSERT INTO partquill.ebay_category_assignments(',
            '  part_number,marketplace_id,category_id,category_name,category_path,',
            '  query,source,status,confidence,assigned_at,verified_at,raw_suggestion',
            ')',
            'VALUES(',
            "  $1,$2,$3,$4,$5,$6,'EBAY_OFFICIAL_CATEGORY_FILE','ASSIGNED',$7,",
            '  now(),now(),$8::jsonb',
            ')',
            'ON CONFLICT(part_number) DO UPDATE SET',
            '  marketplace_id=EXCLUDED.marketplace_id,',
            '  category_id=EXCLUDED.category_id,',
            '  category_name=EXCLUDED.category_name,',
            '  category_path=EXCLUDED.category_path,',
            '  query=EXCLUDED.query,',
            '  source=EXCLUDED.source,',
            '  status=EXCLUDED.status,',
            '  confidence=EXCLUDED.confidence,',
            '  verified_at=now(),',
            '  raw_suggestion=EXCLUDED.raw_suggestion'
          ].join('\n'),
          [
            row.part_number,
            MARKETPLACE_ID,
            choice.category_id,
            choice.category_name,
            categoryPath,
            query,
            choice.confidence,
            JSON.stringify({
              classificationMode: choice.classificationMode,
              candidateName: intelligence?.category.categoryName ?? null,
              candidatePath: intelligence?.category.categoryPath ?? null,
              taxonomySource: OFFICIAL_CATEGORY_CSV_URL,
              categoryTreeId: MOTORS_CATEGORY_TREE_ID,
              categoryTreeVersion: OFFICIAL_CATEGORY_TREE_VERSION
            })
          ]
        );

        await pool.query(
          [
            'UPDATE partquill.gm_catalog_parts SET',
            '  data=jsonb_set(',
            "    data,'{ebayCategory}',",
            '    jsonb_build_object(',
            "      'marketplaceId',$2::text,",
            "      'categoryId',$3::text,",
            "      'categoryName',$4::text,",
            "      'categoryPath',$5::text,",
            "      'source','EBAY_OFFICIAL_CATEGORY_FILE',",
            "      'classificationMode',$6::text,",
            "      'categoryTreeId',$7::text,",
            "      'categoryTreeVersion',$8::text,",
            "      'verifiedAt',now()",
            '    ),true',
            '  ),',
            '  updated_at=now()',
            'WHERE part_number=$1'
          ].join('\n'),
          [
            row.part_number,
            MARKETPLACE_ID,
            choice.category_id,
            choice.category_name,
            categoryPath,
            choice.classificationMode,
            MOTORS_CATEGORY_TREE_ID,
            OFFICIAL_CATEGORY_TREE_VERSION
          ]
        );
      }

      await refreshCounts();
      const attempted = pending.rowCount ?? pending.rows.length;
      if (attempted) {
        console.log(
          'PARTQUILL_EBAY_CATEGORY_BATCH',
          JSON.stringify({ attempted, specific, fallback, readOnly: true })
        );
      }
      return attempted;
    } catch (error) {
      console.error(
        'PARTQUILL_EBAY_CATEGORY_BATCH_FAILED',
        error instanceof Error ? error.message : 'unknown'
      );
      return 0;
    } finally {
      assignmentRunning = false;
    }
  };

  void syncTree().then(() => assignBatch());
  const treeTimer = setInterval(() => void syncTree(), TREE_REFRESH_MS);
  const assignmentTimer = setInterval(() => void assignBatch(), ASSIGNMENT_INTERVAL_MS);
  treeTimer.unref();
  assignmentTimer.unref();

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(treeTimer);
      clearInterval(assignmentTimer);
      await pool.end();
    }
  };
}

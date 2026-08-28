import pg from 'pg';
import type { AppConfig } from '../config.js';
import { buildCatalogListingIntelligence } from '../catalog/listing-intelligence.js';
import { normalizeGmCatalogPart } from '../catalog/gm-catalog-quality.js';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { EbayTaxonomyClient } from './taxonomy-client.js';

const { Pool } = pg;
const MARKETPLACE_ID = 'EBAY_US';
const MOTORS_ROOT_CATEGORY_ID = '6028';
const TREE_REFRESH_MS = 24 * 60 * 60_000;
const ASSIGNMENT_INTERVAL_MS = 5 * 60_000;
const ASSIGNMENT_BATCH = 10;

interface CategoryTreeNode {
  category?: { categoryId?: string; categoryName?: string };
  categoryTreeNodeLevel?: number;
  leafCategoryTreeNode?: boolean;
  childCategoryTreeNodes?: CategoryTreeNode[];
}

interface CategorySubtreeResponse {
  categoryTreeId?: string;
  categoryTreeVersion?: string;
  categorySubtreeNode?: CategoryTreeNode;
}

interface CategoryRow {
  category_id: string;
  parent_category_id: string | null;
  category_name: string;
  category_path: string[];
  category_level: number;
  leaf_category: boolean;
}

function flattenCategoryTree(
  node: CategoryTreeNode,
  parentCategoryId: string | null = null,
  ancestors: string[] = []
): CategoryRow[] {
  const categoryId = node.category?.categoryId?.trim();
  const categoryName = node.category?.categoryName?.trim();
  if (!categoryId || !categoryName) return [];
  const categoryPath = [...ancestors, categoryName];
  const current: CategoryRow = {
    category_id: categoryId,
    parent_category_id: parentCategoryId,
    category_name: categoryName,
    category_path: categoryPath,
    category_level: Number(node.categoryTreeNodeLevel ?? Math.max(0, categoryPath.length - 1)),
    leaf_category: Boolean(node.leafCategoryTreeNode ?? !(node.childCategoryTreeNodes?.length))
  };
  return [
    current,
    ...(node.childCategoryTreeNodes ?? []).flatMap((child) =>
      flattenCategoryTree(child, categoryId, categoryPath)
    )
  ];
}

class ReadOnlyEbayCategoryTreeClient {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: AppConfig) {}

  private async applicationToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.config.EBAY_CLIENT_ID || !this.config.EBAY_CLIENT_SECRET) {
      throw new Error('eBay application credentials are not configured');
    }
    const credentials = Buffer.from(
      `${this.config.EBAY_CLIENT_ID}:${this.config.EBAY_CLIENT_SECRET}`
    ).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope'
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay application token failed (${response.status})`);
    const parsed = JSON.parse(body) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) throw new Error('eBay application token response was incomplete');
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + Math.max(300, parsed.expires_in ?? 7_200) * 1_000
    };
    return parsed.access_token;
  }

  private async get(path: string): Promise<unknown> {
    const response = await fetch(`https://api.ebay.com${path}`, {
      headers: {
        Authorization: `Bearer ${await this.applicationToken()}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(45_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay Taxonomy API failed (${response.status})`);
    return body ? JSON.parse(body) : {};
  }

  private async shoppingCategoryInfo(categoryId: string): Promise<{
    version?: string;
    categories: Array<{
      CategoryID?: string;
      CategoryName?: string;
      CategoryParentID?: string;
      CategoryLevel?: number | string;
      LeafCategory?: boolean | string;
    }>;
  }> {
    if (!this.config.EBAY_CLIENT_ID) throw new Error('eBay application ID is not configured');
    const params = new URLSearchParams({
      callname: 'GetCategoryInfo',
      responseencoding: 'JSON',
      appid: this.config.EBAY_CLIENT_ID,
      siteid: '0',
      version: '1193',
      CategoryID: categoryId,
      IncludeSelector: 'ChildCategories'
    });
    const response = await fetch(`https://open.api.ebay.com/shopping?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay Shopping category API failed (${response.status})`);
    const parsed = JSON.parse(body) as {
      Ack?: string;
      Version?: string;
      Errors?: Array<{ LongMessage?: string; ShortMessage?: string }>;
      CategoryArray?: { Category?: unknown };
    };
    if (!['Success', 'Warning'].includes(String(parsed.Ack ?? ''))) {
      const detail = parsed.Errors?.[0]?.LongMessage ?? parsed.Errors?.[0]?.ShortMessage ?? 'unknown response';
      throw new Error(`eBay Shopping category API rejected request: ${detail}`);
    }
    const raw = parsed.CategoryArray?.Category;
    const categories = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return { version: parsed.Version, categories };
  }

  private async shoppingSubtree(): Promise<CategorySubtreeResponse> {
    const nodes = new Map<string, CategoryTreeNode>();
    const parents = new Map<string, string | null>();
    const queue = [MOTORS_ROOT_CATEGORY_ID];
    const visited = new Set<string>();
    let version = 'shopping-current';

    while (queue.length) {
      const categoryId = queue.shift()!;
      if (visited.has(categoryId)) continue;
      visited.add(categoryId);
      const result = await this.shoppingCategoryInfo(categoryId);
      version = result.version ?? version;
      for (const row of result.categories) {
        const id = String(row.CategoryID ?? '').trim();
        const name = String(row.CategoryName ?? '').trim();
        if (!id || !name) continue;
        const leaf = String(row.LeafCategory ?? '').toLowerCase() === 'true';
        const level = Number(row.CategoryLevel ?? 0);
        const parent = id === MOTORS_ROOT_CATEGORY_ID
          ? null
          : String(row.CategoryParentID ?? categoryId).trim() || categoryId;
        const existing = nodes.get(id);
        nodes.set(id, {
          category: { categoryId: id, categoryName: name },
          categoryTreeNodeLevel: Number.isFinite(level) ? level : 0,
          leafCategoryTreeNode: leaf,
          childCategoryTreeNodes: existing?.childCategoryTreeNodes ?? []
        });
        parents.set(id, parent);
        if (parent === categoryId && !leaf && id !== categoryId && !visited.has(id)) queue.push(id);
      }
      for (const row of result.categories) {
        const id = String(row.CategoryID ?? '').trim();
        const parent = String(row.CategoryParentID ?? '').trim();
        const leaf = String(row.LeafCategory ?? '').toLowerCase() === 'true';
        if (id && id !== categoryId && parent === categoryId && !leaf && !visited.has(id)) queue.push(id);
      }
    }

    for (const [id, parentId] of parents) {
      if (!parentId || id === MOTORS_ROOT_CATEGORY_ID) continue;
      const parent = nodes.get(parentId);
      const child = nodes.get(id);
      if (parent && child && !parent.childCategoryTreeNodes?.some((node) => node.category?.categoryId === id)) {
        (parent.childCategoryTreeNodes ??= []).push(child);
      }
    }
    const root = nodes.get(MOTORS_ROOT_CATEGORY_ID);
    if (!root) throw new Error('eBay Shopping API did not return the Motors root category');
    return {
      categoryTreeId: '0',
      categoryTreeVersion: version,
      categorySubtreeNode: root
    };
  }

  async subtree(): Promise<CategorySubtreeResponse> {
    try {
      const tree = await this.get(
        `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${MARKETPLACE_ID}`
      ) as { categoryTreeId?: string };
      if (!tree.categoryTreeId) throw new Error('eBay category tree response was incomplete');
      return await this.get(
        `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(tree.categoryTreeId)}` +
        `/get_category_subtree?category_id=${MOTORS_ROOT_CATEGORY_ID}`
      ) as CategorySubtreeResponse;
    } catch (error) {
      console.warn('PARTQUILL_EBAY_TAXONOMY_OAUTH_FALLBACK', JSON.stringify({
        reason: error instanceof Error ? error.message : 'unknown',
        fallback: 'SHOPPING_API_APP_ID_ONLY',
        sellerTokenUsed: false
      }));
      return this.shoppingSubtree();
    }
  }
}

export interface EbayCategorySyncController {
  stop(): Promise<void>;
}

export function startEbayCategoryTaxonomySync(config: AppConfig): EbayCategorySyncController | undefined {
  if (!config.DATABASE_URL) return undefined;
  if (!/^(1|true|yes|on)$/i.test(String(process.env.EBAY_CATEGORY_SYNC_ENABLED ?? 'false'))) {
    console.log('PARTQUILL_EBAY_CATEGORY_SYNC_DISABLED');
    return undefined;
  }
  if (config.ALLOW_EBAY_WRITES || config.EBAY_MODE !== 'mock') {
    throw new Error('Read-only category sync requires EBAY_MODE=mock and ALLOW_EBAY_WRITES=false');
  }
  if (!config.EBAY_CLIENT_ID || !config.EBAY_CLIENT_SECRET) {
    throw new Error('Read-only category sync requires eBay application credentials');
  }

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 30_000
  });
  const treeClient = new ReadOnlyEbayCategoryTreeClient(config);
  const suggestionClient = new EbayTaxonomyClient(config);
  let stopped = false;
  let treeRunning = false;
  let assignmentRunning = false;

  const refreshCounts = async (): Promise<void> => {
    await pool.query(`
      INSERT INTO partquill.ebay_category_sync_state(
        sync_name,status,products_assigned,products_pending,updated_at
      )
      VALUES(
        'EBAY_US_MOTORS','running',
        (SELECT count(*) FROM partquill.ebay_category_assignments WHERE status='ASSIGNED'),
        (SELECT count(*) FROM partquill.gm_catalog_parts p
          WHERE NOT EXISTS (
            SELECT 1 FROM partquill.ebay_category_assignments a
            WHERE a.part_number=p.part_number
          )),
        now()
      )
      ON CONFLICT(sync_name) DO UPDATE SET
        products_assigned=EXCLUDED.products_assigned,
        products_pending=EXCLUDED.products_pending,
        updated_at=now()
    `);
  };

  const syncTree = async (): Promise<void> => {
    if (stopped || treeRunning) return;
    treeRunning = true;
    try {
      await pool.query(`
        INSERT INTO partquill.ebay_category_sync_state(sync_name,status,last_started_at,updated_at)
        VALUES('EBAY_US_MOTORS','running',now(),now())
        ON CONFLICT(sync_name) DO UPDATE SET
          status='running',last_started_at=now(),updated_at=now(),error_detail=NULL
      `);
      const subtree = await treeClient.subtree();
      const treeId = subtree.categoryTreeId;
      const version = subtree.categoryTreeVersion;
      const rows = subtree.categorySubtreeNode
        ? flattenCategoryTree(subtree.categorySubtreeNode)
        : [];
      if (!treeId || !version || rows.length < 25 || !rows.some((row) => row.category_id === MOTORS_ROOT_CATEGORY_ID)) {
        throw new Error('eBay Motors category subtree was incomplete');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE partquill.ebay_categories SET active=false
           WHERE marketplace_id=$1 AND root_category_id=$2`,
          [MARKETPLACE_ID, MOTORS_ROOT_CATEGORY_ID]
        );
        for (let offset = 0; offset < rows.length; offset += 500) {
          const batch = rows.slice(offset, offset + 500);
          await client.query(
            `INSERT INTO partquill.ebay_categories(
               marketplace_id,category_tree_id,category_tree_version,root_category_id,
               category_id,parent_category_id,category_name,category_path,
               category_level,leaf_category,active,fetched_at
             )
             SELECT $1,$2,$3,$4,
               item.category_id,item.parent_category_id,item.category_name,item.category_path,
               item.category_level,item.leaf_category,true,now()
             FROM jsonb_to_recordset($5::jsonb) AS item(
               category_id text,parent_category_id text,category_name text,category_path text[],
               category_level integer,leaf_category boolean
             )
             ON CONFLICT(marketplace_id,category_id) DO UPDATE SET
               category_tree_id=EXCLUDED.category_tree_id,
               category_tree_version=EXCLUDED.category_tree_version,
               root_category_id=EXCLUDED.root_category_id,
               parent_category_id=EXCLUDED.parent_category_id,
               category_name=EXCLUDED.category_name,
               category_path=EXCLUDED.category_path,
               category_level=EXCLUDED.category_level,
               leaf_category=EXCLUDED.leaf_category,
               active=true,
               fetched_at=now()`,
            [MARKETPLACE_ID, treeId, version, MOTORS_ROOT_CATEGORY_ID, JSON.stringify(batch)]
          );
        }
        await client.query(
          `UPDATE partquill.ebay_category_sync_state SET
             status='running',category_tree_id=$2,category_tree_version=$3,
             categories_imported=$4,last_completed_at=now(),updated_at=now(),error_detail=NULL
           WHERE sync_name=$1`,
          ['EBAY_US_MOTORS', treeId, version, rows.length]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await refreshCounts();
      console.log('PARTQUILL_EBAY_MOTORS_TREE_SYNCED', JSON.stringify({
        marketplace: MARKETPLACE_ID,
        rootCategoryId: MOTORS_ROOT_CATEGORY_ID,
        treeId,
        version,
        categories: rows.length,
        readOnly: true
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 1_000) : 'unknown taxonomy failure';
      await pool.query(
        `INSERT INTO partquill.ebay_category_sync_state(sync_name,status,error_detail,updated_at)
         VALUES('EBAY_US_MOTORS','failed',$1,now())
         ON CONFLICT(sync_name) DO UPDATE SET status='failed',error_detail=$1,updated_at=now()`,
        [detail]
      ).catch(() => undefined);
      console.error('PARTQUILL_EBAY_MOTORS_TREE_SYNC_FAILED', detail);
    } finally {
      treeRunning = false;
    }
  };

  const assignBatch = async (): Promise<void> => {
    if (stopped || assignmentRunning) return;
    assignmentRunning = true;
    try {
      const pending = await pool.query<{part_number: string; data: GmCatalogPart}>(
        `SELECT p.part_number,p.data
         FROM partquill.gm_catalog_parts p
         WHERE NOT EXISTS(
           SELECT 1 FROM partquill.ebay_category_assignments a
           WHERE a.part_number=p.part_number
         )
         ORDER BY p.part_number
         LIMIT $1`,
        [ASSIGNMENT_BATCH]
      );
      for (const row of pending.rows) {
        if (stopped) break;
        const catalog = normalizeGmCatalogPart(row.data, row.part_number);
        const intelligence = catalog ? buildCatalogListingIntelligence(catalog) : undefined;
        const query = intelligence?.category.query || `automotive replacement part ${row.part_number}`;
        let suggestion;
        try {
          suggestion = await suggestionClient.suggestCategory(query);
        } catch (error) {
          const candidateName = intelligence?.category.categoryName?.trim();
          if (candidateName) {
            const local = await pool.query<{category_id: string; category_name: string; category_path: string[]}>(
              `SELECT category_id,category_name,category_path
               FROM partquill.ebay_categories
               WHERE marketplace_id=$1 AND active=true
                 AND lower(category_name)=lower($2)
               ORDER BY leaf_category DESC,array_length(category_path,1) DESC
               LIMIT 1`,
              [MARKETPLACE_ID, candidateName]
            );
            const matched = local.rows[0];
            if (matched) {
              suggestion = {
                categoryId: matched.category_id,
                categoryName: matched.category_name,
                categoryPath: matched.category_path.join(' › ')
              };
            }
          }
          if (!suggestion) {
            console.warn('PARTQUILL_EBAY_CATEGORY_LOCAL_FALLBACK', JSON.stringify({
              partNumber: row.part_number,
              error: error instanceof Error ? error.message : 'unknown',
              matched: false
            }));
          }
        }
        const insideMotors = suggestion
          ? await pool.query(
              `SELECT 1 FROM partquill.ebay_categories
               WHERE marketplace_id=$1 AND category_id=$2 AND active=true LIMIT 1`,
              [MARKETPLACE_ID, suggestion.categoryId]
            )
          : undefined;
        const assigned = Boolean(suggestion && insideMotors?.rowCount);
        const status = assigned ? 'ASSIGNED' : suggestion ? 'OUTSIDE_MOTORS' : 'NO_SUGGESTION';
        const source = assigned ? 'EBAY_TAXONOMY_API' : status;
        await pool.query(
          `INSERT INTO partquill.ebay_category_assignments(
             part_number,marketplace_id,category_id,category_name,category_path,
             query,source,status,confidence,assigned_at,verified_at,raw_suggestion
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),$10::jsonb)
           ON CONFLICT(part_number) DO UPDATE SET
             category_id=EXCLUDED.category_id,
             category_name=EXCLUDED.category_name,
             category_path=EXCLUDED.category_path,
             query=EXCLUDED.query,
             source=EXCLUDED.source,
             status=EXCLUDED.status,
             confidence=EXCLUDED.confidence,
             verified_at=now(),
             raw_suggestion=EXCLUDED.raw_suggestion`,
          [
            row.part_number,
            MARKETPLACE_ID,
            assigned ? suggestion?.categoryId : null,
            assigned ? suggestion?.categoryName : null,
            assigned ? suggestion?.categoryPath : null,
            query,
            source,
            status,
            assigned ? 1 : 0,
            JSON.stringify(suggestion ?? {})
          ]
        );
        if (assigned && suggestion) {
          await pool.query(
            `UPDATE partquill.gm_catalog_parts SET
               data=jsonb_set(
                 data,'{ebayCategory}',
                 jsonb_build_object(
                   'marketplaceId',$2::text,
                   'categoryId',$3::text,
                   'categoryName',$4::text,
                   'categoryPath',$5::text,
                   'source','EBAY_TAXONOMY_API',
                   'verifiedAt',now()
                 ),true
               ),
               updated_at=now()
             WHERE part_number=$1`,
            [
              row.part_number,
              MARKETPLACE_ID,
              suggestion.categoryId,
              suggestion.categoryName,
              suggestion.categoryPath
            ]
          );
        }
      }
      await refreshCounts();
      if (pending.rowCount) {
        console.log('PARTQUILL_EBAY_CATEGORY_BATCH', JSON.stringify({
          attempted: pending.rowCount,
          readOnly: true
        }));
      }
    } catch (error) {
      console.error(
        'PARTQUILL_EBAY_CATEGORY_BATCH_FAILED',
        error instanceof Error ? error.message : 'unknown'
      );
    } finally {
      assignmentRunning = false;
    }
  };

  void syncTree().then(assignBatch);
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

import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import pg from 'pg';
import type { GmCatalogImportOptions, GmCatalogPart, GmCatalogStatus } from '../catalog/gm-catalog.js';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import { mergeGmCatalogParts } from '../catalog/gm-catalog-merge.js';
import type {
  ApprovalRecord,
  AuditEvent,
  EvidenceRecord,
  ItemRecord,
  ListingRecord,
  SellerConnection,
  SellerAcknowledgement,
  StoredImage
} from '../domain/types.js';
import type { EbayLeafCategory, Store } from './store.js';
import type { EbayReferenceCacheRecord } from '../ebay/reference-types.js';
import type { CommunityImageRecord, CommunitySubmissionRecord, StoredCommunityImage } from '../community/types.js';
import type {
  VintageGmCatalogMatch,
  VintageGmCatalogMatchPool,
  VintageGmDatasetStatus,
  VintageGmImportOptions,
  VintageGmInventoryQuestionIntent,
  VintageGmInventoryQuestionPool,
  VintageGmInventoryRecord
} from '../vintage-gm/types.js';
import {
  MAX_VINTAGE_INVENTORY_ANSWER_ROWS,
  matchesVintageVehicleApplication,
  vintageGmModelSeriesAliases
} from '../vintage-gm/inventory-question.js';
import { postgresPoolConfig, type DatabaseAuthMode } from './postgres-connection.js';
import {
  MIGRATION_TABLE_NAMES,
  type MigrationExportPage,
  type MigrationImportResult,
  type MigrationManifest,
  type MigrationTableName
} from './migration-transfer.js';

const { Pool } = pg;

type JsonRow<T> = { record: T };

const GM_DATASET_ID = 'gm-catalog-v2-4a3a765e158bcc93';

const migrationTables: Record<MigrationTableName, { qualifiedName: string; orderBy: string }> = {
  items: { qualifiedName: 'public.items', orderBy: 'id' },
  evidence: { qualifiedName: 'public.evidence', orderBy: 'id' },
  approvals: { qualifiedName: 'public.approvals', orderBy: 'id' },
  listings: { qualifiedName: 'public.listings', orderBy: 'id' },
  images: { qualifiedName: 'public.images', orderBy: 'id' },
  audit_events: { qualifiedName: 'public.audit_events', orderBy: 'id' },
  publish_slots: { qualifiedName: 'public.publish_slots', orderBy: 'item_id' },
  seller_acknowledgements: { qualifiedName: 'public.seller_acknowledgements', orderBy: 'seller_id, acknowledgement_type' },
  gm_catalog_parts: { qualifiedName: 'partquill.gm_catalog_parts', orderBy: 'part_number' },
  gm_catalog_imports: { qualifiedName: 'partquill.gm_catalog_imports', orderBy: 'dataset_id' },
  vintage_gm_imports: { qualifiedName: 'partquill.vintage_gm_imports', orderBy: 'dataset_id' },
  vintage_gm_inventory: { qualifiedName: 'partquill.vintage_gm_inventory', orderBy: 'dataset_id, source_row' },
  ebay_reference_cache: { qualifiedName: 'partquill.ebay_reference_cache', orderBy: 'part_number' },
  community_submissions: { qualifiedName: 'partquill.community_submissions', orderBy: 'id' },
  community_images: { qualifiedName: 'partquill.community_images', orderBy: 'id' },
  ebay_categories: { qualifiedName: 'partquill.ebay_categories', orderBy: 'marketplace_id, category_id' },
  ebay_category_assignments: { qualifiedName: 'partquill.ebay_category_assignments', orderBy: 'part_number' },
  ebay_category_sync_state: { qualifiedName: 'partquill.ebay_category_sync_state', orderBy: 'sync_name' }
};

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, production: boolean, authMode: DatabaseAuthMode = 'password') {
    this.pool = new Pool({
      ...postgresPoolConfig(connectionString, production, authMode),
      max: 10,
      idleTimeoutMillis: 30_000
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async getMigrationManifest(): Promise<MigrationManifest> {
    const tables = [];
    for (const table of MIGRATION_TABLE_NAMES) {
      const definition = migrationTables[table];
      const result = await this.pool.query<{ rows: string; bytes: string }>(
        `SELECT count(*)::text AS rows, pg_total_relation_size($1::regclass)::text AS bytes FROM ${definition.qualifiedName}`,
        [definition.qualifiedName]
      );
      tables.push({
        table,
        rows: Number(result.rows[0]?.rows ?? 0),
        bytes: Number(result.rows[0]?.bytes ?? 0)
      });
    }
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      excludedTables: ['seller_connections', 'oauth_nonces', 'partquill_migrations'],
      tables
    };
  }

  async exportMigrationTable(table: MigrationTableName, offset: number, limit: number): Promise<MigrationExportPage> {
    const definition = migrationTables[table];
    const result = await this.pool.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(source_row) AS row
       FROM ${definition.qualifiedName} AS source_row
       ORDER BY ${definition.orderBy}
       OFFSET $1 LIMIT $2`,
      [offset, limit]
    );
    return {
      table,
      offset,
      nextOffset: result.rows.length === limit ? offset + result.rows.length : null,
      rows: result.rows.map((row) => row.row)
    };
  }

  async resetMigrationTarget(): Promise<void> {
    const reversed = [...MIGRATION_TABLE_NAMES]
      .reverse()
      .map((table) => migrationTables[table].qualifiedName)
      .join(', ');
    await this.pool.query(`TRUNCATE TABLE ${reversed} RESTART IDENTITY CASCADE`);
  }

  async importMigrationRows(
    table: MigrationTableName,
    rows: Record<string, unknown>[]
  ): Promise<MigrationImportResult> {
    const definition = migrationTables[table];
    if (rows.length) {
      await this.pool.query(
        `INSERT INTO ${definition.qualifiedName}
         SELECT * FROM jsonb_populate_recordset(NULL::${definition.qualifiedName}, $1::jsonb)
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(rows)]
      );
    }
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${definition.qualifiedName}`
    );
    return { table, imported: rows.length, totalRows: Number(count.rows[0]?.count ?? 0) };
  }

  async listEbayLeafCategories(query = '', limit = 2_000): Promise<EbayLeafCategory[]> {
    const search = query.trim();
    const result = await this.pool.query<{
      category_id: string;
      category_name: string;
      category_path: string[];
    }>(
      `SELECT category_id,category_name,category_path
       FROM partquill.ebay_categories
       WHERE marketplace_id='EBAY_US'
         AND root_category_id='6028'
         AND active=true
         AND leaf_category=true
         AND ($1='' OR category_id=$1 OR category_name ILIKE '%' || $1 || '%'
           OR array_to_string(category_path,' › ') ILIKE '%' || $1 || '%')
       ORDER BY category_path
       LIMIT $2`,
      [search, Math.min(Math.max(limit, 1), 2_500)]
    );
    return result.rows.map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryPath: row.category_path.join(' › ')
    }));
  }

  async saveCommunitySubmission(record: CommunitySubmissionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO partquill.community_submissions(id,status,status_token_hash,record,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,status_token_hash=EXCLUDED.status_token_hash,record=EXCLUDED.record,updated_at=EXCLUDED.updated_at`,
      [record.id, record.status, record.statusTokenHash, record, record.createdAt, record.updatedAt]
    );
  }

  async getCommunitySubmission(id: string): Promise<CommunitySubmissionRecord | undefined> {
    const result = await this.pool.query<JsonRow<CommunitySubmissionRecord>>(
      'SELECT record FROM partquill.community_submissions WHERE id=$1', [id]
    );
    return result.rows[0]?.record;
  }

  async listCommunitySubmissionsForReview(limit: number): Promise<CommunitySubmissionRecord[]> {
    const result = await this.pool.query<JsonRow<CommunitySubmissionRecord>>(
      `SELECT record FROM partquill.community_submissions
       WHERE status = ANY($1::text[]) ORDER BY created_at ASC LIMIT $2`,
      [['SCREENING','PENDING_HUMAN_REVIEW','PROCESSING','READY_FOR_ARCHIVE','FAILED'], limit]
    );
    return result.rows.map((row) => row.record);
  }

  async saveCommunityImage(record: StoredCommunityImage): Promise<void> {
    const { sourceBytes, derivativeBytes, ...metadata } = record;
    await this.pool.query(
      `INSERT INTO partquill.community_images(
         id,submission_id,part_number,status,source_sha256,visual_hash,source_bytes,derivative_bytes,archive_filename,record,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO UPDATE SET
         status=EXCLUDED.status,derivative_bytes=EXCLUDED.derivative_bytes,archive_filename=EXCLUDED.archive_filename,record=EXCLUDED.record,updated_at=EXCLUDED.updated_at`,
      [record.id,record.submissionId,record.partNumber,record.status,record.sourceSha256,record.visualHash,
       Buffer.from(sourceBytes),derivativeBytes ? Buffer.from(derivativeBytes) : null,record.archiveFilename ?? null,metadata,record.createdAt,record.updatedAt]
    );
  }

  async getCommunityImage(id: string): Promise<StoredCommunityImage | undefined> {
    const result = await this.pool.query<{record: CommunityImageRecord; source_bytes: Buffer; derivative_bytes: Buffer | null}>(
      'SELECT record,source_bytes,derivative_bytes FROM partquill.community_images WHERE id=$1', [id]
    );
    const row = result.rows[0];
    return row ? { ...row.record, sourceBytes: row.source_bytes, ...(row.derivative_bytes ? { derivativeBytes: row.derivative_bytes } : {}) } : undefined;
  }

  async listCommunityImages(submissionId: string): Promise<StoredCommunityImage[]> {
    const result = await this.pool.query<{record: CommunityImageRecord; source_bytes: Buffer; derivative_bytes: Buffer | null}>(
      'SELECT record,source_bytes,derivative_bytes FROM partquill.community_images WHERE submission_id=$1 ORDER BY (record->>\'order\')::integer ASC', [submissionId]
    );
    return result.rows.map((row) => ({ ...row.record, sourceBytes: row.source_bytes, ...(row.derivative_bytes ? { derivativeBytes: row.derivative_bytes } : {}) }));
  }

  async listCommunityImagesByPartNumber(partNumber: string): Promise<StoredCommunityImage[]> {
    const result = await this.pool.query<{record: CommunityImageRecord; source_bytes: Buffer; derivative_bytes: Buffer | null}>(
      'SELECT record,source_bytes,derivative_bytes FROM partquill.community_images WHERE part_number=$1 ORDER BY created_at ASC', [partNumber]
    );
    return result.rows.map((row) => ({
      ...row.record,
      sourceBytes: row.source_bytes,
      ...(row.derivative_bytes ? { derivativeBytes: row.derivative_bytes } : {})
    }));
  }

  async listPublishedCommunityImages(partNumber: string): Promise<StoredCommunityImage[]> {
    const result = await this.pool.query<{record: CommunityImageRecord; source_bytes: Buffer; derivative_bytes: Buffer | null; contributor_credit: string}>(
      `SELECT i.record,i.source_bytes,i.derivative_bytes,s.record->>'contributorCredit' contributor_credit
       FROM partquill.community_images i JOIN partquill.community_submissions s ON s.id=i.submission_id
       WHERE i.part_number=$1 AND i.status='PUBLISHED' ORDER BY i.updated_at ASC,(i.record->>'order')::integer ASC`,
      [canonicalOemPartNumber(partNumber)]
    );
    return result.rows.map((row) => ({ ...row.record, contributorCredit: row.contributor_credit, sourceBytes: row.source_bytes, ...(row.derivative_bytes ? { derivativeBytes: row.derivative_bytes } : {}) }));
  }

  async getPublishedCommunityAsset(filename: string): Promise<StoredCommunityImage | undefined> {
    const result = await this.pool.query<{record: CommunityImageRecord; source_bytes: Buffer; derivative_bytes: Buffer | null}>(
      `SELECT record,source_bytes,derivative_bytes FROM partquill.community_images
       WHERE archive_filename=$1 AND status='PUBLISHED' LIMIT 1`, [filename]
    );
    const row = result.rows[0];
    return row ? { ...row.record, sourceBytes: row.source_bytes, ...(row.derivative_bytes ? { derivativeBytes: row.derivative_bytes } : {}) } : undefined;
  }

  async initializeGmCatalog(): Promise<void> {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS partquill;
      CREATE TABLE IF NOT EXISTS partquill.gm_catalog_parts (
        part_number text PRIMARY KEY,
        verification_state text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ix_gm_catalog_parts_verification
        ON partquill.gm_catalog_parts(verification_state);
      CREATE TABLE IF NOT EXISTS partquill.gm_catalog_imports (
        dataset_id text PRIMARY KEY,
        status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        row_count integer NOT NULL DEFAULT 0,
        last_part_number text,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        error_detail text
      )
    `);
  }

  async seedGmCatalogPart(filePath: string): Promise<void> {
    const record = JSON.parse(await readFile(filePath, 'utf8')) as GmCatalogPart;
    await this.upsertGmCatalogBatch([record]);
  }

  async importGmCatalogRecords(records: GmCatalogPart[], options: GmCatalogImportOptions = {}): Promise<void> {
    if (!records.length) return;
    const datasetId = options.datasetId ?? GM_DATASET_ID;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.upsertGmCatalogBatch(records, client);
      const lastPartNumber = records.at(-1)?.partNumber ?? null;
      await client.query(
        `INSERT INTO partquill.gm_catalog_imports(
           dataset_id, status, row_count, last_part_number, completed_at, updated_at
         )
         VALUES (
           $1, $2,
           (SELECT count(*)::integer FROM partquill.gm_catalog_parts),
           $3, CASE WHEN $2 = 'completed' THEN now() ELSE NULL END, now()
         )
         ON CONFLICT (dataset_id) DO UPDATE SET
           status = EXCLUDED.status,
           row_count = EXCLUDED.row_count,
           last_part_number = EXCLUDED.last_part_number,
           completed_at = EXCLUDED.completed_at,
           updated_at = now(),
           error_detail = NULL`,
        [datasetId, options.complete ? 'completed' : 'running', lastPartNumber]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async importGmCatalog(filePath: string): Promise<void> {
    const existing = await this.pool.query<{
      status: string;
      row_count: number;
      last_part_number: string | null;
    }>(
      'SELECT status, row_count, last_part_number FROM partquill.gm_catalog_imports WHERE dataset_id = $1',
      [GM_DATASET_ID]
    );
    if (existing.rows[0]?.status === 'completed') return;

    let imported = existing.rows[0]?.row_count ?? 0;
    const resumeAfter = existing.rows[0]?.last_part_number ?? null;
    await this.pool.query(
      `INSERT INTO partquill.gm_catalog_imports(dataset_id, status, row_count, last_part_number)
       VALUES ($1, 'running', $2, $3)
       ON CONFLICT (dataset_id) DO UPDATE SET
         status = 'running', updated_at = now(), error_detail = NULL`,
      [GM_DATASET_ID, imported, resumeAfter]
    );

    try {
      const input = createReadStream(filePath).pipe(createGunzip());
      const lines = createInterface({ input, crlfDelay: Infinity });
      let batch: GmCatalogPart[] = [];
      for await (const line of lines) {
        if (!line.trim()) continue;
        const record = JSON.parse(line) as GmCatalogPart;
        if (resumeAfter && record.partNumber <= resumeAfter) continue;
        batch.push(record);
        if (batch.length >= 250) {
          await this.importGmCatalogBatch(batch, imported);
          imported += batch.length;
          batch = [];
        }
      }
      if (batch.length) {
        await this.importGmCatalogBatch(batch, imported);
        imported += batch.length;
      }
      await this.pool.query(
        `UPDATE partquill.gm_catalog_imports
         SET status = 'completed', row_count = $2, completed_at = now(), updated_at = now(), error_detail = NULL
         WHERE dataset_id = $1`,
        [GM_DATASET_ID, imported]
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 2_000) : 'unknown import failure';
      await this.pool.query(
        `UPDATE partquill.gm_catalog_imports
         SET status = 'failed', updated_at = now(), error_detail = $2
         WHERE dataset_id = $1`,
        [GM_DATASET_ID, detail]
      );
      throw error;
    }
  }

  private async importGmCatalogBatch(records: GmCatalogPart[], importedBefore: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.upsertGmCatalogBatch(records, client);
      await client.query(
        `UPDATE partquill.gm_catalog_imports
         SET row_count = $2, last_part_number = $3, updated_at = now()
         WHERE dataset_id = $1`,
        [GM_DATASET_ID, importedBefore + records.length, records.at(-1)?.partNumber ?? null]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertGmCatalogBatch(records: GmCatalogPart[], client: pg.Pool | pg.PoolClient = this.pool): Promise<void> {
    if (!records.length) return;
    const payloadByPart = new Map<string, GmCatalogPart>();
    for (const record of records) {
      const partNumber = canonicalOemPartNumber(record.partNumber);
      if (!partNumber) continue;
      const incoming = { ...record, partNumber };
      const duplicate = payloadByPart.get(partNumber);
      payloadByPart.set(partNumber, duplicate ? mergeGmCatalogParts(duplicate, incoming) : incoming);
    }
    if (!payloadByPart.size) return;
    const existing = await client.query<{ part_number: string; data: GmCatalogPart }>(
      'SELECT part_number, data FROM partquill.gm_catalog_parts WHERE part_number = ANY($1::text[])',
      [[...payloadByPart.keys()]]
    );
    for (const row of existing.rows) {
      const incoming = payloadByPart.get(row.part_number);
      if (incoming) payloadByPart.set(row.part_number, mergeGmCatalogParts(row.data, incoming));
    }
    const payload = [...payloadByPart].map(([part_number, data]) => ({ part_number, data }));
    if (!payload.length) return;
    await client.query(
      `INSERT INTO partquill.gm_catalog_parts(part_number, verification_state, data, updated_at)
       SELECT item.part_number, item.data ->> 'verificationState', item.data, now()
       FROM jsonb_to_recordset($1::jsonb) AS item(part_number text, data jsonb)
       ON CONFLICT (part_number) DO UPDATE SET
         verification_state = EXCLUDED.verification_state,
         data = EXCLUDED.data,
         updated_at = now()`,
      [JSON.stringify(payload)]
    );
  }

  async lookupGmCatalogPart(partNumber: string): Promise<GmCatalogPart | undefined> {
    const normalized = canonicalOemPartNumber(partNumber);
    const result = await this.pool.query<{ data: GmCatalogPart }>(
      'SELECT data FROM partquill.gm_catalog_parts WHERE part_number = $1',
      [normalized]
    );
    return result.rows[0]?.data;
  }

  async getGmCatalogStatus(): Promise<GmCatalogStatus> {
    const [state, available] = await Promise.all([
      this.pool.query<{
        dataset_id: string;
        status: GmCatalogStatus['status'];
        row_count: number;
        last_part_number: string | null;
      }>(
        `SELECT dataset_id, status, row_count, last_part_number
         FROM partquill.gm_catalog_imports
         ORDER BY updated_at DESC LIMIT 1`
      ),
      this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM partquill.gm_catalog_parts')
    ]);
    const row = state.rows[0];
    return {
      datasetId: row?.dataset_id ?? null,
      status: row?.status ?? 'not_started',
      importedParts: row?.row_count ?? 0,
      availableParts: Number(available.rows[0]?.count ?? 0),
      lastPartNumber: row?.last_part_number ?? null
    };
  }

  async importVintageGmRecords(
    records: VintageGmInventoryRecord[],
    options: VintageGmImportOptions
  ): Promise<VintageGmDatasetStatus> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const importState = await client.query(
        `INSERT INTO partquill.vintage_gm_imports(
           dataset_id,source_sha256,source_file_name,source_total_rows,expected_gm_rows,status,active,updated_at
         ) VALUES($1,$2,$3,$4,$5,'running',false,now())
         ON CONFLICT(dataset_id) DO UPDATE SET
           status='running',updated_at=now(),error_detail=NULL
         WHERE partquill.vintage_gm_imports.source_sha256=EXCLUDED.source_sha256
           AND partquill.vintage_gm_imports.source_file_name=EXCLUDED.source_file_name
           AND partquill.vintage_gm_imports.source_total_rows=EXCLUDED.source_total_rows
           AND partquill.vintage_gm_imports.expected_gm_rows=EXCLUDED.expected_gm_rows
         RETURNING dataset_id`,
        [
          options.datasetId,
          options.sourceSha256,
          options.sourceFileName,
          options.sourceTotalRows,
          options.expectedGmRows
        ]
      );
      if (importState.rowCount !== 1) {
        throw new Error('Vintage GM dataset metadata does not match the existing import');
      }
      if (records.length) {
        await client.query(
          `INSERT INTO partquill.vintage_gm_inventory(
             dataset_id,source_row,product_name,sku,part_number,brand,description,quantity,
             source_price,source_weight,normalization_state,normalization_issue,imported_at
           )
           SELECT $1,item."sourceRow",item."productName",item.sku,item."partNumber",item.brand,
             item.description,item.quantity,item."sourcePrice"::numeric,item."sourceWeight"::numeric,
             item."normalizationState",item."normalizationIssue",now()
           FROM jsonb_to_recordset($2::jsonb) AS item(
             "sourceRow" integer,
             "productName" text,
             sku text,
             "partNumber" text,
             brand text,
             description text,
             quantity integer,
             "sourcePrice" text,
             "sourceWeight" text,
             "normalizationState" text,
             "normalizationIssue" text
           )
           ON CONFLICT(dataset_id,source_row) DO UPDATE SET
             product_name=EXCLUDED.product_name,
             sku=EXCLUDED.sku,
             part_number=EXCLUDED.part_number,
             brand=EXCLUDED.brand,
             description=EXCLUDED.description,
             quantity=EXCLUDED.quantity,
             source_price=EXCLUDED.source_price,
             source_weight=EXCLUDED.source_weight,
             normalization_state=EXCLUDED.normalization_state,
             normalization_issue=EXCLUDED.normalization_issue,
             imported_at=now()`,
          [options.datasetId, JSON.stringify(records)]
        );
      }
      const statistics = await client.query<{
        imported_rows: number;
        normalized_rows: number;
        rejected_rows: number;
        distinct_part_numbers: number;
        catalog_key_matches: number;
      }>(
        `SELECT
           count(*)::integer AS imported_rows,
           count(*) FILTER (WHERE inventory.normalization_state='NORMALIZED_EXACT_KEY')::integer AS normalized_rows,
           count(*) FILTER (WHERE inventory.normalization_state<>'NORMALIZED_EXACT_KEY')::integer AS rejected_rows,
           count(DISTINCT inventory.part_number) FILTER (WHERE inventory.part_number IS NOT NULL)::integer AS distinct_part_numbers,
           count(DISTINCT inventory.part_number) FILTER (WHERE catalog.part_number IS NOT NULL)::integer AS catalog_key_matches
         FROM partquill.vintage_gm_inventory AS inventory
         LEFT JOIN partquill.gm_catalog_parts AS catalog ON catalog.part_number=inventory.part_number
         WHERE inventory.dataset_id=$1`,
        [options.datasetId]
      );
      const stats = statistics.rows[0];
      if (!stats) throw new Error('Vintage GM import statistics were unavailable');
      if (options.complete && stats.imported_rows !== options.expectedGmRows) {
        throw new Error(`Vintage GM import is incomplete: expected ${options.expectedGmRows}, found ${stats.imported_rows}`);
      }
      if (options.complete) {
        await client.query(
          'UPDATE partquill.vintage_gm_imports SET active=false,updated_at=now() WHERE active=true AND dataset_id<>$1',
          [options.datasetId]
        );
      }
      await client.query(
        `UPDATE partquill.vintage_gm_imports SET
           imported_rows=$2,
           normalized_rows=$3,
           rejected_rows=$4,
           distinct_part_numbers=$5,
           catalog_key_matches=$6,
           status=$7,
           active=$8,
           completed_at=CASE WHEN $8 THEN now() ELSE completed_at END,
           updated_at=now(),
           error_detail=NULL
         WHERE dataset_id=$1`,
        [
          options.datasetId,
          stats.imported_rows,
          stats.normalized_rows,
          stats.rejected_rows,
          stats.distinct_part_numbers,
          stats.catalog_key_matches,
          options.complete ? 'completed' : 'running',
          options.complete ?? false
        ]
      );
      await client.query('COMMIT');
      return await this.getVintageGmStatus();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getVintageGmStatus(): Promise<VintageGmDatasetStatus> {
    const result = await this.pool.query<{
      dataset_id: string;
      status: VintageGmDatasetStatus['status'];
      active: boolean;
      source_sha256: string;
      source_file_name: string;
      source_total_rows: number;
      expected_gm_rows: number;
      imported_rows: number;
      normalized_rows: number;
      rejected_rows: number;
      distinct_part_numbers: number;
      catalog_key_matches: number;
      completed_at: Date | string | null;
      updated_at: Date | string;
    }>(
      `SELECT dataset_id,status,active,source_sha256,source_file_name,source_total_rows,
         expected_gm_rows,imported_rows,normalized_rows,rejected_rows,distinct_part_numbers,
         catalog_key_matches,completed_at,updated_at
       FROM partquill.vintage_gm_imports
       ORDER BY active DESC,updated_at DESC
       LIMIT 1`
    );
    const row = result.rows[0];
    if (!row) return {
      datasetId: null,
      status: 'not_started',
      active: false,
      sourceSha256: null,
      sourceFileName: null,
      sourceTotalRows: 0,
      expectedGmRows: 0,
      importedRows: 0,
      normalizedRows: 0,
      rejectedRows: 0,
      distinctPartNumbers: 0,
      catalogKeyMatches: 0,
      completedAt: null,
      updatedAt: null
    };
    const iso = (value: Date | string | null) => value
      ? (value instanceof Date ? value : new Date(value)).toISOString()
      : null;
    return {
      datasetId: row.dataset_id,
      status: row.status,
      active: row.active,
      sourceSha256: row.source_sha256,
      sourceFileName: row.source_file_name,
      sourceTotalRows: row.source_total_rows,
      expectedGmRows: row.expected_gm_rows,
      importedRows: row.imported_rows,
      normalizedRows: row.normalized_rows,
      rejectedRows: row.rejected_rows,
      distinctPartNumbers: row.distinct_part_numbers,
      catalogKeyMatches: row.catalog_key_matches,
      completedAt: iso(row.completed_at),
      updatedAt: iso(row.updated_at)
    };
  }

  async listVintageGmCatalogMatches(limit: number): Promise<VintageGmCatalogMatchPool> {
    const dataset = await this.getVintageGmStatus();
    if (!dataset.datasetId || !dataset.active || dataset.status !== 'completed') {
      return { dataset, matches: [] };
    }
    const result = await this.pool.query<{
      part_number: string;
      product_name: string;
      sku: string;
      brands: string[];
      descriptions: string[];
      quantity: number;
      source_price_min: string;
      source_price_max: string;
      source_weight_min: string;
      source_weight_max: string;
      source_rows: number[];
      record_count: number;
      catalog_data: GmCatalogPart;
    }>(
      `WITH grouped_inventory AS (
         SELECT
           inventory.part_number,
           min(inventory.product_name) AS product_name,
           min(inventory.sku) AS sku,
           array_agg(DISTINCT inventory.brand ORDER BY inventory.brand) AS brands,
           array_agg(DISTINCT inventory.description ORDER BY inventory.description)
             FILTER (WHERE inventory.description<>'') AS descriptions,
           sum(inventory.quantity)::integer AS quantity,
           min(inventory.source_price)::text AS source_price_min,
           max(inventory.source_price)::text AS source_price_max,
           min(inventory.source_weight)::text AS source_weight_min,
           max(inventory.source_weight)::text AS source_weight_max,
           array_agg(inventory.source_row ORDER BY inventory.source_row) AS source_rows,
           count(*)::integer AS record_count
         FROM partquill.vintage_gm_inventory AS inventory
         WHERE inventory.dataset_id=$1
           AND inventory.part_number IS NOT NULL
           AND inventory.quantity>0
         GROUP BY inventory.part_number
       )
       SELECT
         inventory.part_number,inventory.product_name,inventory.sku,inventory.brands,
         coalesce(inventory.descriptions,ARRAY[]::text[]) AS descriptions,
         inventory.quantity,inventory.source_price_min,inventory.source_price_max,
         inventory.source_weight_min,inventory.source_weight_max,inventory.source_rows,
         inventory.record_count,catalog.data AS catalog_data
       FROM grouped_inventory AS inventory
       JOIN partquill.gm_catalog_parts AS catalog ON catalog.part_number=inventory.part_number
       WHERE
         inventory.part_number IN ('5455054','5455055')
         OR (
           catalog.data #>> '{identityEvidence,method}'='gmpartswiki_exact_part_link'
           AND lower(coalesce(catalog.data #>> '{identityEvidence,verificationState}',''))='catalog_stated'
           AND jsonb_array_length(coalesce(catalog.data #> '{identityEvidence,sourcePages}','[]'::jsonb))>0
         )
         OR (
           catalog.verification_state='catalog_stated'
           AND (
             coalesce((catalog.data #>> '{rollup,catalogStatedOccurrences}')::integer,0)>0
             OR jsonb_path_exists(
               catalog.data,
               '$.applications[*] ? (@.verificationState == "catalog_stated" && @.confidence >= 0.8 && @.sourcePageId > 0)'
             )
           )
         )
       ORDER BY
         CASE
           WHEN inventory.part_number IN ('5455054','5455055') THEN 0
           WHEN catalog.data #>> '{identityEvidence,method}'='gmpartswiki_exact_part_link' THEN 0
           ELSE 1
         END,
         inventory.quantity ASC,
         coalesce((catalog.data #>> '{rollup,pageCount}')::integer,0) DESC,
         inventory.part_number ASC
       LIMIT $2`,
      [dataset.datasetId, Math.min(Math.max(limit, 1), 2_500)]
    );
    const matches: VintageGmCatalogMatch[] = result.rows.map((row) => ({
      inventory: {
        partNumber: row.part_number,
        productName: row.product_name,
        sku: row.sku,
        brands: row.brands,
        descriptions: row.descriptions,
        quantity: row.quantity,
        sourcePriceMin: row.source_price_min,
        sourcePriceMax: row.source_price_max,
        sourceWeightMin: row.source_weight_min,
        sourceWeightMax: row.source_weight_max,
        sourceRows: row.source_rows,
        recordCount: row.record_count
      },
      catalog: row.catalog_data
    }));
    return { dataset, matches };
  }

  async queryVintageGmInventory(intent: VintageGmInventoryQuestionIntent): Promise<VintageGmInventoryQuestionPool> {
    const dataset = await this.getVintageGmStatus();
    if (!dataset.datasetId || !dataset.active || dataset.status !== 'completed') {
      return { dataset, matches: [], truncated: false };
    }
    const result = await this.pool.query<{
      part_number: string;
      product_name: string;
      sku: string;
      brands: string[];
      descriptions: string[];
      quantity: number;
      source_price_min: string;
      source_price_max: string;
      source_inventory_value: string;
      source_weight_min: string;
      source_weight_max: string;
      source_rows: number[];
      record_count: number;
      catalog_data: GmCatalogPart;
    }>(
      `WITH grouped_inventory AS (
         SELECT
           inventory.part_number,
           min(inventory.product_name) AS product_name,
           min(inventory.sku) AS sku,
           array_agg(DISTINCT inventory.brand ORDER BY inventory.brand) AS brands,
           array_agg(DISTINCT inventory.description ORDER BY inventory.description)
             FILTER (WHERE inventory.description<>'') AS descriptions,
           sum(inventory.quantity)::integer AS quantity,
           min(inventory.source_price)::text AS source_price_min,
           max(inventory.source_price)::text AS source_price_max,
           sum(inventory.quantity::numeric * inventory.source_price)::text AS source_inventory_value,
           min(inventory.source_weight)::text AS source_weight_min,
           max(inventory.source_weight)::text AS source_weight_max,
           array_agg(inventory.source_row ORDER BY inventory.source_row) AS source_rows,
           count(*)::integer AS record_count
         FROM partquill.vintage_gm_inventory AS inventory
         WHERE inventory.dataset_id=$1
           AND inventory.part_number IS NOT NULL
           AND inventory.quantity>0
         GROUP BY inventory.part_number
       )
       SELECT
         inventory.part_number,inventory.product_name,inventory.sku,inventory.brands,
         coalesce(inventory.descriptions,ARRAY[]::text[]) AS descriptions,
         inventory.quantity,inventory.source_price_min,inventory.source_price_max,
         inventory.source_inventory_value,inventory.source_weight_min,inventory.source_weight_max,
         inventory.source_rows,inventory.record_count,catalog.data AS catalog_data
       FROM grouped_inventory AS inventory
       JOIN partquill.gm_catalog_parts AS catalog ON catalog.part_number=inventory.part_number
       WHERE ($2::integer IS NULL AND $3::text IS NULL AND $4::text IS NULL)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(coalesce(catalog.data->'applications','[]'::jsonb)) AS application(data)
            WHERE lower(coalesce(application.data->>'verificationState',''))='catalog_stated'
              AND CASE
                WHEN coalesce(application.data->>'confidence','') ~ '^(?:0(?:\\.\\d+)?|1(?:\\.0+)?)$'
                THEN (application.data->>'confidence')::numeric >= 0.8
                ELSE false
              END
              AND (
                $2::integer IS NULL
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(coalesce(application.data->'models','[]'::jsonb)) AS model(data)
                  WHERE coalesce(model.data->>'year','') ~ '^(?:18|19|20)\\d{2}$'
                    AND (model.data->>'year')::integer=$2
                )
                OR (
                  coalesce(application.data->>'yearStart',application.data->>'yearEnd','') ~ '^(?:18|19|20)\\d{2}$'
                  AND coalesce(application.data->>'yearEnd',application.data->>'yearStart','') ~ '^(?:18|19|20)\\d{2}$'
                  AND coalesce(application.data->>'yearStart',application.data->>'yearEnd')::integer <= $2
                  AND coalesce(application.data->>'yearEnd',application.data->>'yearStart')::integer >= $2
                )
              )
              AND (
                $3::text IS NULL
                OR lower(concat_ws(' ',
                  application.data->>'catalogTitle',application.data->>'applicationText',
                  application.data->>'modelScope',application.data->>'division'
                )) LIKE '%' || lower($3) || '%'
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(coalesce(application.data->'models','[]'::jsonb)) AS model(data)
                  WHERE lower(concat_ws(' ',model.data->>'modelName',model.data->>'seriesCode')) LIKE '%' || lower($3) || '%'
                )
                OR (
                  cardinality($6::text[])>0
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(coalesce(application.data->'models','[]'::jsonb)) AS model(data)
                    WHERE upper(btrim(coalesce(model.data->>'modelName','')))=ANY($6::text[])
                       OR upper(btrim(coalesce(model.data->>'seriesCode','')))=ANY($6::text[])
                  )
                )
              )
              AND (
                $4::text IS NULL
                OR lower(coalesce(application.data->>'division','')) LIKE '%' || lower($4) || '%'
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(coalesce(application.data->'models','[]'::jsonb)) AS model(data)
                  WHERE lower(coalesce(model.data->>'division','')) LIKE '%' || lower($4) || '%'
                )
                OR (
                  nullif(application.data->>'division','') IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(coalesce(application.data->'models','[]'::jsonb)) AS model(data)
                    WHERE nullif(model.data->>'division','') IS NOT NULL
                  )
                )
              )
          )
       ORDER BY inventory.part_number ASC
       LIMIT $5`,
      [
        dataset.datasetId,
        intent.year,
        intent.model,
        intent.make,
        MAX_VINTAGE_INVENTORY_ANSWER_ROWS + 1,
        vintageGmModelSeriesAliases(intent.model, intent.year).map((alias) => alias.toUpperCase())
      ]
    );
    const overflow = result.rows.length > MAX_VINTAGE_INVENTORY_ANSWER_ROWS;
    const matches = result.rows.slice(0, MAX_VINTAGE_INVENTORY_ANSWER_ROWS).map((row) => {
      const matchedApplications = (row.catalog_data.applications ?? []).filter((application) =>
        matchesVintageVehicleApplication(application, intent)
      );
      return {
        inventory: {
          partNumber: row.part_number,
          productName: row.product_name,
          sku: row.sku,
          brands: row.brands,
          descriptions: row.descriptions,
          quantity: row.quantity,
          sourcePriceMin: row.source_price_min,
          sourcePriceMax: row.source_price_max,
          sourceWeightMin: row.source_weight_min,
          sourceWeightMax: row.source_weight_max,
          sourceRows: row.source_rows,
          recordCount: row.record_count
        },
        sourceInventoryValue: row.source_inventory_value,
        catalog: row.catalog_data,
        matchedApplications
      };
    });
    return { dataset, matches, truncated: overflow };
  }

  async createItem(item: ItemRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO items(id, seller_id, sku, record, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [item.id, item.sellerId, item.sku, item, item.createdAt, item.updatedAt]
    );
  }

  async getItem(itemId: string): Promise<ItemRecord | undefined> {
    const result = await this.pool.query<JsonRow<ItemRecord>>('SELECT record FROM items WHERE id = $1', [itemId]);
    return result.rows[0]?.record;
  }

  async saveItem(item: ItemRecord): Promise<void> {
    await this.pool.query('UPDATE items SET seller_id = $2, sku = $3, record = $4, updated_at = $5 WHERE id = $1', [
      item.id,
      item.sellerId,
      item.sku,
      item,
      item.updatedAt
    ]);
  }

  async listItems(sellerId: string): Promise<ItemRecord[]> {
    const result = await this.pool.query<JsonRow<ItemRecord>>(
      'SELECT record FROM items WHERE seller_id = $1 ORDER BY created_at ASC',
      [sellerId]
    );
    return result.rows.map((row) => row.record);
  }

  async addEvidence(record: EvidenceRecord): Promise<void> {
    await this.pool.query('INSERT INTO evidence(id, item_id, record, created_at) VALUES ($1, $2, $3, $4)', [
      record.id,
      record.itemId,
      record,
      record.createdAt
    ]);
  }

  async listEvidence(itemId: string): Promise<EvidenceRecord[]> {
    const result = await this.pool.query<JsonRow<EvidenceRecord>>(
      'SELECT record FROM evidence WHERE item_id = $1 ORDER BY created_at ASC',
      [itemId]
    );
    return result.rows.map((row) => row.record);
  }

  async addApproval(record: ApprovalRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO approvals(id, item_id, stage, payload_hash, record, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [record.id, record.itemId, record.stage, record.payloadHash, record, record.createdAt]
    );
  }

  async listApprovals(itemId: string): Promise<ApprovalRecord[]> {
    const result = await this.pool.query<JsonRow<ApprovalRecord>>(
      'SELECT record FROM approvals WHERE item_id = $1 ORDER BY created_at ASC',
      [itemId]
    );
    return result.rows.map((row) => row.record);
  }

  async saveListing(record: ListingRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO listings(id, item_id, seller_id, offer_id, record, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (item_id) DO UPDATE SET seller_id = EXCLUDED.seller_id, offer_id = EXCLUDED.offer_id,
         record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
      [record.id, record.itemId, record.sellerId, record.offerId, record, record.createdAt, record.updatedAt]
    );
  }

  async getListing(itemId: string): Promise<ListingRecord | undefined> {
    const result = await this.pool.query<JsonRow<ListingRecord>>('SELECT record FROM listings WHERE item_id = $1', [itemId]);
    return result.rows[0]?.record;
  }

  async saveConnection(connection: SellerConnection): Promise<void> {
    await this.pool.query(
      `INSERT INTO seller_connections(seller_id, record, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (seller_id) DO UPDATE SET record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
      [connection.sellerId, connection, connection.updatedAt]
    );
  }

  async getConnection(sellerId: string): Promise<SellerConnection | undefined> {
    const result = await this.pool.query<JsonRow<SellerConnection>>(
      'SELECT record FROM seller_connections WHERE seller_id = $1',
      [sellerId]
    );
    return result.rows[0]?.record;
  }

  async saveImage(image: StoredImage): Promise<void> {
    const { bytes, ...metadata } = image;
    await this.pool.query(
      'INSERT INTO images(id, item_id, seller_id, sha256, bytes, record, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [image.id, image.itemId, image.sellerId, image.sha256, Buffer.from(bytes), metadata, image.createdAt]
    );
  }

  async getImage(imageId: string): Promise<StoredImage | undefined> {
    const result = await this.pool.query<{ record: Omit<StoredImage, 'bytes'>; bytes: Buffer }>(
      'SELECT record, bytes FROM images WHERE id = $1',
      [imageId]
    );
    const row = result.rows[0];
    return row ? { ...row.record, bytes: row.bytes } : undefined;
  }

  async listImages(itemId: string): Promise<StoredImage[]> {
    const result = await this.pool.query<{ record: Omit<StoredImage, 'bytes'>; bytes: Buffer }>(
      'SELECT record, bytes FROM images WHERE item_id = $1 ORDER BY created_at ASC',
      [itemId]
    );
    return result.rows.map((row) => ({ ...row.record, bytes: row.bytes }));
  }

  async addAudit(event: AuditEvent): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_events(id, seller_id, item_id, action, outcome, record, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [event.id, event.sellerId, event.itemId ?? null, event.action, event.outcome, event, event.createdAt]
    );
  }

  async listAudit(itemId?: string): Promise<AuditEvent[]> {
    const result = itemId
      ? await this.pool.query<JsonRow<AuditEvent>>(
          'SELECT record FROM audit_events WHERE item_id = $1 ORDER BY created_at ASC',
          [itemId]
        )
      : await this.pool.query<JsonRow<AuditEvent>>('SELECT record FROM audit_events ORDER BY created_at ASC');
    return result.rows.map((row) => row.record);
  }

  async getSuccessfulPublishCount(sellerId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM publish_slots WHERE seller_id = $1 AND status = 'SUCCEEDED'`,
      [sellerId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async reserveFreePublish(sellerId: string, itemId: string, limit: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sellerId]);
      const existing = await client.query<{ seller_id: string }>('SELECT seller_id FROM publish_slots WHERE item_id = $1', [itemId]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return existing.rows[0].seller_id === sellerId;
      }
      const count = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM publish_slots WHERE seller_id = $1', [sellerId]);
      if (Number(count.rows[0]?.count ?? 0) >= limit) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query("INSERT INTO publish_slots(item_id, seller_id, status) VALUES ($1, $2, 'RESERVED')", [itemId, sellerId]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeFreePublish(itemId: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE publish_slots SET status = 'SUCCEEDED', updated_at = now() WHERE item_id = $1 AND status = 'RESERVED'",
      [itemId]
    );
    if (result.rowCount !== 1) throw new Error('publish slot not reserved');
  }

  async releaseFreePublish(itemId: string): Promise<void> {
    await this.pool.query("DELETE FROM publish_slots WHERE item_id = $1 AND status = 'RESERVED'", [itemId]);
  }

  async saveOAuthNonce(nonce: string, sellerId: string, expiresAt: string): Promise<void> {
    await this.pool.query('INSERT INTO oauth_nonces(nonce, seller_id, expires_at) VALUES ($1, $2, $3)', [nonce, sellerId, expiresAt]);
  }

  async consumeOAuthNonce(nonce: string, sellerId: string, at: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE oauth_nonces SET consumed_at = $3
       WHERE nonce = $1 AND seller_id = $2 AND consumed_at IS NULL AND expires_at >= $3`,
      [nonce, sellerId, at]
    );
    return result.rowCount === 1;
  }

  async saveAcknowledgement(record: SellerAcknowledgement): Promise<void> {
    await this.pool.query(
      `INSERT INTO seller_acknowledgements(seller_id, acknowledgement_type, record, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (seller_id, acknowledgement_type) DO UPDATE
       SET record = EXCLUDED.record, created_at = EXCLUDED.created_at`,
      [record.sellerId, record.type, record, record.createdAt]
    );
  }

  async getAcknowledgement(
    sellerId: string,
    type: SellerAcknowledgement['type']
  ): Promise<SellerAcknowledgement | undefined> {
    const result = await this.pool.query<JsonRow<SellerAcknowledgement>>(
      'SELECT record FROM seller_acknowledgements WHERE seller_id = $1 AND acknowledgement_type = $2',
      [sellerId, type]
    );
    return result.rows[0]?.record;
  }

  async getEbayReferenceCache(partNumber: string): Promise<EbayReferenceCacheRecord | undefined> {
    const result = await this.pool.query<JsonRow<EbayReferenceCacheRecord>>(
      'SELECT record FROM partquill.ebay_reference_cache WHERE part_number = $1',
      [canonicalOemPartNumber(partNumber)]
    );
    return result.rows[0]?.record;
  }

  async saveEbayReferenceCache(record: EbayReferenceCacheRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO partquill.ebay_reference_cache(
         part_number, status, record, checked_at, expires_at, retry_after, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (part_number) DO UPDATE SET
         status = EXCLUDED.status,
         record = EXCLUDED.record,
         checked_at = EXCLUDED.checked_at,
         expires_at = EXCLUDED.expires_at,
         retry_after = EXCLUDED.retry_after,
         updated_at = now()`,
      [
        canonicalOemPartNumber(record.partNumber),
        record.status,
        record,
        record.checkedAt,
        record.expiresAt,
        record.retryAfter
      ]
    );
  }

  async deleteEbayReferenceCache(partNumber: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM partquill.ebay_reference_cache WHERE part_number = $1',
      [canonicalOemPartNumber(partNumber)]
    );
  }

  async purgeExpiredEbayReferenceCache(at: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM partquill.ebay_reference_cache
       WHERE status = 'MATCHED_LIVE_REFERENCE' AND expires_at IS NOT NULL AND expires_at <= $1`,
      [at]
    );
    return result.rowCount ?? 0;
  }
}

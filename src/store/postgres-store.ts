import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import pg from 'pg';
import type { GmCatalogPart, GmCatalogStatus } from '../catalog/gm-catalog.js';
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
import type { Store } from './store.js';

const { Pool } = pg;

type JsonRow<T> = { record: T };

const GM_DATASET_ID = 'gm-catalog-v2-4a3a765e158bcc93';

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, production: boolean) {
    this.pool = new Pool({
      connectionString,
      ssl: production ? { rejectUnauthorized: false } : undefined,
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

  async importGmCatalogRecords(records: GmCatalogPart[], complete = false): Promise<void> {
    if (!records.length) return;
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
        [GM_DATASET_ID, complete ? 'completed' : 'running', lastPartNumber]
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
    const payload = records.map((record) => ({ part_number: record.partNumber, data: record }));
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
    const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
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
}

import pg from 'pg';
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

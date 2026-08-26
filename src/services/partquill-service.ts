import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { newId, now, payloadHash } from '../domain/canonical.js';
import { DomainError } from '../domain/errors.js';
import { evaluateDraft } from '../domain/policy.js';
import type {
  ApprovalRecord,
  AuditEvent,
  EvidenceRecord,
  InventoryAuthority,
  ItemRecord,
  ListingPayload,
  ListingRecord,
  StoredImage
} from '../domain/types.js';
import type { EbayGateway } from '../ebay/types.js';
import { EbayOAuthClient, REQUIRED_EBAY_SCOPES } from '../ebay/oauth-client.js';
import type { Store } from '../store/store.js';
import type { TokenVault } from '../security/token-vault.js';

export class PartQuillService {
  constructor(
    private readonly store: Store,
    private readonly ebay: EbayGateway,
    private readonly config: AppConfig,
    private readonly tokenVault?: TokenVault
  ) {}

  private async audit(input: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<void> {
    await this.store.addAudit({ ...input, id: newId(), createdAt: now() });
  }

  private async requireItem(itemId: string): Promise<ItemRecord> {
    const item = await this.store.getItem(itemId);
    if (!item) throw new DomainError('item not found', 'ITEM_NOT_FOUND', 404);
    return item;
  }

  private async accessToken(sellerId: string): Promise<string> {
    if (this.ebay.mode === 'mock') return 'mock-access-token';
    const connection = await this.store.getConnection(sellerId);
    if (!connection) {
      await this.store.saveConnection({ sellerId, scopes: [], status: 'AUTHORIZATION_REQUIRED', updatedAt: now() });
      throw new DomainError('seller authorization is required', 'AUTHORIZATION_REQUIRED', 409);
    }
    if (connection.status !== 'CONNECTED' || !connection.tokenCiphertext || !this.tokenVault) {
      throw new DomainError('seller authorization is required', 'AUTHORIZATION_REQUIRED', 409);
    }
    try {
      const tokens = JSON.parse(this.tokenVault.decrypt(connection.tokenCiphertext)) as {
        accessToken?: string;
        accessTokenExpiresAt?: string;
        refreshToken?: string;
      };
      if (!tokens.accessToken) throw new Error('missing access token');
      if (tokens.accessTokenExpiresAt && Date.parse(tokens.accessTokenExpiresAt) <= Date.now() + 60_000) {
        if (!tokens.refreshToken) throw new Error('missing refresh token');
        const refreshed = await new EbayOAuthClient(this.config).refresh(tokens.refreshToken, REQUIRED_EBAY_SCOPES);
        const updated = {
          ...tokens,
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1_000).toISOString()
        };
        await this.store.saveConnection({
          ...connection,
          tokenCiphertext: this.tokenVault.encrypt(JSON.stringify(updated)),
          updatedAt: now()
        });
        return refreshed.accessToken;
      }
      return tokens.accessToken;
    } catch (error) {
      await this.store.saveConnection({ ...connection, status: 'AUTHORIZATION_REQUIRED', updatedAt: now() });
      throw new DomainError('seller authorization could not be decrypted', 'AUTHORIZATION_REQUIRED', 409, {
        cause: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  private async refreshPolicy(item: ItemRecord): Promise<ItemRecord> {
    const evidence = await this.store.listEvidence(item.id);
    const images = await this.store.listImages(item.id);
    const exceptions = evaluateDraft(item.payload, evidence, images);
    const status = exceptions.some((row) => row.severity === 'BLOCK')
      ? 'BLOCKED'
      : exceptions.length > 0
        ? 'HELD'
        : 'READY_FOR_PREFLIGHT';
    const next = { ...item, exceptions, status, updatedAt: now() } satisfies ItemRecord;
    await this.store.saveItem(next);
    return next;
  }

  async acknowledgeInventoryApiOwnership(sellerId: string, actorId: string) {
    const acknowledgement = {
      sellerId,
      type: 'INVENTORY_API_OWNERSHIP_V1' as const,
      version: 1 as const,
      actorId,
      statement:
        'I understand that listings PartQuill creates through the eBay Inventory API must be revised and withdrawn through PartQuill’s Inventory API management path, not Seller Hub.',
      createdAt: now()
    };
    await this.store.saveAcknowledgement(acknowledgement);
    await this.audit({
      sellerId,
      actorId,
      action: 'INVENTORY_API_OWNERSHIP_ACKNOWLEDGED',
      outcome: 'SUCCEEDED',
      details: { type: acknowledgement.type, version: acknowledgement.version }
    });
    return acknowledgement;
  }

  async createItem(input: {
    sellerId: string;
    runId: string;
    inventoryAuthority: InventoryAuthority;
    payload: ListingPayload;
  }): Promise<ItemRecord> {
    const timestamp = now();
    const item: ItemRecord = {
      id: newId(),
      runId: input.runId,
      sellerId: input.sellerId,
      sku: input.payload.sku,
      status: 'CAPTURED',
      inventoryAuthority: input.inventoryAuthority,
      payload: structuredClone(input.payload),
      payloadHash: payloadHash(input.payload),
      payloadVersion: 1,
      exceptions: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.createItem(item);
    await this.audit({
      sellerId: item.sellerId,
      itemId: item.id,
      actorId: 'system',
      action: 'DRAFT_CREATED',
      outcome: 'SUCCEEDED',
      payloadHash: item.payloadHash,
      details: { runId: item.runId, inventoryAuthority: item.inventoryAuthority }
    });
    return this.refreshPolicy(item);
  }

  async resolveCatalog(itemId: string, actorId: string): Promise<ItemRecord> {
    const item = await this.requireItem(itemId);
    const resolution = await this.ebay.resolveCatalog(item.payload);
    await this.store.addEvidence({
      id: newId(),
      itemId,
      field: 'identity',
      value: resolution,
      state:
        this.ebay.mode === 'live' && resolution.outcome === 'UNIQUE_MATCH'
          ? 'EBAY_CATALOG_MATCH'
          : 'FITMENT_NOT_VERIFIED',
      source: this.ebay.mode === 'mock' ? 'MOCK_EBAY_CATALOG' : 'EBAY_CATALOG',
      createdBy: actorId,
      createdAt: now()
    });
    if (resolution.outcome === 'UNIQUE_MATCH' && resolution.epid) {
      item.payload = {
        ...item.payload,
        epid: resolution.epid,
        compatibility: resolution.compatibility ?? []
      };
      item.payloadHash = payloadHash(item.payload);
      item.payloadVersion += 1;
    }
    await this.store.saveItem(item);
    return this.refreshPolicy(item);
  }

  async addEvidence(itemId: string, input: Omit<EvidenceRecord, 'id' | 'itemId' | 'createdAt'>): Promise<ItemRecord> {
    const item = await this.requireItem(itemId);
    await this.store.addEvidence({ ...input, id: newId(), itemId, createdAt: now() });
    return this.refreshPolicy(item);
  }

  async replacePayload(itemId: string, payload: ListingPayload, actorId: string): Promise<ItemRecord> {
    const item = await this.requireItem(itemId);
    const nextHash = payloadHash(payload);
    const next: ItemRecord = {
      ...item,
      payload: structuredClone(payload),
      payloadHash: nextHash,
      payloadVersion: item.payloadVersion + 1,
      status: 'CAPTURED',
      updatedAt: now()
    };
    await this.store.saveItem(next);
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'PAYLOAD_REPLACED_APPROVALS_INVALIDATED',
      outcome: 'SUCCEEDED',
      payloadHash: nextHash,
      details: { priorHash: item.payloadHash, payloadVersion: next.payloadVersion }
    });
    return this.refreshPolicy(next);
  }

  async approvePreflight(itemId: string, actorId: string, approvedHash: string): Promise<ItemRecord> {
    const item = await this.requireItem(itemId);
    if (item.payloadHash !== approvedHash) throw new DomainError('payload changed before approval', 'PAYLOAD_HASH_MISMATCH');
    if (item.status !== 'READY_FOR_PREFLIGHT') {
      throw new DomainError('draft is not in the explicit ready-for-preflight state', 'DRAFT_NOT_READY_FOR_PREFLIGHT');
    }
    if (item.exceptions.length > 0) throw new DomainError('held or blocked draft cannot be approved', 'DRAFT_HAS_EXCEPTIONS');
    if (!(await this.store.getAcknowledgement(item.sellerId, 'INVENTORY_API_OWNERSHIP_V1'))) {
      throw new DomainError(
        'seller must acknowledge Inventory API lifecycle ownership before preflight',
        'INVENTORY_API_DISCLOSURE_REQUIRED'
      );
    }
    const approval: ApprovalRecord = {
      id: newId(),
      itemId,
      stage: 'PREFLIGHT',
      payloadHash: approvedHash,
      payloadVersion: item.payloadVersion,
      actorId,
      createdAt: now()
    };
    await this.store.addApproval(approval);
    const next = { ...item, status: 'PREFLIGHT_APPROVED' as const, updatedAt: now() };
    await this.store.saveItem(next);
    return next;
  }

  async stage(itemId: string, actorId: string): Promise<{ item: ItemRecord; listing: ListingRecord }> {
    const item = await this.requireItem(itemId);
    const approvals = await this.store.listApprovals(itemId);
    if (!approvals.some((row) => row.stage === 'PREFLIGHT' && row.payloadHash === item.payloadHash)) {
      throw new DomainError('current payload has no preflight approval', 'PREFLIGHT_APPROVAL_REQUIRED');
    }
    if (item.exceptions.length > 0) throw new DomainError('draft has unresolved exceptions', 'DRAFT_HAS_EXCEPTIONS');
    if (this.ebay.mode === 'live' && !this.config.ALLOW_EBAY_WRITES) {
      throw new DomainError('external eBay writes are disabled', 'EXTERNAL_WRITES_DISABLED');
    }
    const token = await this.accessToken(item.sellerId);
    const staged = await this.ebay.stageOffer(item.payload, token);
    const feeEstimate = await this.ebay.estimateFees(item.payload, token);
    const timestamp = now();
    const listing: ListingRecord = {
      id: newId(),
      itemId,
      sellerId: item.sellerId,
      offerId: staged.offerId,
      status: 'STAGED',
      feeEstimate,
      remoteSnapshot: staged.remoteSnapshot,
      lastApprovedPayloadHash: item.payloadHash,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.saveListing(listing);
    const next = { ...item, status: 'READY_FOR_PUBLIC_APPROVAL' as const, updatedAt: timestamp };
    await this.store.saveItem(next);
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'OFFER_STAGED',
      outcome: 'SUCCEEDED',
      payloadHash: item.payloadHash,
      details: { offerId: listing.offerId, feeEstimateId: feeEstimate.id, gatewayMode: this.ebay.mode }
    });
    return { item: next, listing };
  }

  async approvePublic(
    itemId: string,
    actorId: string,
    approvedHash: string,
    feeEstimateId: string
  ): Promise<ItemRecord> {
    const item = await this.requireItem(itemId);
    const listing = await this.store.getListing(itemId);
    if (!listing || listing.status !== 'STAGED') throw new DomainError('staged offer is required', 'STAGED_OFFER_REQUIRED');
    if (item.payloadHash !== approvedHash || listing.lastApprovedPayloadHash !== approvedHash) {
      throw new DomainError('payload changed after staging', 'PAYLOAD_HASH_MISMATCH');
    }
    if (!listing.feeEstimate || listing.feeEstimate.id !== feeEstimateId) {
      throw new DomainError('fee estimate changed or is missing', 'FEE_ESTIMATE_MISMATCH');
    }
    if (Date.parse(listing.feeEstimate.expiresAt) <= Date.now()) {
      throw new DomainError('fee estimate expired', 'FEE_ESTIMATE_EXPIRED');
    }
    await this.store.addApproval({
      id: newId(),
      itemId,
      stage: 'PUBLIC',
      payloadHash: approvedHash,
      payloadVersion: item.payloadVersion,
      feeEstimateId,
      actorId,
      createdAt: now()
    });
    const next = { ...item, status: 'PUBLIC_APPROVED' as const, updatedAt: now() };
    await this.store.saveItem(next);
    return next;
  }

  async publish(itemId: string, actorId: string): Promise<{ item: ItemRecord; listing: ListingRecord }> {
    const item = await this.requireItem(itemId);
    const listing = await this.store.getListing(itemId);
    const approvals = await this.store.listApprovals(itemId);
    const publicApproval = approvals.find(
      (row) => row.stage === 'PUBLIC' && row.payloadHash === item.payloadHash && row.feeEstimateId === listing?.feeEstimate?.id
    );
    const reject = async (code: string, message: string): Promise<never> => {
      await this.audit({
        sellerId: item.sellerId,
        itemId,
        actorId,
        action: 'LISTING_PUBLISH_REJECTED',
        outcome: 'REJECTED',
        payloadHash: item.payloadHash,
        details: { code }
      });
      throw new DomainError(message, code);
    };
    if (!this.config.ALLOW_EBAY_WRITES) return reject('EXTERNAL_WRITES_DISABLED', 'external eBay writes are disabled');
    if (!listing || listing.status !== 'STAGED') return reject('STAGED_OFFER_REQUIRED', 'staged offer is required');
    if (!publicApproval) return reject('PUBLIC_APPROVAL_REQUIRED', 'unchanged payload needs public approval');
    if (item.exceptions.length > 0) return reject('DRAFT_HAS_EXCEPTIONS', 'draft has unresolved exceptions');
    if (!(await this.store.reserveFreePublish(item.sellerId, itemId, 10))) {
      return reject('FREE_ALLOWANCE_EXHAUSTED', 'free launch allowance is exhausted');
    }
    let published;
    try {
      const token = await this.accessToken(item.sellerId);
      published = await this.ebay.publish(listing.offerId, token);
    } catch (error) {
      await this.store.releaseFreePublish(itemId);
      await this.audit({
        sellerId: item.sellerId,
        itemId,
        actorId,
        action: 'LISTING_PUBLISH_FAILED',
        outcome: 'FAILED',
        payloadHash: item.payloadHash,
        details: { message: error instanceof Error ? error.message : 'unknown publish failure' }
      });
      throw error;
    }
    const timestamp = now();
    const nextListing: ListingRecord = {
      ...listing,
      listingId: published.listingId,
      status: 'PUBLISHED',
      remoteSnapshot: published.remoteSnapshot,
      updatedAt: timestamp
    };
    const nextItem = { ...item, status: 'PUBLISHED' as const, updatedAt: timestamp };
    await this.store.saveListing(nextListing);
    await this.store.saveItem(nextItem);
    await this.store.finalizeFreePublish(itemId);
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'LISTING_PUBLISHED',
      outcome: 'SUCCEEDED',
      payloadHash: item.payloadHash,
      details: { offerId: listing.offerId, listingId: published.listingId, gatewayMode: this.ebay.mode }
    });
    return { item: nextItem, listing: nextListing };
  }

  async revise(itemId: string, actorId: string, changes: { price?: string; quantity?: number }): Promise<ListingRecord> {
    const item = await this.requireItem(itemId);
    const listing = await this.store.getListing(itemId);
    if (!listing || listing.status !== 'PUBLISHED') throw new DomainError('published listing is required', 'LISTING_NOT_PUBLISHED');
    if (!this.config.ALLOW_EBAY_WRITES) throw new DomainError('external eBay writes are disabled', 'EXTERNAL_WRITES_DISABLED');
    const token = await this.accessToken(item.sellerId);
    const revised = await this.ebay.revise(listing.offerId, changes, token);
    const nextPayload: ListingPayload = {
      ...item.payload,
      price: changes.price ? { ...item.payload.price, value: changes.price } : item.payload.price,
      quantity: changes.quantity ?? item.payload.quantity
    };
    const nextItem: ItemRecord = {
      ...item,
      payload: nextPayload,
      payloadHash: payloadHash(nextPayload),
      payloadVersion: item.payloadVersion + 1,
      updatedAt: now()
    };
    const nextListing = { ...listing, remoteSnapshot: revised.remoteSnapshot, updatedAt: now() };
    await this.store.saveItem(nextItem);
    await this.store.saveListing(nextListing);
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'LISTING_REVISED',
      outcome: 'SUCCEEDED',
      payloadHash: nextItem.payloadHash,
      details: changes
    });
    return nextListing;
  }

  async withdraw(itemId: string, actorId: string, reason: string): Promise<ListingRecord> {
    const item = await this.requireItem(itemId);
    const listing = await this.store.getListing(itemId);
    if (!listing || listing.status !== 'PUBLISHED') throw new DomainError('published listing is required', 'LISTING_NOT_PUBLISHED');
    if (!this.config.ALLOW_EBAY_WRITES) throw new DomainError('external eBay writes are disabled', 'EXTERNAL_WRITES_DISABLED');
    const token = await this.accessToken(item.sellerId);
    const withdrawn = await this.ebay.withdraw(listing.offerId, token);
    const timestamp = now();
    const nextListing = { ...listing, status: 'WITHDRAWN' as const, remoteSnapshot: withdrawn.remoteSnapshot, updatedAt: timestamp };
    await this.store.saveListing(nextListing);
    await this.store.saveItem({ ...item, status: 'WITHDRAWN', updatedAt: timestamp });
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'LISTING_WITHDRAWN',
      outcome: 'SUCCEEDED',
      payloadHash: item.payloadHash,
      details: { reason }
    });
    return nextListing;
  }

  async reconcile(itemId: string, actorId: string): Promise<{ drifted: boolean; listing: ListingRecord }> {
    const item = await this.requireItem(itemId);
    const listing = await this.store.getListing(itemId);
    if (!listing) throw new DomainError('listing not found', 'LISTING_NOT_FOUND', 404);
    const token = await this.accessToken(item.sellerId);
    const remote = await this.ebay.getOffer(listing.offerId, token);
    const localDigest = payloadHash(listing.remoteSnapshot);
    const remoteDigest = payloadHash(remote);
    const drifted = localDigest !== remoteDigest;
    const next: ListingRecord = {
      ...listing,
      status: drifted ? 'DRIFTED' : listing.status,
      remoteSnapshot: drifted ? listing.remoteSnapshot : remote,
      updatedAt: now()
    };
    await this.store.saveListing(next);
    if (drifted) {
      const driftEvidence = {
        id: newId(),
        itemId,
        field: 'remoteSnapshot',
        value: { localDigest, remoteDigest, remote },
        state: 'REMOTE_CHANGE_DETECTED',
        source: 'EBAY_RECONCILIATION',
        createdBy: actorId,
        createdAt: now()
      } as const;
      await this.store.addEvidence(driftEvidence);
      await this.refreshPolicy(item);
    }
    return { drifted, listing: next };
  }

  async resolveDrift(
    itemId: string,
    actorId: string,
    decision: 'ACCEPT_REMOTE' | 'PREPARE_LOCAL_REVISION'
  ): Promise<{ item: ItemRecord; listing: ListingRecord }> {
    const item = await this.requireItem(itemId);
    const listing = await this.store.getListing(itemId);
    if (!listing || listing.status !== 'DRIFTED') throw new DomainError('drifted listing is required', 'LISTING_NOT_DRIFTED');
    const evidence = await this.store.listEvidence(itemId);
    const superseded = new Set(evidence.map((row) => row.supersedesId).filter(Boolean));
    const drift = [...evidence]
      .reverse()
      .find((row) => row.state === 'REMOTE_CHANGE_DETECTED' && !superseded.has(row.id));
    if (!drift) throw new DomainError('unresolved drift evidence is required', 'DRIFT_EVIDENCE_NOT_FOUND');

    const driftValue = drift.value as { remote?: unknown };
    const resolution = {
      id: newId(),
      itemId,
      field: 'remoteSnapshot',
      value: { decision },
      state: 'SELLER_CONFIRMED' as const,
      source: 'DRIFT_DISPOSITION',
      createdBy: actorId,
      createdAt: now(),
      supersedesId: drift.id
    };
    await this.store.addEvidence(resolution);
    const updatedListing: ListingRecord = {
      ...listing,
      status: decision === 'ACCEPT_REMOTE' ? 'PUBLISHED' : 'DRIFTED',
      remoteSnapshot: decision === 'ACCEPT_REMOTE' && driftValue.remote !== undefined ? driftValue.remote : listing.remoteSnapshot,
      updatedAt: now()
    };
    await this.store.saveListing(updatedListing);
    const refreshed = await this.refreshPolicy(item);
    const updatedItem =
      decision === 'PREPARE_LOCAL_REVISION'
        ? { ...refreshed, status: 'READY_FOR_PREFLIGHT' as const, updatedAt: now() }
        : { ...refreshed, status: 'PUBLISHED' as const, updatedAt: now() };
    await this.store.saveItem(updatedItem);
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'REMOTE_DRIFT_DISPOSITION_RECORDED',
      outcome: 'SUCCEEDED',
      payloadHash: item.payloadHash,
      details: { decision, driftEvidenceId: drift.id }
    });
    return { item: updatedItem, listing: updatedListing };
  }

  async reportDoesNotFit(
    itemId: string,
    actorId: string,
    reason: string,
    evidenceId?: string
  ): Promise<{ item: ItemRecord; siblingItemIds: string[] }> {
    const item = await this.requireItem(itemId);
    const existingEvidence = await this.store.listEvidence(itemId);
    const citedEvidence = evidenceId ? existingEvidence.find((row) => row.id === evidenceId) : undefined;
    if (evidenceId && !citedEvidence) {
      throw new DomainError('cited evidence row does not belong to this item', 'EVIDENCE_NOT_FOUND', 404);
    }
    await this.store.addEvidence({
      id: newId(),
      itemId,
      field: 'compatibility',
      value: { reason, citedEvidenceId: evidenceId ?? null, priorCompatibility: item.payload.compatibility },
      state: 'COMPATIBILITY_REOPENED',
      source: 'DOES_NOT_FIT_FEEDBACK',
      createdBy: actorId,
      createdAt: now()
    });
    const nextPayload = { ...item.payload, compatibility: [] };
    const next: ItemRecord = {
      ...item,
      payload: nextPayload,
      payloadHash: payloadHash(nextPayload),
      payloadVersion: item.payloadVersion + 1,
      updatedAt: now()
    };
    await this.store.saveItem(next);
    await this.audit({
      sellerId: item.sellerId,
      itemId,
      actorId,
      action: 'FITMENT_EVIDENCE_REOPENED',
      outcome: 'SUCCEEDED',
      payloadHash: next.payloadHash,
      details: { reason, evidenceId: evidenceId ?? null }
    });
    const siblingItemIds: string[] = [];
    if (citedEvidence?.sourceReference) {
      const sellerItems = await this.store.listItems(item.sellerId);
      for (const sibling of sellerItems.filter((candidate) => candidate.id !== itemId)) {
        const siblingEvidence = await this.store.listEvidence(sibling.id);
        const sharedEdge = siblingEvidence.find(
          (row) => row.state === 'EBAY_COMPATIBILITY' && row.sourceReference === citedEvidence.sourceReference
        );
        if (!sharedEdge) continue;
        await this.store.addEvidence({
          id: newId(),
          itemId: sibling.id,
          field: 'compatibility',
          value: { reason: 'Sibling claim shares reopened evidence edge', triggeringItemId: itemId },
          state: 'COMPATIBILITY_REOPENED',
          source: 'SIBLING_FITMENT_QUARANTINE',
          sourceReference: citedEvidence.sourceReference,
          createdBy: actorId,
          createdAt: now()
        });
        const siblingPayload = { ...sibling.payload, compatibility: [] };
        const siblingNext = {
          ...sibling,
          payload: siblingPayload,
          payloadHash: payloadHash(siblingPayload),
          payloadVersion: sibling.payloadVersion + 1,
          updatedAt: now()
        };
        await this.store.saveItem(siblingNext);
        await this.refreshPolicy(siblingNext);
        siblingItemIds.push(sibling.id);
      }
    }
    return { item: await this.refreshPolicy(next), siblingItemIds };
  }

  async saveImage(
    itemId: string,
    input: Omit<StoredImage, 'id' | 'itemId' | 'sha256' | 'createdAt'>
  ): Promise<{ image: StoredImage; item: ItemRecord }> {
    const item = await this.requireItem(itemId);
    if (input.kind !== 'ORIGINAL') {
      if (!input.originalImageId) throw new DomainError('derivative requires an original image', 'ORIGINAL_IMAGE_REQUIRED');
      const original = await this.store.getImage(input.originalImageId);
      if (!original || original.itemId !== itemId || original.kind !== 'ORIGINAL') {
        throw new DomainError('valid immutable original is required', 'ORIGINAL_IMAGE_REQUIRED');
      }
    }
    if (input.watermarkStatus === 'SUSPECTED_THIRD_PARTY') {
      throw new DomainError('suspected third-party watermark cannot be removed', 'THIRD_PARTY_WATERMARK_BLOCKED');
    }
    const image: StoredImage = {
      ...input,
      id: newId(),
      itemId,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      createdAt: now()
    };
    await this.store.saveImage(image);
    const nextPayload = { ...item.payload, imageIds: [...item.payload.imageIds, image.id] };
    const nextItem: ItemRecord = {
      ...item,
      payload: nextPayload,
      payloadHash: payloadHash(nextPayload),
      payloadVersion: item.payloadVersion + 1,
      updatedAt: now()
    };
    await this.store.saveItem(nextItem);
    return { image, item: await this.refreshPolicy(nextItem) };
  }

  async exceptionQueue(sellerId: string): Promise<ItemRecord[]> {
    const items = await this.store.listItems(sellerId);
    return items
      .filter((item) => item.exceptions.length > 0 || ['BLOCKED', 'HELD'].includes(item.status))
      .sort((left, right) => {
        const leftBlock = left.exceptions.some((row) => row.severity === 'BLOCK') ? 1 : 0;
        const rightBlock = right.exceptions.some((row) => row.severity === 'BLOCK') ? 1 : 0;
        return rightBlock - leftBlock || left.createdAt.localeCompare(right.createdAt);
      });
  }

  async evidencePack(itemId: string): Promise<Record<string, unknown>> {
    const item = await this.requireItem(itemId);
    return {
      generatedAt: now(),
      item,
      evidence: await this.store.listEvidence(itemId),
      approvals: await this.store.listApprovals(itemId),
      listing: await this.store.getListing(itemId),
      images: (await this.store.listImages(itemId)).map(({ bytes, ...image }) => ({ ...image, byteLength: bytes.length })),
      audit: await this.store.listAudit(itemId)
    };
  }
}

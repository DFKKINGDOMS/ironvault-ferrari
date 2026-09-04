import type { ImageJobStore } from '../image-studio/file-store.js';

export const DEERE_COLLECTION_PILOT_JOB_ID = 'deere-model-pilot-v1';

export interface DeerePilotImage {
  collectionId: string;
  collectionTitle: string;
  handle: string;
  model: string;
  machineType: string;
  sourceUrl: string;
  slug: string;
  status: 'PASS' | 'HOLD';
  artifactPath?: string;
  sha256?: string;
  qc?: Record<string, unknown>;
  failureReason?: string;
}

export interface DeerePilotManifest {
  id: typeof DEERE_COLLECTION_PILOT_JOB_ID;
  batchId: string;
  approvalState: 'AWAITING_OWNER_APPROVAL';
  shopifyWritePerformed: false;
  generatedAt: string;
  generator: string;
  reviewer: string;
  images: DeerePilotImage[];
  skipped: Array<{ collectionTitle: string; reason: string }>;
}

export class DeereCollectionPilotStore {
  constructor(private readonly files: ImageJobStore) {}

  async latest(): Promise<DeerePilotManifest | undefined> {
    return this.files.getJob<DeerePilotManifest>(DEERE_COLLECTION_PILOT_JOB_ID);
  }

  async publicLatest(): Promise<Record<string, unknown> | undefined> {
    const manifest = await this.latest();
    if (!manifest) return undefined;
    return {
      ...manifest,
      images: manifest.images.map(({ artifactPath: _artifactPath, ...image }) => ({
        ...image,
        ...(image.status === 'PASS' ? { imageUrl: `/v1/deere-model-pilot/images/${image.slug}` } : {})
      }))
    };
  }

  async readImage(slug: string): Promise<Uint8Array | undefined> {
    const manifest = await this.latest();
    const image = manifest?.images.find((row) => row.slug === slug && row.status === 'PASS');
    if (!image?.artifactPath) return undefined;
    return this.files.readBytes(image.artifactPath);
  }
}

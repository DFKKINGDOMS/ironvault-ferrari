import {
  EBAY_INTELLECTUAL_PROPERTY_POLICY_URL,
  EBAY_VERO_PROFILE_INDEX_URL
} from './brand-title-policy.js';

export interface EbayVeroProfileSnapshot {
  status: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
  sourceUrl: string;
  policyUrl: string;
  completeness: 'OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE';
  fetchedAt: string | null;
  participantCount: number;
  participants: string[];
  warning: string;
}

const CACHE_MS = 24 * 60 * 60_000;

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseEbayVeroParticipantProfiles(html: string): string[] {
  const marker = html.search(/VeRO participant profiles/i);
  const scoped = marker >= 0 ? html.slice(marker) : html;
  const profiles = new Set<string>();
  const anchor = /<a\b[^>]*href=["'][^"']*(?:ir\.ebaystatic\.com|pages\.ebay\.com\/vero)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(scoped))) {
    const name = decodeHtml(match[1] ?? '');
    if (
      name.length >= 2
      && name.length <= 180
      && !/^(?:image|learn more|contact|privacy|terms)$/i.test(name)
    ) profiles.add(name);
  }
  return [...profiles].sort((left, right) => left.localeCompare(right));
}

export class EbayVeroProfileService {
  private snapshot: EbayVeroProfileSnapshot = {
    status: 'UNAVAILABLE',
    sourceUrl: EBAY_VERO_PROFILE_INDEX_URL,
    policyUrl: EBAY_INTELLECTUAL_PROPERTY_POLICY_URL,
    completeness: 'OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE',
    fetchedAt: null,
    participantCount: 0,
    participants: [],
    warning: 'eBay states that its public participant-profile index is not a complete list of brands with intellectual-property rights.'
  };

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  async getSnapshot(force = false): Promise<EbayVeroProfileSnapshot> {
    const fetchedAt = this.snapshot.fetchedAt ? Date.parse(this.snapshot.fetchedAt) : 0;
    if (!force && fetchedAt && this.now() - fetchedAt < CACHE_MS) return this.snapshot;
    try {
      const response = await this.fetchImpl(EBAY_VERO_PROFILE_INDEX_URL, {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'PartQuill-Policy-Reference/0.17 (+read-only)'
        },
        redirect: 'follow'
      });
      if (!response.ok) throw new Error(`VeRO profile index returned ${response.status}`);
      const participants = parseEbayVeroParticipantProfiles(await response.text());
      if (participants.length < 50) {
        throw new Error('VeRO profile index did not contain a credible participant set');
      }
      this.snapshot = {
        ...this.snapshot,
        status: 'CURRENT',
        fetchedAt: new Date(this.now()).toISOString(),
        participantCount: participants.length,
        participants
      };
    } catch {
      this.snapshot = {
        ...this.snapshot,
        status: this.snapshot.participantCount ? 'STALE' : 'UNAVAILABLE'
      };
    }
    return this.snapshot;
  }
}

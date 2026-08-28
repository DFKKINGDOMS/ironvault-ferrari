import { describe, expect, it, vi } from 'vitest';
import { EbayVeroProfileService, parseEbayVeroParticipantProfiles } from '../src/ebay/vero-profile-service.js';

describe('eBay VeRO profile parser', () => {
  it('extracts and de-duplicates rights-owner profile names only from official profile links', () => {
    const html = `
      <h2>VeRO participant profiles</h2>
      <a href="https://ir.ebaystatic.com/pictures/aw/pics/vero/generalmotors.pdf">General Motors</a>
      <a href="https://ir.ebaystatic.com/pictures/aw/pics/vero/johndeere.pdf"><b>John Deere</b></a>
      <a href="https://ir.ebaystatic.com/pictures/aw/pics/vero/generalmotors.pdf">General Motors</a>
      <a href="https://example.com/not-official">Ignore Me</a>
    `;
    expect(parseEbayVeroParticipantProfiles(html)).toEqual(['General Motors', 'John Deere']);
  });
  it('downloads the official index read-only and caches a credible participant set', async () => {
    const links = Array.from({ length: 60 }, (_, index) =>
      '<a href="https://ir.ebaystatic.com/pictures/aw/pics/vero/profile-' + index + '.pdf">Brand ' + index + '</a>'
    ).join('');
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('GET');
      return new Response('<h2>VeRO participant profiles</h2>' + links, { status: 200 });
    });
    const service = new EbayVeroProfileService(fetchImpl, () => Date.parse('2026-08-28T20:00:00Z'));

    const first = await service.getSnapshot();
    const cached = await service.getSnapshot();

    expect(first).toMatchObject({ status: 'CURRENT', participantCount: 60 });
    expect(first.completeness).toBe('OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE');
    expect(cached).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

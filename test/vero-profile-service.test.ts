import { describe, expect, it } from 'vitest';
import { parseEbayVeroParticipantProfiles } from '../src/ebay/vero-profile-service.js';

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
});

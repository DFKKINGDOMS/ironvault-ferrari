import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signOAuthState, verifyOAuthState } from '../src/security/oauth-state.js';
import { TokenVault } from '../src/security/token-vault.js';

describe('secret handling', () => {
  it('round-trips encrypted seller tokens without plaintext storage', () => {
    const vault = new TokenVault(randomBytes(32).toString('base64'));
    const cipherText = vault.encrypt('{"refreshToken":"secret"}');
    expect(cipherText).not.toContain('secret');
    expect(vault.decrypt(cipherText)).toBe('{"refreshToken":"secret"}');
  });

  it('rejects tampered and expired OAuth state', () => {
    const secret = 'an-oauth-state-secret-long-enough';
    const valid = signOAuthState({ sellerId: 'seller-1', nonce: 'n-1', expiresAt: Date.now() + 10_000 }, secret);
    expect(verifyOAuthState(valid, secret).sellerId).toBe('seller-1');
    expect(() => verifyOAuthState(`${valid}x`, secret)).toThrow();
    const expired = signOAuthState({ sellerId: 'seller-1', nonce: 'n-2', expiresAt: 1 }, secret);
    expect(() => verifyOAuthState(expired, secret)).toThrow('expired');
  });
});

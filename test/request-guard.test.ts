import { describe, expect, it } from 'vitest';
import { RequestGuard, RequestLimitError } from '../src/security/request-guard.js';

describe('request guard', () => {
  it('limits concurrent work and releases permits idempotently', () => {
    const guard = new RequestGuard(10, 60_000, 1, () => 1_000);
    const permit = guard.acquire('client');
    expect(() => guard.acquire('other')).toThrowError(RequestLimitError);
    permit.release();
    permit.release();
    expect(() => guard.acquire('other')).not.toThrow();
  });

  it('enforces and then resets a per-key time window', () => {
    let clock = 1_000;
    const guard = new RequestGuard(1, 1_000, 2, () => clock);
    guard.acquire('client').release();
    expect(() => guard.acquire('client')).toThrow('request rate limit reached');
    clock = 2_001;
    expect(() => guard.acquire('client')).not.toThrow();
  });
});

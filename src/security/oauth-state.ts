import { createHmac, timingSafeEqual } from 'node:crypto';

interface StatePayload {
  sellerId: string;
  nonce: string;
  expiresAt: number;
}

export function signOAuthState(payload: StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyOAuthState(state: string, secret: string, now = Date.now()): StatePayload {
  const [body, signature] = state.split('.');
  if (!body || !signature) throw new Error('invalid OAuth state');
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('invalid OAuth state');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  if (!payload.sellerId || !payload.nonce || payload.expiresAt < now) throw new Error('expired OAuth state');
  return payload;
}

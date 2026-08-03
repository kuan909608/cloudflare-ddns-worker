import { base64Url, bytesToHex, utf8 } from '../utils/encoding';

export async function hashToken(token: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(token))));
}

export async function generateToken(): Promise<{ token: string; hash: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = `ddns_${base64Url(random)}`;
  return { token, hash: await hashToken(token) };
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = utf8(left);
  const b = utf8(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyToken(token: string, expectedHash: string): Promise<boolean> {
  return constantTimeEqual(await hashToken(token), expectedHash);
}

import { describe, expect, it } from 'vitest';
import { constantTimeEqual, generateToken, hashToken, verifyToken } from '../src/services/token-service';

describe('client token security', () => {
  it('generates 256-bit url-safe one-time credentials', async () => { const a=await generateToken(); const b=await generateToken(); expect(a.token).toMatch(/^ddns_[A-Za-z0-9_-]{43}$/u); expect(a.hash).toMatch(/^[a-f0-9]{64}$/u); expect(a.token).not.toBe(b.token); });
  it('hashes deterministically and verifies the digest', async () => { const hash=await hashToken('ddns_test_credential_value'); expect(await verifyToken('ddns_test_credential_value',hash)).toBe(true); expect(await verifyToken('ddns_wrong_credential_value',hash)).toBe(false); });
  it('compares every byte and rejects length mismatch', () => { expect(constantTimeEqual('a'.repeat(64),'a'.repeat(64))).toBe(true); expect(constantTimeEqual('a'.repeat(64),`${'a'.repeat(63)}b`)).toBe(false); expect(constantTimeEqual('short','longer')).toBe(false); });
});

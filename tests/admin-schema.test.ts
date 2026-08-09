import { describe, expect, it } from 'vitest';
import { clientInputSchema, publicClient } from '../src/application/admin-clients';

const existing = { displayName:'Home', slug:'home-1', bindingMode:'existing' as const, recordId:'2'.repeat(32) };
const pending = { displayName:'Cabin', slug:'cabin-1', bindingMode:'new' as const, hostname:'cabin', recordType:'AAAA' as const };

describe('admin validation', () => {
  it('accepts either an existing Record ID or a new fixed-Zone hostname', () => {
    expect(clientInputSchema.safeParse(existing).success).toBe(true);
    expect(clientInputSchema.safeParse(pending).success).toBe(true);
  });

  it.each([
    {...existing,slug:'../admin'}, {...existing,recordName:'home.example.com'},
    {...pending,hostname:'other.example.com'}, {...pending,recordType:'TXT'}, {...pending,zoneId:'1'.repeat(32)},
  ])('rejects injection, duplicate canonical fields or browser-controlled Zone data', (value) => {
    expect(clientInputSchema.safeParse(value).success).toBe(false);
  });

  it('never serializes token hash and exposes pending state explicitly', () => {
    const result=publicClient({id:crypto.randomUUID(),displayName:'Cabin',slug:'cabin-1',zoneId:'1'.repeat(32),zoneName:'example.com',recordId:null,recordName:'cabin.example.com',recordType:'AAAA',enabled:true,tokenHash:'secret',tokenCreatedAt:'now',lastIp:null,lastSourceIp:null,lastStatus:null,lastUpdatedAt:null,createdAt:'now',updatedAt:'now'});
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).toMatchObject({tokenConfigured:true,recordPending:true});
  });
});

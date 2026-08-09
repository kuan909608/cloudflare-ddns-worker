import { describe, expect, it } from 'vitest';
import { clientInputSchema, publicClient } from '../src/application/admin-clients';

const requestInput = { displayName:'Home', slug:'home-1', recordId:'2'.repeat(32), recordName:'home.example.com', recordType:'A' as const };

describe('admin validation', () => {
  it('accepts a record binding without browser-controlled Zone fields', () => {
    expect(clientInputSchema.safeParse(requestInput).success).toBe(true);
  });

  it.each([
    {...requestInput,slug:'../admin'},
    {...requestInput,recordType:'TXT'},
    {...requestInput,recordName:'x'},
    {...requestInput,zoneId:'1'.repeat(32)},
  ])('rejects injection, invalid fields or a browser-controlled Zone', (value) => {
    expect(clientInputSchema.safeParse(value).success).toBe(false);
  });

  it('never serializes token hash', () => {
    const result=publicClient({id:crypto.randomUUID(),...requestInput,zoneId:'1'.repeat(32),zoneName:'example.com',enabled:true,tokenHash:'secret',tokenCreatedAt:'now',lastIp:null,lastSourceIp:null,lastStatus:null,lastUpdatedAt:null,createdAt:'now',updatedAt:'now'});
    expect(result).not.toHaveProperty('tokenHash');
    expect(result.tokenConfigured).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AdminClientsUseCase } from '../src/application/admin-clients';
import type { Client } from '../src/domain/models';
import type { ClientRepository } from '../src/repositories/client-repository';
import type { DnsRecord, DnsRecordGateway } from '../src/repositories/dns-record-gateway';

const zone = { id:'1'.repeat(32), name:'example.com' };
const client: Client = {
  id:'client', displayName:'Home', slug:'home', enabled:true, zoneId:zone.id, zoneName:zone.name,
  recordId:'2'.repeat(32), recordName:'home.example.com', recordType:'A', tokenHash:'hash', tokenCreatedAt:'now',
  lastIp:'1.1.1.1', lastSourceIp:null, lastStatus:null, lastUpdatedAt:null, createdAt:'now', updatedAt:'now',
};
const existingInput = { displayName:'Home', slug:'home-1', bindingMode:'existing' as const, recordId:client.recordId! };
const pendingInput = { displayName:'Cabin', slug:'cabin-1', bindingMode:'new' as const, hostname:'cabin', recordType:'AAAA' as const };

function repository(): ClientRepository {
  return {
    list:vi.fn(), findById:vi.fn(async()=>client), findBySlug:vi.fn(), create:vi.fn(), update:vi.fn(),
    claimRecordProvisioning:vi.fn(), bindProvisionedRecord:vi.fn(), releaseRecordProvisioning:vi.fn(),
    setEnabled:vi.fn(), rotateToken:vi.fn(), updateStatus:vi.fn(), remove:vi.fn(), addLog:vi.fn(), logs:vi.fn(), audit:vi.fn(), dashboard:vi.fn(),
  };
}

function record(overrides: Partial<DnsRecord> = {}): DnsRecord {
  return { id:client.recordId!, zoneId:zone.id, zoneName:zone.name, name:client.recordName, type:'A', content:'8.8.8.8', ttl:1, ...overrides };
}

function dns(overrides: Partial<DnsRecordGateway> = {}): DnsRecordGateway {
  return { getZone:vi.fn(async()=>zone), getRecord:vi.fn(async()=>record()), findRecords:vi.fn(async()=>[]), create:vi.fn(async()=>record()), update:vi.fn(), ...overrides };
}

describe('admin client details', () => {
  it('returns live Cloudflare content for a bound Client', async () => {
    await expect(new AdminClientsUseCase(repository(), dns(), zone).get('client')).resolves.toMatchObject({ lastIp:'1.1.1.1', currentDnsIp:'8.8.8.8', recordPending:false });
  });

  it('returns a pending Client without querying a nonexistent Record ID', async () => {
    const repo=repository(); vi.mocked(repo.findById).mockResolvedValue({ ...client, recordId:null, recordName:'cabin.example.com' });
    const api=dns();
    await expect(new AdminClientsUseCase(repo,api,zone).get('client')).resolves.toMatchObject({currentDnsIp:null,recordPending:true});
    expect(api.getRecord).not.toHaveBeenCalled();
    expect(api.getZone).not.toHaveBeenCalled();
  });

  it('maps only unique constraints to conflict and preserves infrastructure failures', async () => {
    const conflictRepository=repository();vi.mocked(conflictRepository.create).mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: clients.slug'));
    await expect(new AdminClientsUseCase(conflictRepository,dns(),zone).create(existingInput)).rejects.toMatchObject({status:409});
    const failedRepository=repository();vi.mocked(failedRepository.create).mockRejectedValue(new Error('D1 unavailable'));
    await expect(new AdminClientsUseCase(failedRepository,dns(),zone).create(existingInput)).rejects.toThrow('D1 unavailable');
  });

  it('rejects a Cloudflare Record outside the fixed Zone', async () => {
    await expect(new AdminClientsUseCase(repository(),dns({getRecord:vi.fn(async()=>record({zoneId:'different-zone'}))}),zone).create(existingInput)).rejects.toMatchObject({status:400});
  });

  it('creates a bound Client using only the canonical Cloudflare Record response', async () => {
    const repo=repository();vi.mocked(repo.create).mockResolvedValue({...client,lastIp:null});
    await expect(new AdminClientsUseCase(repo,dns(),zone).create(existingInput)).resolves.toMatchObject({client:{currentDnsIp:'8.8.8.8',recordPending:false}});
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({zoneId:zone.id,zoneName:zone.name,recordName:'home.example.com',recordType:'A'}));
  });

  it('creates a pending Client without calling Cloudflare until its first DDNS update', async () => {
    const pending={...client,displayName:'Cabin',slug:'cabin-1',recordId:null,recordName:'cabin.example.com',recordType:'AAAA' as const,lastIp:null};
    const repo=repository();vi.mocked(repo.create).mockResolvedValue(pending);
    const api=dns();
    await expect(new AdminClientsUseCase(repo,api,zone).create(pendingInput)).resolves.toMatchObject({client:{recordId:null,recordName:'cabin.example.com',recordPending:true,currentDnsIp:null}});
    expect(api.getRecord).not.toHaveBeenCalled();
    expect(api.getZone).toHaveBeenCalledWith(zone.id);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({recordId:null,recordName:'cabin.example.com',recordType:'AAAA'}));
  });

  it('does not allow changing binding mode after creation', async () => {
    await expect(new AdminClientsUseCase(repository(),dns(),zone).update(client.id,pendingInput)).rejects.toMatchObject({status:400});
  });

  it('returns live content for bound list entries and null for pending entries', async () => {
    const repo=repository();vi.mocked(repo.list).mockResolvedValue([client,{...client,id:'pending',slug:'pending',recordId:null,recordName:'pending.example.com'}]);
    await expect(new AdminClientsUseCase(repo,dns({getRecord:vi.fn(async()=>record({content:'9.9.9.9'}))}),zone).list()).resolves.toEqual([
      expect.objectContaining({currentDnsIp:'9.9.9.9',recordPending:false}), expect.objectContaining({currentDnsIp:null,recordPending:true}),
    ]);
  });
});

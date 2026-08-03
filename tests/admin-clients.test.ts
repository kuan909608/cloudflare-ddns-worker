import { describe, expect, it, vi } from 'vitest';
import { AdminClientsUseCase } from '../src/application/admin-clients';
import type { Client } from '../src/domain/models';
import type { ClientRepository } from '../src/repositories/client-repository';
import type { DnsRecordGateway } from '../src/repositories/dns-record-gateway';

const client: Client = {
  id: 'client', displayName: 'Home', slug: 'home', enabled: true, zoneId: 'zone', zoneName: 'example.com',
  recordId: 'record', recordName: 'home.example.com', recordType: 'A', tokenHash: 'hash', tokenCreatedAt: 'now',
  lastIp: '1.1.1.1', lastSourceIp: null, lastStatus: null, lastUpdatedAt: null, createdAt: 'now', updatedAt: 'now',
};

function repository(): ClientRepository {
  return { list:vi.fn(), findById:vi.fn(async()=>client), findBySlug:vi.fn(), create:vi.fn(), update:vi.fn(), setEnabled:vi.fn(), rotateToken:vi.fn(), updateStatus:vi.fn(), remove:vi.fn(), addLog:vi.fn(), logs:vi.fn(), audit:vi.fn(), dashboard:vi.fn() };
}

describe('admin client details', () => {
  it('returns the current Cloudflare DNS content independently of cached last IP', async () => {
    const dns: DnsRecordGateway = {
      getRecord: vi.fn(async () => ({ id:'record', zoneId:'zone', zoneName:'example.com', name:'home.example.com', type:'A' as const, content:'8.8.8.8', ttl:1 })),
      update: vi.fn(),
    };
    await expect(new AdminClientsUseCase(repository(), dns).get('client')).resolves.toMatchObject({ lastIp:'1.1.1.1', currentDnsIp:'8.8.8.8' });
  });

  it('maps only unique constraints to conflict and preserves infrastructure failures', async () => {
    const input={displayName:'Home',slug:'home-1',zoneId:'1'.repeat(32),zoneName:'example.com',recordId:'2'.repeat(32),recordName:'home.example.com',recordType:'A' as const};
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>({...recordFor(input),content:'8.8.8.8'})),update:vi.fn()};
    const conflictRepository=repository();vi.mocked(conflictRepository.create).mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: clients.slug'));
    await expect(new AdminClientsUseCase(conflictRepository,dns).create(input)).rejects.toMatchObject({status:409});
    const failedRepository=repository();vi.mocked(failedRepository.create).mockRejectedValue(new Error('D1 unavailable'));
    await expect(new AdminClientsUseCase(failedRepository,dns).create(input)).rejects.toThrow('D1 unavailable');
  });

  it('rejects a Cloudflare record response that does not match the requested id and zone', async () => {
    const input={zoneId:'1'.repeat(32),zoneName:'example.com',recordId:'2'.repeat(32),recordName:'home.example.com',recordType:'A' as const};
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>({...recordFor(input),id:'different',zoneId:'different-zone',content:'8.8.8.8'})),update:vi.fn()};
    await expect(new AdminClientsUseCase(repository(),dns).validate(input)).rejects.toMatchObject({status:400});
  });

  it('keeps lastIp empty on creation while returning the live DNS content', async () => {
    const input={displayName:'Home',slug:'home-1',zoneId:'1'.repeat(32),zoneName:'example.com',recordId:'2'.repeat(32),recordName:'home.example.com',recordType:'A' as const};
    const repo=repository();vi.mocked(repo.create).mockResolvedValue({...client,lastIp:null});
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>({...recordFor(input),content:'8.8.8.8'})),update:vi.fn()};
    await expect(new AdminClientsUseCase(repo,dns).create(input)).resolves.toMatchObject({client:{lastIp:null,currentDnsIp:'8.8.8.8'}});
    expect(repo.create).toHaveBeenCalledWith(expect.not.objectContaining({initialIp:expect.anything()}));
  });

  it('returns live DNS content for the client list without substituting cached lastIp', async () => {
    const repo=repository();vi.mocked(repo.list).mockResolvedValue([client]);
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>({id:'record',zoneId:'zone',zoneName:'example.com',name:'home.example.com',type:'A' as const,content:'9.9.9.9',ttl:1})),update:vi.fn()};
    await expect(new AdminClientsUseCase(repo,dns).list()).resolves.toEqual([expect.objectContaining({lastIp:'1.1.1.1',currentDnsIp:'9.9.9.9'})]);
  });
});

function recordFor(input:{zoneId:string;zoneName:string;recordId:string;recordName:string;recordType:'A'|'AAAA'}) {
  return {id:input.recordId,zoneId:input.zoneId,zoneName:input.zoneName,name:input.recordName,type:input.recordType,ttl:1};
}

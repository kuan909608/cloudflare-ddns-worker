import { describe, expect, it, vi } from 'vitest';
import { AdminClientsUseCase } from '../src/application/admin-clients';
import type { Client } from '../src/domain/models';
import type { ClientRepository } from '../src/repositories/client-repository';
import type { DnsRecordGateway } from '../src/repositories/dns-record-gateway';

const zone = { id:'1'.repeat(32) };
const client: Client = {
  id:'client', displayName:'Home', slug:'home', enabled:true, zoneId:zone.id, zoneName:'example.com',
  recordId:'2'.repeat(32), recordName:'home.example.com', recordType:'A', tokenHash:'hash', tokenCreatedAt:'now',
  lastIp:'1.1.1.1', lastSourceIp:null, lastStatus:null, lastUpdatedAt:null, createdAt:'now', updatedAt:'now',
};
const input = { displayName:'Home', slug:'home-1', recordId:client.recordId, recordName:client.recordName, recordType:'A' as const };

function repository(): ClientRepository {
  return { list:vi.fn(), findById:vi.fn(async()=>client), findBySlug:vi.fn(), create:vi.fn(), update:vi.fn(), setEnabled:vi.fn(), rotateToken:vi.fn(), updateStatus:vi.fn(), remove:vi.fn(), addLog:vi.fn(), logs:vi.fn(), audit:vi.fn(), dashboard:vi.fn() };
}

function record(overrides = {}) {
  return { id:client.recordId, zoneId:zone.id, zoneName:'example.com', name:client.recordName, type:'A' as const, content:'8.8.8.8', ttl:1, ...overrides };
}

describe('admin client details', () => {
  it('returns the current Cloudflare DNS content independently of cached last IP', async () => {
    const dns: DnsRecordGateway = { getRecord:vi.fn(async()=>record()), update:vi.fn() };
    await expect(new AdminClientsUseCase(repository(), dns, zone).get('client')).resolves.toMatchObject({ lastIp:'1.1.1.1', currentDnsIp:'8.8.8.8' });
  });

  it('maps only unique constraints to conflict and preserves infrastructure failures', async () => {
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>record()),update:vi.fn()};
    const conflictRepository=repository();vi.mocked(conflictRepository.create).mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: clients.slug'));
    await expect(new AdminClientsUseCase(conflictRepository,dns,zone).create(input)).rejects.toMatchObject({status:409});
    const failedRepository=repository();vi.mocked(failedRepository.create).mockRejectedValue(new Error('D1 unavailable'));
    await expect(new AdminClientsUseCase(failedRepository,dns,zone).create(input)).rejects.toThrow('D1 unavailable');
  });

  it('rejects a Cloudflare record response outside the Worker fixed Zone', async () => {
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>record({zoneId:'different-zone'})),update:vi.fn()};
    await expect(new AdminClientsUseCase(repository(),dns,zone).validate(input)).rejects.toMatchObject({status:400});
  });

  it('injects the fixed Zone when creating a Client', async () => {
    const repo=repository();vi.mocked(repo.create).mockResolvedValue({...client,lastIp:null});
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>record()),update:vi.fn()};
    await expect(new AdminClientsUseCase(repo,dns,zone).create(input)).resolves.toMatchObject({client:{lastIp:null,currentDnsIp:'8.8.8.8'}});
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({zoneId:zone.id,zoneName:'example.com'}));
  });

  it('injects the fixed Zone when editing a Client', async () => {
    const repo=repository();vi.mocked(repo.update).mockResolvedValue(client);
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>record()),update:vi.fn()};
    await new AdminClientsUseCase(repo,dns,zone).update(client.id,input);
    expect(repo.update).toHaveBeenCalledWith(client.id,expect.objectContaining({zoneId:zone.id,zoneName:'example.com'}));
  });

  it('returns live DNS content for the client list without substituting cached lastIp', async () => {
    const repo=repository();vi.mocked(repo.list).mockResolvedValue([client]);
    const dns: DnsRecordGateway={getRecord:vi.fn(async()=>record({content:'9.9.9.9'})),update:vi.fn()};
    await expect(new AdminClientsUseCase(repo,dns,zone).list()).resolves.toEqual([expect.objectContaining({lastIp:'1.1.1.1',currentDnsIp:'9.9.9.9'})]);
  });
});

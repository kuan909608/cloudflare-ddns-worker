import {afterEach,beforeEach,describe,expect,it,vi} from'vitest';
import {DdnsUpdateUseCase} from'../src/application/ddns-update';import type{Client,UpdateLog}from'../src/domain/models';import type{ClientRepository}from'../src/repositories/client-repository';import type{DnsRecord,DnsRecordGateway}from'../src/repositories/dns-record-gateway';import{hashToken}from'../src/services/token-service';
const rawToken=`ddns_${'x'.repeat(32)}`;let client:Client;let logs:UpdateLog[];let status:unknown;
function repository():ClientRepository{return{list:vi.fn(),findById:vi.fn(async()=>client),findBySlug:vi.fn(async()=>client),create:vi.fn(),update:vi.fn(),claimRecordProvisioning:vi.fn(async()=>true),bindProvisionedRecord:vi.fn(async()=>client),releaseRecordProvisioning:vi.fn(),setEnabled:vi.fn(),rotateToken:vi.fn(),updateStatus:vi.fn(async(_id,value)=>{status=value;}),remove:vi.fn(),addLog:vi.fn(async log=>{logs.push(log);}),logs:vi.fn(),allLogs:vi.fn(),audit:vi.fn(),dashboard:vi.fn()};}
function dns(content='1.1.1.1'){const record:DnsRecord={id:'record',zoneId:'zone',zoneName:'example.com',name:'home.example.com',type:'A',content,ttl:1};return{getZone:vi.fn(async()=>({id:'zone',name:'example.com'})),getRecord:vi.fn(async()=>record),findRecords:vi.fn(async()=>[]),create:vi.fn(async(_zoneId,_zoneName,_name,_type,newContent)=>({...record,content:newContent})),update:vi.fn(async()=>undefined)} as DnsRecordGateway;}
const request=(token=rawToken,ip='8.8.8.8')=>new Request('https://ddns.example.com/api/ddns/home',{method:'POST',headers:{Authorization:`Bearer ${token}`,'CF-Connecting-IP':ip}});
beforeEach(async()=>{logs=[];status=null;client={id:'client',displayName:'Home',slug:'home',enabled:true,zoneId:'zone',zoneName:'example.com',recordId:'record',recordName:'home.example.com',recordType:'A',tokenHash:await hashToken(rawToken),tokenCreatedAt:'now',lastIp:null,lastSourceIp:null,lastStatus:null,lastUpdatedAt:null,createdAt:'now',updatedAt:'now'};});
afterEach(()=>vi.restoreAllMocks());
describe('DDNS update use case',()=>{
  it('updates only the bound record and applies the authenticated client limit',async()=>{const api=dns();const perClient=vi.fn(async()=>undefined);const result=await new DdnsUpdateUseCase(repository(),api,false,perClient).execute('home',request());expect(result.updated).toBe(true);expect(api.update).toHaveBeenCalledWith(expect.objectContaining({id:'record'}),'8.8.8.8');expect(perClient).toHaveBeenCalledWith('client');expect(logs[0]).toMatchObject({oldIp:'1.1.1.1',newIp:'8.8.8.8',updated:true,status:'updated'});expect(status).toMatchObject({sourceIp:'8.8.8.8'});});
  it('does not update an unchanged record',async()=>{const api=dns('8.8.8.8');expect((await new DdnsUpdateUseCase(repository(),api,false).execute('home',request())).updated).toBe(false);expect(api.update).not.toHaveBeenCalled();expect(logs[0]?.status).toBe('unchanged');});
  it('accepts a pre-parsed compatibility token without rewriting request headers',async()=>{const api=dns();const withoutAuthorization=new Request('https://ddns.example.com/api/ddns/home/unifi',{headers:{'CF-Connecting-IP':'8.8.8.8'}});const result=await new DdnsUpdateUseCase(repository(),api,false).executeWithToken('home',withoutAuthorization,rawToken);expect(result).toMatchObject({updated:true,ip:'8.8.8.8'});});
  it('rejects disabled clients and private source addresses',async()=>{client.enabled=false;await expect(new DdnsUpdateUseCase(repository(),dns(),false).execute('home',request())).rejects.toMatchObject({status:403});client.enabled=true;await expect(new DdnsUpdateUseCase(repository(),dns(),false).execute('home',request(rawToken,'10.0.0.1'))).rejects.toMatchObject({status:400});});
  it('fails closed if Cloudflare returns a different binding',async()=>{const api=dns();vi.mocked(api.getRecord).mockResolvedValue({...await api.getRecord('zone','example.com','record'),name:'other.example.com'});await expect(new DdnsUpdateUseCase(repository(),api,false).execute('home',request())).rejects.toMatchObject({status:502});expect(logs[0]).toMatchObject({status:'failed',errorCode:'DNS_RECORD_VALIDATE_FAILED'});});
  it('never patches a record when Cloudflare returns a different record id',async()=>{const api=dns();vi.mocked(api.getRecord).mockResolvedValue({...await api.getRecord('zone','example.com','record'),id:'different-record'});await expect(new DdnsUpdateUseCase(repository(),api,false).execute('home',request())).rejects.toMatchObject({status:502});expect(api.update).not.toHaveBeenCalled();});
  it('reports the actual DNS success when D1 state persistence fails afterward',async()=>{const repo=repository();vi.mocked(repo.updateStatus).mockRejectedValue(new Error('D1 unavailable'));const api=dns();await expect(new DdnsUpdateUseCase(repo,api,false).execute('home',request())).resolves.toMatchObject({updated:true});expect(api.update).toHaveBeenCalled();expect(logs).toEqual([expect.objectContaining({updated:true,status:'updated'})]);expect(logs).not.toContainEqual(expect.objectContaining({status:'failed'}));});
  it('creates and permanently binds a pending Record from the first authenticated source IP',async()=>{
    client={...client,recordId:null,lastIp:null};
    const repo=repository();
    vi.mocked(repo.bindProvisionedRecord).mockImplementation(async(_id,_claim,binding)=>{client={...client,recordId:binding.id,zoneName:binding.zoneName,recordName:binding.name,recordType:binding.type};return client;});
    const api=dns();
    await expect(new DdnsUpdateUseCase(repo,api,false).execute('home',request())).resolves.toMatchObject({updated:true,ip:'8.8.8.8'});
    expect(api.findRecords).toHaveBeenCalledWith('zone','example.com','home.example.com','A');
    expect(api.create).toHaveBeenCalledWith('zone','example.com','home.example.com','A','8.8.8.8');
    expect(repo.bindProvisionedRecord).toHaveBeenCalledWith('client',expect.any(String),expect.objectContaining({id:'record',name:'home.example.com'}));
    expect(api.update).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({oldIp:null,newIp:'8.8.8.8',updated:true,status:'updated'});
  });
  it('recovers an unbound Record left by an interrupted first update without creating a duplicate',async()=>{
    client={...client,recordId:null,lastIp:null};
    const repo=repository();
    vi.mocked(repo.bindProvisionedRecord).mockImplementation(async(_id,_claim,binding)=>{client={...client,recordId:binding.id};return client;});
    const api=dns('7.7.7.7');
    vi.mocked(api.findRecords).mockResolvedValue([await api.getRecord('zone','example.com','record')]);
    await new DdnsUpdateUseCase(repo,api,false).execute('home',request());
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({id:'record'}),'8.8.8.8');
  });
  it('does not race a second first-update request while another request owns provisioning',async()=>{
    client={...client,recordId:null,lastIp:null};
    const repo=repository();vi.mocked(repo.claimRecordProvisioning).mockResolvedValue(false);vi.mocked(repo.findById).mockResolvedValue(client);
    const api=dns();
    await expect(new DdnsUpdateUseCase(repo,api,false).execute('home',request())).rejects.toMatchObject({status:502});
    expect(api.create).not.toHaveBeenCalled();
  });
  it('logs the safe failure stage when pending Record creation fails',async()=>{
    client={...client,recordId:null,lastIp:null};
    const api=dns();vi.mocked(api.create).mockRejectedValue(new Error('provider secret detail'));
    const errorSpy=vi.spyOn(console,'error').mockImplementation(()=>undefined);
    await expect(new DdnsUpdateUseCase(repository(),api,false).execute('home',request())).rejects.toMatchObject({status:502});
    expect(errorSpy).toHaveBeenCalledWith({event:'ddns_update_failed',stage:'record_create',category:'DNS_PROVIDER_ERROR'});
    expect(logs[0]?.errorCode).toBe('DNS_RECORD_CREATE_FAILED');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('provider secret detail');
  });
});

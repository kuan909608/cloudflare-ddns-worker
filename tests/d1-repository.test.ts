import{describe,expect,it,vi}from'vitest';import{D1ClientRepository}from'../src/infrastructure/d1-client-repository';
const row={id:'id',display_name:'Home',slug:'home',enabled:1,zone_id:'zone',zone_name:'example.com',record_id:'record',record_name:'home.example.com',record_type:'A',token_hash:'hash',token_created_at:'now',last_ip:null,last_source_ip:null,last_status:null,last_updated_at:null,created_at:'now',updated_at:'now'};
describe('D1 repository',()=>{it('maps rows while binding untrusted slug as a parameter',async()=>{const first=vi.fn(async()=>row);const bind=vi.fn((_value:string)=>({first}));const prepare=vi.fn((_sql:string)=>({bind}));const result=await new D1ClientRepository({prepare}as unknown as D1Database).findBySlug("home' OR 1=1--");expect(bind).toHaveBeenCalledWith("home' OR 1=1--");expect(prepare.mock.calls[0]?.[0]).toBe('SELECT * FROM clients WHERE slug = ?');expect(result).toMatchObject({displayName:'Home',enabled:true,tokenHash:'hash'});});it('uses parameterized delete and reports changes',async()=>{const run=vi.fn(async()=>({meta:{changes:1}}));const bind=vi.fn((_value:string)=>({run}));const prepare=vi.fn((_sql:string)=>({bind}));expect(await new D1ClientRepository({prepare}as unknown as D1Database).remove('../path')).toBe(true);expect(bind).toHaveBeenCalledWith('../path');});});

describe('D1 repository operations',()=>{
  it('persists and maps the complete repository contract with bound parameters',async()=>{
    const logRow={id:'log',client_id:'id',source_ip:'8.8.8.8',old_ip:'1.1.1.1',new_ip:'8.8.8.8',updated:1,status:'updated',error_code:null,created_at:'now'};
    const statements:{sql:string;args:unknown[]}[]=[];
    const prepare=vi.fn((sql:string)=>{
      const statement={
        bind:(...args:unknown[])=>{statements.push({sql,args});return statement;},
        first:async()=>sql.includes('COUNT(*)')?{total:2,enabled:1,disabled:1,recentSuccess:3,recentFailure:1}:row,
        all:async()=>({results:sql.includes('update_logs')?[logRow]:[row]}),
        run:async()=>({meta:{changes:1}}),
      };
      return statement;
    });
    const repository=new D1ClientRepository({prepare}as unknown as D1Database);
    expect(await repository.list()).toHaveLength(1);
    expect(await repository.findById('id')).toMatchObject({id:'id'});
    expect(await repository.create({id:'id',displayName:'Home',slug:'home',enabled:true,zoneId:'zone',zoneName:'example.com',recordId:'record',recordName:'home.example.com',recordType:'A',tokenHash:'hash',now:'now'})).toMatchObject({slug:'home'});
    expect(await repository.update('id',{displayName:'New Home'})).toMatchObject({id:'id'});
    expect(await repository.setEnabled('id',false)).toMatchObject({id:'id'});
    expect(await repository.rotateToken('id','new-hash','later')).toMatchObject({id:'id'});
    await repository.updateStatus('id',{ip:'8.8.8.8',sourceIp:'8.8.8.8',status:'updated',updatedAt:'later'});
    await repository.addLog({id:'log',clientId:'id',sourceIp:'8.8.8.8',oldIp:'1.1.1.1',newIp:'8.8.8.8',updated:true,status:'updated',errorCode:null,createdAt:'now'});
    expect(await repository.logs('id',50,0)).toEqual([expect.objectContaining({clientId:'id',updated:true})]);
    await repository.audit('admin@example.com','client.update','id','success');
    expect(await repository.dashboard()).toEqual({total:2,enabled:1,disabled:1,recentSuccess:3,recentFailure:1});
    expect(statements.every(({sql,args})=>!sql.includes('admin@example.com')&&!sql.includes('8.8.8.8')||args.length>0)).toBe(true);
  });

  it('returns null when an update target no longer exists',async()=>{
    const first=vi.fn(async()=>null);const bind=vi.fn(()=>({first}));const prepare=vi.fn(()=>({bind}));
    await expect(new D1ClientRepository({prepare}as unknown as D1Database).update('missing',{displayName:'x'})).resolves.toBeNull();
  });

  it('computes recent dashboard results from update log events',async()=>{
    const first=vi.fn(async()=>({total:0,enabled:0,disabled:0,recentSuccess:0,recentFailure:0}));const prepare=vi.fn((_sql:string)=>({first}));
    await new D1ClientRepository({prepare}as unknown as D1Database).dashboard();
    expect(prepare.mock.calls[0]?.[0]).toContain('FROM update_logs');
    expect(prepare.mock.calls[0]?.[0]).toContain("-24 hours");
  });
});

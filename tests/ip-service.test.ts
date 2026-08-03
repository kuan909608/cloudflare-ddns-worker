import { describe, expect, it } from 'vitest';
import { ipVersion, isAllowedIp, rateLimitSource, sourceIp } from '../src/services/ip-service';

describe('source IP validation',()=>{
  it.each([['1.1.1.1',4],['2606:4700:4700::1111',6],['bad',null],['999.1.1.1',null],['2001:::1',null]] as const)('detects %s', (input,version)=>expect(ipVersion(input)).toBe(version));
  it.each(['10.0.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.168.1.1','224.1.1.1','0.0.0.0','192.0.2.1','198.51.100.1','203.0.113.1'])('rejects non-public IPv4 %s',(ip)=>expect(isAllowedIp(ip,'A')).toBe(false));
  it.each(['::','::1','fe80::1','fc00::1','ff02::1','100::1','fec0::1','2001:2::1','2001:20::1','2001:db8::1'])('rejects non-public IPv6 %s',(ip)=>expect(isAllowedIp(ip,'AAAA')).toBe(false));
  it('enforces record family and optional private mode',()=>{expect(isAllowedIp('8.8.8.8','A')).toBe(true);expect(isAllowedIp('8.8.8.8','AAAA')).toBe(false);expect(isAllowedIp('2001:4860:4860::8888','AAAA')).toBe(true);expect(isAllowedIp('10.0.0.1','A',true)).toBe(true);});
  it.each([
    ['127.0.0.1','A'],['169.254.1.1','A'],['224.0.0.1','A'],['0.0.0.0','A'],
    ['::','AAAA'],['::1','AAAA'],['fe80::1','AAAA'],['ff02::1','AAAA'],
    ['::ffff:127.0.0.1','AAAA'],['::ffff:10.0.0.1','AAAA'],
  ] as const)('never allows unsafe address %s when private mode is enabled',(ip,type)=>expect(isAllowedIp(ip,type,true)).toBe(false));
  it('allows only private address classes in private mode',()=>{expect(isAllowedIp('192.168.1.10','A',true)).toBe(true);expect(isAllowedIp('172.20.1.10','A',true)).toBe(true);expect(isAllowedIp('fd00::10','AAAA',true)).toBe(true);});
  it('uses CF-Connecting-IP first then the first valid XFF address',()=>{let request=new Request('https://x',{headers:{'CF-Connecting-IP':'1.1.1.1','X-Forwarded-For':'8.8.8.8, 9.9.9.9'}});expect(sourceIp(request,'A')).toBe('1.1.1.1');request=new Request('https://x',{headers:{'CF-Connecting-IP':'invalid','X-Forwarded-For':'10.0.0.1, 8.8.4.4'}});expect(sourceIp(request,'A')).toBe('8.8.4.4');});
  it('fails closed instead of trusting XFF when Cloudflare supplied a different address family',()=>{const request=new Request('https://x',{headers:{'CF-Connecting-IP':'2606:4700:4700::1111','X-Forwarded-For':'8.8.8.8'}});expect(sourceIp(request,'A')).toBeNull();});
  it('never reads body or query IP',()=>{const request=new Request('https://x?ip=1.1.1.1',{method:'POST',body:'{"ip":"1.1.1.1"}'});expect(sourceIp(request,'A')).toBeNull();});
  it('uses only Cloudflare connecting IP for the pre-auth rate key',()=>{expect(rateLimitSource(new Request('https://x',{headers:{'CF-Connecting-IP':'8.8.8.8','X-Forwarded-For':'9.9.9.9'}}))).toBe('8.8.8.8');expect(rateLimitSource(new Request('https://x',{headers:{'X-Forwarded-For':'9.9.9.9'}}))).toBe('unknown');});
});

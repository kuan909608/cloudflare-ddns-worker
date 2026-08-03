import { describe, expect, it } from 'vitest';
import { ipVersion, isAllowedIp, sourceIp } from '../src/services/ip-service';

describe('source IP validation',()=>{
  it.each([['1.1.1.1',4],['2606:4700:4700::1111',6],['bad',null],['999.1.1.1',null],['2001:::1',null]] as const)('detects %s', (input,version)=>expect(ipVersion(input)).toBe(version));
  it.each(['10.0.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.168.1.1','224.1.1.1','0.0.0.0','192.0.2.1','198.51.100.1','203.0.113.1'])('rejects non-public IPv4 %s',(ip)=>expect(isAllowedIp(ip,'A')).toBe(false));
  it.each(['::','::1','fe80::1','fc00::1','ff02::1','2001:db8::1'])('rejects non-public IPv6 %s',(ip)=>expect(isAllowedIp(ip,'AAAA')).toBe(false));
  it('enforces record family and optional private mode',()=>{expect(isAllowedIp('8.8.8.8','A')).toBe(true);expect(isAllowedIp('8.8.8.8','AAAA')).toBe(false);expect(isAllowedIp('2001:4860:4860::8888','AAAA')).toBe(true);expect(isAllowedIp('10.0.0.1','A',true)).toBe(true);});
  it('uses CF-Connecting-IP first then the first valid XFF address',()=>{let request=new Request('https://x',{headers:{'CF-Connecting-IP':'1.1.1.1','X-Forwarded-For':'8.8.8.8, 9.9.9.9'}});expect(sourceIp(request,'A')).toBe('1.1.1.1');request=new Request('https://x',{headers:{'CF-Connecting-IP':'invalid','X-Forwarded-For':'10.0.0.1, 8.8.4.4'}});expect(sourceIp(request,'A')).toBe('8.8.4.4');});
  it('never reads body or query IP',()=>{const request=new Request('https://x?ip=1.1.1.1',{method:'POST',body:'{"ip":"1.1.1.1"}'});expect(sourceIp(request,'A')).toBeNull();});
});

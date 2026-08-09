export interface Client {
  id:string; displayName:string; slug:string; enabled:boolean; zoneId:string; zoneName:string; recordId:string; recordName:string;
  recordType:'A'|'AAAA'; tokenCreatedAt:string; tokenConfigured:true; currentDnsIp:string|null; lastIp:string|null; lastSourceIp:string|null; lastStatus:string|null;
  lastUpdatedAt:string|null; createdAt:string; updatedAt:string;
}
export interface ClientInput { displayName:string; slug:string; recordId:string; recordName:string; recordType:'A'|'AAAA'; }
export interface CloudflareRecordOption { id:string; name:string; type:'A'|'AAAA'; content:string; }
export interface UpdateLog { id:string; sourceIp:string; oldIp:string|null; newIp:string; updated:boolean; status:string; errorCode:string|null; createdAt:string; }
export interface AdminConfig { ddnsOrigin:string; dnsZoneId:string; unifiCompatibilityEnabled:boolean; }

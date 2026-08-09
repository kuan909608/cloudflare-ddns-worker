export interface Client {
  id:string; displayName:string; slug:string; enabled:boolean; zoneId:string; zoneName:string; recordId:string|null; recordName:string;
  recordType:'A'|'AAAA'; recordPending:boolean; tokenCreatedAt:string; tokenConfigured:true; currentDnsIp:string|null; lastIp:string|null; lastSourceIp:string|null; lastStatus:string|null;
  lastUpdatedAt:string|null; createdAt:string; updatedAt:string;
}
export type ClientInput =
  | { displayName:string; slug:string; bindingMode:'existing'; recordId:string }
  | { displayName:string; slug:string; bindingMode:'new'; hostname:string; recordType:'A'|'AAAA' };
export interface CloudflareRecordOption { id:string; name:string; type:'A'|'AAAA'; content:string; }
export interface UpdateLog { id:string; sourceIp:string; oldIp:string|null; newIp:string; updated:boolean; status:string; errorCode:string|null; createdAt:string; }
export interface AdminUpdateLog extends UpdateLog { clientId:string; clientDisplayName:string; clientSlug:string; }
export interface AdminConfig { ddnsOrigin:string; dnsZoneId:string; dnsZoneName:string; unifiCompatibilityEnabled:boolean; }

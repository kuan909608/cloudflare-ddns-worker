import type { AdminConfig, Client, ClientInput, UpdateLog } from '../types';
interface Envelope<T> { success:boolean; data:T; message?:string }
async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const response = await fetch(path, { credentials:'same-origin', ...init, headers:{ Accept:'application/json', ...init.headers } });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || !body.success) throw new Error(body.message ?? 'Request failed');
  return body.data;
}
const json = (value:unknown):RequestInit => ({ headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(value) });
export const adminApi = {
  config:()=>api<AdminConfig>('/api/admin/config'),
  dashboard:()=>api<Record<string,number>>('/api/admin/dashboard'),
  clients:()=>api<Client[]>('/api/admin/clients'),
  client:(id:string)=>api<Client>(`/api/admin/clients/${encodeURIComponent(id)}`),
  create:(input:ClientInput)=>api<{client:Client;token:string}>('/api/admin/clients',{method:'POST',...json(input)}),
  update:(id:string,input:ClientInput)=>api<Client>(`/api/admin/clients/${encodeURIComponent(id)}`,{method:'PUT',...json(input)}),
  remove:(id:string)=>api<{deleted:boolean}>(`/api/admin/clients/${encodeURIComponent(id)}`,{method:'DELETE',...json({})}),
  action:(id:string,action:'enable'|'disable')=>api<Client>(`/api/admin/clients/${encodeURIComponent(id)}/${action}`,{method:'POST',...json({})}),
  rotate:(id:string)=>api<{client:Client;token:string}>(`/api/admin/clients/${encodeURIComponent(id)}/rotate-token`,{method:'POST',...json({})}),
  logs:(id:string)=>api<UpdateLog[]>(`/api/admin/clients/${encodeURIComponent(id)}/logs`),
};

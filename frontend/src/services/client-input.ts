import type { Client, ClientInput } from '../types';

export function toClientInput(client: Client): ClientInput {
  if (client.recordId) return { displayName:client.displayName, slug:client.slug, bindingMode:'existing', recordId:client.recordId };
  const suffix = `.${client.zoneName}`;
  const hostname = client.recordName.endsWith(suffix) ? client.recordName.slice(0, -suffix.length) : client.recordName;
  return { displayName:client.displayName, slug:client.slug, bindingMode:'new', hostname, recordType:client.recordType };
}

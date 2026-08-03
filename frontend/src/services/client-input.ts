import type { Client, ClientInput } from '../types';

export function toClientInput(client: Client): ClientInput {
  return {
    displayName: client.displayName,
    slug: client.slug,
    zoneId: client.zoneId,
    zoneName: client.zoneName,
    recordId: client.recordId,
    recordName: client.recordName,
    recordType: client.recordType,
  };
}

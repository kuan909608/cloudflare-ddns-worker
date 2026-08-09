import type { Client, ClientInput } from '../types';

export function toClientInput(client: Client): ClientInput {
  return {
    displayName: client.displayName,
    slug: client.slug,
    recordId: client.recordId,
    recordName: client.recordName,
    recordType: client.recordType,
  };
}

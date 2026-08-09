import { describe, expect, it } from 'vitest';
import { toClientInput } from '../frontend/src/services/client-input';
import type { Client } from '../frontend/src/types';

describe('client edit payload', () => {
  it('contains only fields accepted by the admin API', () => {
    const client: Client = {
      id: 'client-id', displayName: 'Home', slug: 'home-1', enabled: true,
      zoneId: '1'.repeat(32), zoneName: 'example.com', recordId: '2'.repeat(32),
      recordName: 'home.example.com', recordType: 'A', tokenCreatedAt: 'now',
      tokenConfigured: true, currentDnsIp: '1.1.1.1', lastIp: '1.1.1.1', lastSourceIp: '1.1.1.1',
      lastStatus: 'updated', lastUpdatedAt: 'now', createdAt: 'now', updatedAt: 'now',
    };

    expect(toClientInput(client)).toEqual({
      displayName: 'Home', slug: 'home-1',
      recordId: '2'.repeat(32), recordName: 'home.example.com', recordType: 'A',
    });
  });
});

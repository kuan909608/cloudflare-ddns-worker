import { describe, expect, it } from 'vitest';
import { curlCommand, ddnsUpdateUrl, unifiSettings } from '../frontend/src/services/connection-details';

describe('connection details', () => {
  it('uses the runtime DDNS origin for every copied setting', () => {
    const origin = 'https://ddns-staging.kthome.net';
    expect(ddnsUpdateUrl(origin, 'linhome')).toBe('https://ddns-staging.kthome.net/api/ddns/linhome');
    expect(curlCommand(origin, 'linhome', '<CLIENT_TOKEN>')).toContain('https://ddns-staging.kthome.net/api/ddns/linhome');
    expect(unifiSettings(origin, 'linhome', 'linhome.kthome.net', '<CLIENT_TOKEN>')).toContain('伺服器: ddns-staging.kthome.net/api/compat/unifi/linhome?hostname=');
  });
});

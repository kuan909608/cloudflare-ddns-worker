import { describe, expect, it } from 'vitest';
import { toClientInput } from '../frontend/src/services/client-input';
import type { Client } from '../frontend/src/types';

const base: Omit<Client,'recordId'|'recordName'|'recordType'|'recordPending'> = {
  id:'client-id', displayName:'Home', slug:'home-1', enabled:true, zoneId:'1'.repeat(32), zoneName:'example.com',
  tokenCreatedAt:'now', tokenConfigured:true, currentDnsIp:'1.1.1.1', lastIp:'1.1.1.1', lastSourceIp:'1.1.1.1',
  lastStatus:'updated', lastUpdatedAt:'now', createdAt:'now', updatedAt:'now',
};

describe('client edit payload', () => {
  it('sends only the existing Record ID back to the API', () => {
    const client: Client = {...base,recordId:'2'.repeat(32),recordName:'home.example.com',recordType:'A',recordPending:false};
    expect(toClientInput(client)).toEqual({displayName:'Home',slug:'home-1',bindingMode:'existing',recordId:'2'.repeat(32)});
  });

  it('maps a pending binding back to its fixed-Zone hostname label', () => {
    const client: Client = {...base,displayName:'Cabin',slug:'cabin-1',recordId:null,recordName:'cabin.example.com',recordType:'AAAA',recordPending:true,currentDnsIp:null,lastIp:null};
    expect(toClientInput(client)).toEqual({displayName:'Cabin',slug:'cabin-1',bindingMode:'new',hostname:'cabin',recordType:'AAAA'});
  });
});

export type RecordType = 'A' | 'AAAA';

export interface Client {
  id: string;
  displayName: string;
  slug: string;
  enabled: boolean;
  zoneId: string;
  zoneName: string;
  recordId: string | null;
  recordName: string;
  recordType: RecordType;
  tokenHash: string;
  tokenCreatedAt: string;
  lastIp: string | null;
  lastSourceIp: string | null;
  lastStatus: string | null;
  lastUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicClient extends Omit<Client, 'tokenHash'> {
  currentDnsIp: string | null;
  recordPending: boolean;
  tokenConfigured: true;
}

export interface UpdateLog {
  id: string;
  clientId: string;
  sourceIp: string;
  oldIp: string | null;
  newIp: string;
  updated: boolean;
  status: string;
  errorCode: string | null;
  createdAt: string;
}

export interface AccessIdentity {
  email: string;
  subject: string;
}

export type Timezone = {
  id: string;
  abbr: string;
  utc: string;
  offset: number | null;
};

export type IPInfo = {
  ip: string;
  type: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  continent?: string;
  postal: string;
  latitude: number | null;
  longitude: number | null;
  timezone: Timezone;
  flag: string | null;
  isp: string;
  org: string;
  asn: string;
  domain: string;
  source: string;
  resolvedFrom?: string | null;
  resolvedRecord?: string | null;
  cached?: boolean;
};

export type MyIP = IPInfo & {
  primary: string;
  ipv4: string | null;
  ipv6: string | null;
};

export type DnsAnswer = {
  name: string;
  type: number;
  typeName: string;
  ttl: number | null;
  data: string;
};

export type DnsResult = {
  name: string;
  type: string;
  resolver: string;
  resolverId: string;
  status: number;
  statusText: string;
  truncated: boolean;
  answers: DnsAnswer[];
  authority: DnsAnswer[];
  elapsedMs: number;
};

export type RdapResult = {
  kind: 'domain' | 'ip';
  value: string;
  elapsedMs: number;
  handle: string;
  name: string;
  statuses: string[];
  events: Record<string, string>;
  registrar: string;
  registrarUrl: string;
  abuseEmail: string;
  nameservers: string[];
  dnssec: string | null;
  startAddress: string;
  endAddress: string;
  country: string;
  type: string;
  ipVersion: string;
  range: string;
  selfLink: string;
};

export type LatencySample = {
  host: string;
  label: string;
  ms: number | null;
};

export type HistoryEntry = {
  target: string;
  kind: 'ip' | 'domain';
  ip: string;
  country: string;
  countryCode?: string;
  city: string;
  at: number;
};

export type DnsHistoryEntry = {
  name: string;
  type: string;
  at: number;
};

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type AuditCheck = {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  weight: number;
};

export type HeaderAudit = {
  checks: AuditCheck[];
  passed: number;
  total: number;
  score: number;
  grade: string;
  observations: { tone: 'info' | 'warn'; text: string }[];
};

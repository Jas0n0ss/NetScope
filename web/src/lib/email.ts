/**
 * Email authentication audit — SPF, DKIM, DMARC, MTA-STS, TLS-RPT, BIMI.
 */

import { dohQuery, ApiError } from './net';
import type { DnsResult } from './types';

export type EmailStatus = 'pass' | 'warn' | 'fail';

export type EmailCheck = {
  id: string;
  name: string;
  status: EmailStatus;
  weight: number;
  earned: number;
  detail: string;
  records: string[];
  query: { name: string; type: string } | null;
};

export type EmailReport = {
  domain: string;
  selector: string;
  score: number;
  grade: string;
  checks: EmailCheck[];
  results: { label: string; result: DnsResult }[];
  elapsedMs: number;
  mx: string[];
  hasMx: boolean;
};

const txtValue = (data: unknown): string =>
  String(data ?? '')
    .replace(/"\s+"/g, '')
    .replace(/^"|"$/g, '')
    .replace(/\\"/g, '"');

const txts = (result?: DnsResult): string[] =>
  (result?.answers || []).filter((a) => a.typeName === 'TXT').map((a) => txtValue(a.data));

const findTxt = (result: DnsResult | undefined, prefix: string): string =>
  txts(result).find((text) => text.toLowerCase().startsWith(prefix.toLowerCase())) || '';

const gradeFor = (score: number): string => (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F');

export async function auditEmail(domain: string, selector = 'default'): Promise<EmailReport> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!clean || !clean.includes('.')) throw new ApiError('Enter a domain, for example example.com.', 'invalid_input');

  const safeSelector = selector.trim() || 'default';
  const started = performance.now();

  const [mx, spfRaw, dkimRaw, dmarcRaw, mtaStsRaw, tlsRptRaw, bimiRaw] = await Promise.all([
    dohQuery(clean, 'MX').catch(() => null),
    dohQuery(clean, 'TXT').catch(() => null),
    dohQuery(`${safeSelector}._domainkey.${clean}`, 'TXT').catch(() => null),
    dohQuery(`_dmarc.${clean}`, 'TXT').catch(() => null),
    dohQuery(`_mta-sts.${clean}`, 'TXT').catch(() => null),
    dohQuery(`_smtp._tls.${clean}`, 'TXT').catch(() => null),
    dohQuery(`default._bimi.${clean}`, 'TXT').catch(() => null),
  ]);

  const elapsedMs = Math.round(performance.now() - started);

  const results: { label: string; result: DnsResult }[] = [];
  if (mx) results.push({ label: `${clean} MX`, result: mx });
  if (spfRaw) results.push({ label: `${clean} TXT`, result: spfRaw });
  if (dkimRaw) results.push({ label: `${safeSelector}._domainkey.${clean} TXT`, result: dkimRaw });
  if (dmarcRaw) results.push({ label: `_dmarc.${clean} TXT`, result: dmarcRaw });
  if (mtaStsRaw) results.push({ label: `_mta-sts.${clean} TXT`, result: mtaStsRaw });
  if (tlsRptRaw) results.push({ label: `_smtp._tls.${clean} TXT`, result: tlsRptRaw });
  if (bimiRaw) results.push({ label: `default._bimi.${clean} TXT`, result: bimiRaw });

  const mxRecords = (mx?.answers || []).map((a) => a.data.replace(/^\d+\s+/, ''));
  const spfRecords = txts(spfRaw ?? undefined).filter((text) => /^v=spf1/i.test(text));
  const spf = spfRecords[0] || '';
  const dkim = findTxt(dkimRaw ?? undefined, 'v=DKIM1').length ? findTxt(dkimRaw ?? undefined, 'v=DKIM1') : (txts(dkimRaw ?? undefined).find((t) => /p=/.test(t)) || '');
  const dmarc = findTxt(dmarcRaw ?? undefined, 'v=DMARC1');
  const mtaSts = findTxt(mtaStsRaw ?? undefined, 'v=STSv1');
  const tlsRpt = findTxt(tlsRptRaw ?? undefined, 'v=TLSRPTv1');
  const bimi = findTxt(bimiRaw ?? undefined, 'v=BIMI1');

  const dmarcPolicy = (dmarc.match(/p=([a-z]+)/i)?.[1] || '').toLowerCase();

  const checks: EmailCheck[] = [
    {
      id: 'spf',
      name: 'SPF',
      weight: 25,
      earned: spf ? (spfRecords.length > 1 ? 15 : 25) : 0,
      status: spf ? (spfRecords.length > 1 ? 'warn' : 'pass') : 'fail',
      detail: spf
        ? spfRecords.length > 1
          ? `Multiple SPF records (${spfRecords.length}) — receivers may ignore all of them.`
          : 'Authorizes the sending infrastructure for this domain.'
        : 'Missing — anyone can claim to send mail as this domain.',
      records: spfRecords,
      query: { name: clean, type: 'TXT' },
    },
    {
      id: 'dkim',
      name: 'DKIM',
      weight: 25,
      earned: dkim ? 25 : 0,
      status: dkim ? 'pass' : 'fail',
      detail: dkim
        ? `Key published at ${safeSelector}._domainkey.`
        : `No key at ${safeSelector}._domainkey — messages cannot be cryptographically verified.`,
      records: dkim ? [dkim] : [],
      query: { name: `${safeSelector}._domainkey.${clean}`, type: 'TXT' },
    },
    {
      id: 'dmarc',
      name: 'DMARC',
      weight: 25,
      earned: dmarc ? (dmarcPolicy === 'reject' ? 25 : dmarcPolicy === 'quarantine' ? 20 : 10) : 0,
      status: dmarc ? (dmarcPolicy === 'reject' ? 'pass' : 'warn') : 'fail',
      detail: dmarc
        ? `Policy p=${dmarcPolicy || 'none'}${dmarcPolicy === 'none' ? ' — reports only, no enforcement.' : ' — spoofed mail is handled.'}`
        : 'Missing — no policy tells receivers how to handle failures.',
      records: dmarc ? [dmarc] : [],
      query: { name: `_dmarc.${clean}`, type: 'TXT' },
    },
    {
      id: 'mta-sts',
      name: 'MTA-STS',
      weight: 10,
      earned: mtaSts ? 10 : 0,
      status: mtaSts ? 'pass' : 'warn',
      detail: mtaSts ? 'Advertises an SMTP MTA Strict Transport Security policy.' : 'Not published — inbound TLS cannot be enforced by senders.',
      records: mtaSts ? [mtaSts] : [],
      query: { name: `_mta-sts.${clean}`, type: 'TXT' },
    },
    {
      id: 'tls-rpt',
      name: 'TLS-RPT',
      weight: 10,
      earned: tlsRpt ? 10 : 0,
      status: tlsRpt ? 'pass' : 'warn',
      detail: tlsRpt ? 'TLS failure reports are requested.' : 'Not published — TLS failures go unreported.',
      records: tlsRpt ? [tlsRpt] : [],
      query: { name: `_smtp._tls.${clean}`, type: 'TXT' },
    },
    {
      id: 'bimi',
      name: 'BIMI',
      weight: 5,
      earned: bimi ? 5 : 0,
      status: bimi ? 'pass' : 'warn',
      detail: bimi ? 'A brand indicator is published for supporting mailbox providers.' : 'Optional — no brand logo in supporting clients.',
      records: bimi ? [bimi] : [],
      query: { name: `default._bimi.${clean}`, type: 'TXT' },
    },
  ];

  const score = checks.reduce((sum, check) => sum + check.earned, 0);

  return {
    domain: clean,
    selector: safeSelector,
    score,
    grade: gradeFor(score),
    checks,
    results,
    elapsedMs,
    mx: mxRecords,
    hasMx: mxRecords.length > 0,
  };
}

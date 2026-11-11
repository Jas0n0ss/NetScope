/** `/api/dns` handler backed by DoH JSON, mirroring `dns_lookup` in Flask. */

import { ApiError } from './errors';
import { dohQuery, statusText, typeName } from './doh';
import { reversePointer } from './ip';
import { errorMessage, isTimeoutError } from './util';

const DNS_TYPES = ['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT'];
const TYPE_NUMBERS: Record<string, number> = {
  A: 1,
  AAAA: 28,
  CAA: 257,
  CNAME: 5,
  MX: 15,
  NS: 2,
  PTR: 12,
  SOA: 6,
  SRV: 33,
  TXT: 16,
};

function cleanDnsName(value: string): string {
  const name = value.trim().replace(/\.+$/, '');
  if (!name || name.length > 253) {
    throw new ApiError('invalid_name', 'Enter a valid domain name.');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new ApiError('invalid_name', 'The domain contains unsupported characters.');
  }
  return name;
}

/** DoH returns TXT strings quoted; Flask's dnspython path joins them. */
function txtValue(data: string): string {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!parts || parts.length === 0) return data;
  return parts
    .map((part) => part.slice(1, -1).replace(/\\(.)/g, '$1'))
    .join('');
}

export async function dnsLookup(rawName: string, rawType: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const qtype = rawType.toUpperCase();
  if (!DNS_TYPES.includes(qtype)) {
    throw new ApiError('invalid_type', `Unsupported record type. Use one of: ${DNS_TYPES.join(', ')}.`);
  }

  let name = rawName.trim();
  if (!name) throw new ApiError('invalid_name', 'Enter a domain name or IP address.');
  if (qtype === 'PTR') {
    name = reversePointer(name) ?? name.replace(/\.+$/, '');
  }
  name = cleanDnsName(name);

  const started = Date.now();
  let response;
  try {
    response = await dohQuery(name, qtype, timeoutMs);
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ApiError('dns_timeout', 'The DNS query timed out.', 504);
    }
    const reason = errorMessage(error).trim().replace(/\.+$/, '');
    throw new ApiError('dns_error', `DNS lookup failed: ${reason}.`, 502);
  }

  const wanted = TYPE_NUMBERS[qtype];
  const answers = response.answer
    .filter((record) => record.type === wanted)
    .map((record) => ({
      name: record.name,
      type: qtype,
      ttl: record.ttl,
      data: qtype === 'TXT' ? txtValue(record.data) : record.data,
    }));

  const authority = response.authority.map((record) => ({
    name: record.name,
    type: typeName(record.type),
    ttl: record.ttl,
    data: record.data,
  }));

  return {
    ok: true,
    name,
    type: qtype,
    status: response.status,
    status_text: statusText(response.status),
    answers,
    authority,
    elapsed_ms: Date.now() - started,
  };
}

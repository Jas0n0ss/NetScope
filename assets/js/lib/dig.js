/**
 * dig-style transcript for DNS-over-HTTPS responses.
 */

const TYPE_NAMES = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 39: 'DNAME', 43: 'DS', 46: 'RRSIG',
  48: 'DNSKEY', 64: 'SVCB', 65: 'HTTPS', 255: 'ANY', 257: 'CAA',
};

function withDot(name) {
  const value = String(name || '');
  if (!value || value === '.') return value;
  return value.endsWith('.') ? value : `${value}.`;
}

function formatRecord(record) {
  const type = record.typeName || TYPE_NAMES[record.type] || String(record.type);
  const ttl = record.ttl ?? 0;
  return `${withDot(record.name)}\t${ttl}\tIN\t${type}\t${record.data}`;
}

export function formatDig(result, { name, type } = {}) {
  if (!result) {
    return `; <<>> NetScope DIG <<>> ${name || ''} ${type || ''}\n;; status: NO RESPONSE\n`;
  }
  const queryName = name || result.name || '';
  const queryType = type || result.type || 'A';
  const answers = result.answers || [];
  const authority = result.authority || [];
  const status = result.statusText || 'NOERROR';
  const lines = [
    `; <<>> NetScope DIG <<>> ${queryName} ${queryType}`,
    `;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: 0`,
    `;; flags: qr rd ra; QUERY: 1, ANSWER: ${answers.length}, AUTHORITY: ${authority.length}, ADDITIONAL: 0`,
    '',
    ';; QUESTION SECTION:',
    `;${withDot(queryName)}\t\tIN\t${queryType}`,
    '',
  ];

  if (answers.length) {
    lines.push(';; ANSWER SECTION:');
    answers.forEach((answer) => lines.push(formatRecord(answer)));
    lines.push('');
  }

  if (authority.length) {
    lines.push(';; AUTHORITY SECTION:');
    authority.forEach((entry) => lines.push(formatRecord(entry)));
    lines.push('');
  }

  lines.push(
    `;; Query time: ${result.elapsedMs ?? 0} msec`,
    `;; SERVER: ${result.resolver || 'DNS-over-HTTPS'} (DoH)`,
    `;; WHEN: ${new Date().toUTCString()}`,
    ';; MSG SIZE  rcvd: —',
  );
  return lines.join('\n');
}

export function combineDigs(entries) {
  return entries.filter(Boolean).join('\n\n');
}

import type { DnsResult } from './types';

const pad = (value: string, width: number) => value.padEnd(width, ' ');

export function formatDig(result: DnsResult, now = new Date()): string {
  const header = [
    `; <<>> NetScope DiG 2.0 <<>> ${result.name} ${result.type}`,
    `;; Query time: ${result.elapsedMs} ms`,
    `;; SERVER: ${result.resolver} (DoH)`,
    `;; WHEN: ${now.toUTCString()}`,
    `;; MSG SIZE  rcvd: ${result.answers.length + result.authority.length} records`,
    '',
    `;; ->>HEADER<<- opcode: QUERY, status: ${result.statusText}, id: ${Math.floor(Math.random() * 65535)}`,
    `;; flags: qr rd ra${result.truncated ? ' tc' : ''}; QUERY: 1, ANSWER: ${result.answers.length}, AUTHORITY: ${result.authority.length}`,
  ];

  const sections: string[] = [];
  sections.push([';; QUESTION SECTION:', `;${result.name}.`.padEnd(28) + `IN\t${result.type}`].join('\n'));

  if (result.answers.length) {
    sections.push(
      [';; ANSWER SECTION:', ...result.answers.map((a) => `${a.name}.`.padEnd(30) + `${a.ttl ?? '-'}\t${a.typeName}\t${a.data}`)].join('\n'),
    );
  }

  if (result.authority.length) {
    sections.push(
      [
        ';; AUTHORITY SECTION:',
        ...result.authority.map((a) => `${a.name}.`.padEnd(30) + `${a.ttl ?? '-'}\t${a.typeName}\t${a.data}`),
      ].join('\n'),
    );
  }

  if (!result.answers.length && !result.authority.length) {
    sections.push(';; no records returned');
  }

  return `${header.join('\n')}\n\n${sections.join('\n\n')}`;
}

export function combinedDig(results: { label: string; result: DnsResult }[], now = new Date()): string {
  return results
    .map(({ label, result }) => `;; ${label}\n${formatDig(result, now)}`)
    .join('\n\n;; ------------------------------------------------------------\n\n');
}

export { pad };

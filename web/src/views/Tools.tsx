import { useMemo, useState } from 'react';
import {
  Activity,
  Binary,
  Calculator,
  Copy,
  Link2,
  Network,
  Plug,
  Radar,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Badge, Busy, CopyButton, EmptyState, ErrorState, KVGrid, Panel, SectionTitle } from '../components/ui';
import { toast } from '../components/toast';
import { ipConvert, parseUrlInfo, subnetInfo, isIP, isIPv4 } from '../lib/tools';
import { checkPort } from '../lib/net';
import { cn, copyText, fmtMs } from '../lib/format';
import { useT, toolNote } from '../lib/i18n';

type ToolId = 'subnet' | 'convert' | 'url' | 'latency' | 'webrtc' | 'port';

const TOOLS: { id: ToolId; label: string; hint: string; icon: any }[] = [
  { id: 'subnet', label: 'Subnet', hint: 'CIDR math', icon: Calculator },
  { id: 'convert', label: 'Convert', hint: 'IPv4 / IPv6', icon: Binary },
  { id: 'url', label: 'URL anatomy', hint: 'parse & flags', icon: Link2 },
  { id: 'latency', label: 'Latency', hint: 'origin probe', icon: Activity },
  { id: 'webrtc', label: 'WebRTC', hint: 'ICE leak check', icon: Radar },
  { id: 'port', label: 'Port check', hint: 'needs api', icon: Plug },
];

function BitRuler({ version, prefix, hostBits }: { version: 4 | 6; prefix: number; hostBits: number }) {
  const total = version === 4 ? 32 : 128;
  const bits = Array.from({ length: total }, (_, index) => index < total - hostBits);
  const singleRow = version === 4;
  return (
    <div className={cn('flex gap-[2px] border border-line bg-inset p-2', singleRow ? 'flex-nowrap' : 'flex-wrap')}>
      {bits.map((isNetwork, index) => (
        <span
          key={index}
          title={`bit ${index + 1}`}
          className={cn(
            'h-3',
            singleRow ? 'min-w-0 flex-1' : 'flex-1 basis-[8px]',
            isNetwork ? 'bg-acid/70' : 'bg-line',
            index === total - hostBits - 1 && 'outline outline-1 outline-acid',
          )}
        />
      ))}
    </div>
  );
}

const RowList = ({ rows }: { rows: { label: string; value: string; mono?: boolean; emphasis?: boolean }[] }) => {
  const t = useT();
  return (
  <div className="divide-y divide-line border border-line">
    {rows.map((row) => (
      <div key={row.label} className="flex flex-col gap-1 px-3.5 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <span className="label shrink-0">{t(row.label)}</span>
        <span
          className={cn(
            'break-all text-left font-mono text-[11.5px] text-ink sm:text-right',
            row.emphasis && 'text-acid',
          )}
        >
          {t(row.value)}
        </span>
      </div>
    ))}
  </div>
);
};

export function Tools({ apiOnline }: { apiOnline: boolean }) {
  const t = useT();
  const [tool, setTool] = useState<ToolId>('subnet');

  const [subnetInput, setSubnetInput] = useState('192.168.1.10/24');
  const [convertInput, setConvertInput] = useState('8.8.8.8');
  const [urlInput, setUrlInput] = useState('https://example.com/path?utm_source=docs&id=42#top');

  const subnet = useMemo(() => subnetInfo(subnetInput), [subnetInput]);
  const convert = useMemo(() => ipConvert(convertInput), [convertInput]);
  const url = useMemo(() => parseUrlInfo(urlInput), [urlInput]);

  const [samples, setSamples] = useState<number[]>([]);
  const [probing, setProbing] = useState(false);

  const [ice, setIce] = useState<{ address: string; port: string; type: string; protocol: string; host: string }[]>([]);
  const [iceRunning, setIceRunning] = useState(false);

  const [portHost, setPortHost] = useState('example.com');
  const [portNumber, setPortNumber] = useState('443');
  const [portLoading, setPortLoading] = useState(false);
  const [portResult, setPortResult] = useState<any>(null);
  const [portError, setPortError] = useState<string | null>(null);

  async function runLatency() {
    setProbing(true);
    const target = new URL(`favicon.svg?ping=${Date.now()}`, window.location.href).href;
    const values: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const started = performance.now();
      try {
        await fetch(`${target}&i=${index}`, { cache: 'no-store', credentials: 'omit' });
        values.push(Math.round(performance.now() - started));
      } catch {
        /* ignore */
      }
      setSamples([...values]);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    setProbing(false);
  }

  async function runWebRTC() {
    setIceRunning(true);
    setIce([]);
    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const found: { address: string; port: string; type: string; protocol: string; host: string }[] = [];
    connection.onicecandidate = (event) => {
      const candidate = event.candidate?.candidate;
      if (!candidate) return;
      const parts = candidate.split(' ');
      const typeIndex = parts.indexOf('typ');
      const type = typeIndex >= 0 ? parts[typeIndex + 1] : 'unknown';
      const protocol = parts[2]?.toLowerCase() || 'udp';
      const address = parts[4] || '';
      const port = parts[5] || '';
      if (!address) return;
      if (found.some((entry) => entry.address === address && entry.port === port)) return;
      found.push({ address, port, type, protocol, host: candidate });
      setIce([...found]);
    };
    try {
      connection.createDataChannel('probe');
      await connection.createOffer().then((offer) => connection.setLocalDescription(offer));
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      await connection.setLocalDescription(connection.localDescription!).catch(() => {});
    } catch (error) {
      toast(t((error as Error).message || 'WebRTC probe failed'), 'bad');
    }
    connection.close();
    setIceRunning(false);
  }

  async function runPort() {
    setPortLoading(true);
    setPortError(null);
    try {
      setPortResult(await checkPort(portHost.trim(), Number(portNumber)));
    } catch (reason) {
      setPortError((reason as Error).message);
      setPortResult(null);
    } finally {
      setPortLoading(false);
    }
  }

  const classify = (address: string, type: string) => {
  // labels resolved through the dictionary at render time
    if (type === 'srflx' || type === 'relay') return { label: 'public / relay', tone: 'warn' as const };
    if (address.endsWith('.local') || address.startsWith('a1b2') || !isIP(address)) return { label: 'mDNS obfuscated', tone: 'good' as const };
    if (isIPv4(address) || address.includes(':')) return { label: 'local host', tone: 'info' as const };
    return { label: 'unknown', tone: 'mute' as const };
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="utilities"
        title="Network toolbox"
        right={<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{t('six instruments · all local')}</span>}
      />

      <div className="grid gap-3 lg:grid-cols-[210px_1fr]">
        <nav className="panel h-fit min-w-0 lg:sticky lg:top-[68px]">
          <p className="label hidden px-4 pb-2 pt-3 lg:block">{t('instruments')}</p>
          <ul className="grid grid-cols-3 gap-px bg-line lg:flex lg:flex-col lg:gap-0 lg:bg-transparent">
            {TOOLS.map((entry) => {
              const Icon = entry.icon;
              const active = tool === entry.id;
              return (
                <li key={entry.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setTool(entry.id)}
                    className={cn(
                      'flex h-full w-full items-center gap-2 bg-panel px-2.5 py-2.5 text-left transition-colors lg:border-l-2 lg:px-4',
                      active
                        ? 'bg-acid/[0.07] text-acid lg:border-acid'
                        : 'text-muted hover:bg-white/[0.02] hover:text-ink lg:border-transparent',
                    )}
                  >
                    <Icon size={13} className={active ? 'text-acid' : 'text-dim'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.06em] lg:text-[10.5px] lg:tracking-[0.1em]">{t(entry.label)}</span>
                      <span className="mt-0.5 hidden whitespace-nowrap text-[10px] text-dim lg:block">{t(entry.hint)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="hidden border-t border-line px-4 py-3 lg:block">
            <p className="font-mono text-[9px] leading-relaxed text-dim">
              {t('No data leaves the browser except DNS queries and optional API calls.')}
            </p>
          </div>
        </nav>

        <div className="min-w-0">
          {tool === 'subnet' && (
            <Panel label="subnet calculator" title="CIDR analysis">
              <input
                className="input text-[14px]"
                value={subnetInput}
                onChange={(event) => setSubnetInput(event.target.value)}
                placeholder={t('10.0.0.0/8 or 2001:db8::/32')}
                spellCheck={false}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {['192.168.1.10/24', '10.0.0.0/8', '172.20.0.0/12', '2001:db8::/32'].map((value) => (
                  <button key={value} type="button" className="chip" onClick={() => setSubnetInput(value)}>
                    {value}
                  </button>
                ))}
              </div>

              {'error' in subnet ? (
                <div className="mt-3">
                  <ErrorState message={subnet.error ?? t('Invalid input')} />
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-inset px-4 py-3">
                    <div>
                      <p className="label">{t('summary')}</p>
                      <p className="mt-1 font-mono text-[18px] text-acid">{subnet.summary}</p>
                    </div>
                    <Badge tone="info">IPv{subnet.version}</Badge>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="label">{t('prefix map')}</p>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
                        {t('network / host')}
                      </span>
                    </div>
                    <BitRuler version={subnet.version} prefix={0} hostBits={subnet.version === 4 ? 32 - Number(subnet.summary!.split('/')[1]) : 128 - Number(subnet.summary!.split('/')[1])} />
                    <p className="mt-1.5 font-mono text-[10px] text-dim">{toolNote(subnet.note ?? '', t)}</p>
                  </div>

                  <RowList rows={subnet.rows} />
                  <div className="flex justify-end">
                    <CopyButton value={JSON.stringify(subnet, null, 2)} label={t('Copy result')} />
                  </div>
                </div>
              )}
            </Panel>
          )}

          {tool === 'convert' && (
            <Panel label="ip converter" title="Base conversions">
              <input
                className="input text-[14px]"
                value={convertInput}
                onChange={(event) => setConvertInput(event.target.value)}
                placeholder={t('8.8.8.8 · 3232235777 · 0x08080808 · ::ffff:1.2.3.4')}
                spellCheck={false}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {['8.8.8.8', '3232235777', '0x7F000001', '::ffff:192.168.1.1', '2001:db8::1'].map((value) => (
                  <button key={value} type="button" className="chip" onClick={() => setConvertInput(value)}>
                    {value}
                  </button>
                ))}
              </div>

              {'error' in convert ? (
                <div className="mt-3">
                  <ErrorState message={convert.error ?? t('Invalid input')} />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between border border-line bg-inset px-4 py-3">
                    <div>
                      <p className="label">{t('resolved')}</p>
                      <p className="mt-1 break-all font-mono text-[16px] text-acid">{convert.title}</p>
                    </div>
                    <Badge tone="info">IPv{convert.version}</Badge>
                  </div>
                  <RowList rows={convert.rows} />
                  <div className="flex justify-end">
                    <CopyButton value={JSON.stringify(convert, null, 2)} label={t('Copy result')} />
                  </div>
                </div>
              )}
            </Panel>
          )}

          {tool === 'url' && (
            <Panel label="url anatomy" title="Component breakdown">
              <input
                className="input text-[13px]"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder={t('https://example.com/path?a=1')}
                spellCheck={false}
              />
              {'error' in url ? (
                <div className="mt-3">
                  <ErrorState message={url.error ?? t('Invalid input')} />
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={url.flags.https ? 'good' : 'bad'}>{url.flags.https ? t('https') : t('plain http')}</Badge>
                    {url.flags.credentials && <Badge tone="bad">{t('embedded credentials')}</Badge>}
                    {url.flags.punycode && <Badge tone="warn">{t('punycode host')}</Badge>}
                    {url.flags.ipHost && <Badge tone="warn">{t('raw ip host')}</Badge>}
                  </div>

                  <RowList rows={url.rows} />

                  {url.params.length > 0 && (
                    <div>
                      <p className="label mb-2">{t('query parameters · {n}', { n: url.params.length })}</p>
                      <div className="overflow-x-auto border border-line">
                        <table className="table">
                          <thead>
                            <tr>
                              <th className="w-1/3">{t('Key')}</th>
                              <th>{t('Value')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {url.params.map((param, index) => (
                              <tr key={`${param.key}-${index}`}>
                                <td className="font-mono text-[11px] text-acid/80">{param.key}</td>
                                <td className="break-all font-mono text-[11px] text-muted">{param.value || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {url.warnings.length > 0 && (
                    <div className="border border-amber/25 bg-amber/[0.05] p-3">
                      <p className="label mb-2 !text-amber">{t('flags')}</p>
                      <ul className="space-y-1.5">
                        {url.warnings.map((warning) => (
                          <li key={warning} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
                            <span className="mt-1.5 h-1 w-1 shrink-0 bg-amber" />
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          {tool === 'latency' && (
            <Panel
              label="latency probe"
              title="Round trip to origin"
              actions={
                <button type="button" className="btn btn-ghost h-7 px-2 py-0 text-[9px]" onClick={runLatency} disabled={probing}>
                  <Play size={10} /> {probing ? t('Running') : t('Run')}
                </button>
              }
            >
              {samples.length === 0 ? (
                <EmptyState
                  title={t('no samples yet')}
                  body={t('Sends six cache-busted requests to this origin. Timing measures server + network round trip, not the whole internet.')}
                  icon={<Activity size={22} />}
                />
              ) : (
                <>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="font-mono text-[32px] leading-none text-ink">
                        {fmtMs(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length))}
                      </p>
                      <p className="label mt-1.5">{t('average · {n} samples', { n: samples.length })}</p>
                    </div>
                    <Badge tone={Math.min(...samples) < 120 ? 'good' : 'warn'}>{t('min {n} ms', { n: Math.min(...samples) })}</Badge>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    {samples.map((value, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-8 font-mono text-[9px] text-dim">{String(index + 1).padStart(2, '0')}</span>
                        <div className="h-2 flex-1 bg-line">
                          <div
                            className="h-2 bg-acid/80"
                            style={{ width: `${Math.max(3, Math.min(100, (value / Math.max(...samples)) * 100))}%` }}
                          />
                        </div>
                        <span className="w-14 text-right font-mono text-[10px] tabular-nums text-muted">{value} ms</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          )}

          {tool === 'webrtc' && (
            <Panel
              label="webrtc leak"
              title="ICE candidates"
              actions={
                <button type="button" className="btn btn-ghost h-7 px-2 py-0 text-[9px]" onClick={runWebRTC} disabled={iceRunning}>
                  {iceRunning ? <RefreshCw size={10} className="animate-spin" /> : <Play size={10} />}
                  {iceRunning ? t('Gathering') : t('Scan')}
                </button>
              }
            >
              {iceRunning && <Busy label={t('Gathering ICE candidates via STUN')} />}
              {!iceRunning && ice.length === 0 && (
                <EmptyState
                  title={t('no candidates')}
                  body={t('Run a scan to see which addresses this browser can expose to a WebRTC peer. Modern browsers obfuscate local hosts with mDNS.')}
                  icon={<Radar size={22} />}
                />
              )}
              {ice.length > 0 && (
                <div className="overflow-x-auto border border-line">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('Type')}</th>
                        <th>{t('Address')}</th>
                        <th className="text-right">{t('Port')}</th>
                        <th>{t('Class')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ice.map((entry, index) => {
                        const badge = classify(entry.address, entry.type);
                        return (
                          <tr key={`${entry.address}-${index}`}>
                            <td className="font-mono text-[10px] uppercase text-muted">{entry.type}</td>
                            <td className="break-all font-mono text-[10.5px] text-ink">{entry.address}</td>
                            <td className="text-right font-mono text-[10px] text-dim">{entry.port}</td>
                            <td>
                              <Badge tone={badge.tone}>{t(badge.label)}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {ice.length > 0 && (
                <p className="mt-3 text-[11px] leading-relaxed text-muted">
                  {t('Host candidates reveal a local address; server-reflexive and relay candidates reveal your public IP. Anything showing mDNS is already protected by the browser.')}
                </p>
              )}
            </Panel>
          )}

          {tool === 'port' && (
            <Panel label="port check" title="TCP reachability">
              {!apiOnline && (
                <div className="mb-3">
                  <ErrorState
                    message={t('Inspector API required')}
                    hint={t("TCP sockets can't be opened from a browser. Configure the NetScope API in Settings to enable this probe.")}
                  />
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_110px_auto]">
                <input className="input" value={portHost} onChange={(event) => setPortHost(event.target.value)} placeholder="example.com" spellCheck={false} />
                <input className="input" value={portNumber} onChange={(event) => setPortNumber(event.target.value)} placeholder="443" spellCheck={false} />
                <button type="button" className="btn btn-primary" onClick={runPort} disabled={portLoading}>
                  {portLoading ? t('Checking') : t('Check')}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted">{t('Public hosts only — private ranges are rejected by the API.')}</p>

              {portError && (
                <div className="mt-3">
                  <ErrorState message={portError} />
                </div>
              )}

              {portResult && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={portResult.open ? 'good' : 'bad'}>{portResult.open ? t('open') : t('closed / filtered')}</Badge>
                    {portResult.elapsed_ms !== undefined && <span className="font-mono text-[10px] text-dim">{portResult.elapsed_ms} ms</span>}
                  </div>
                  <KVGrid
                    rows={[
                      { label: t('Host'), value: portResult.host || portHost, mono: true },
                      { label: t('Port'), value: String(portResult.port || portNumber), mono: true },
                      { label: t('Banner'), value: portResult.banner || '—', full: true, mono: true },
                    ]}
                  />
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>

      <Panel label="notes" title="What runs where" flush>
        <div className="grid gap-px bg-line sm:grid-cols-3">
          {[
            { title: 'local', body: t('Subnet math, conversions, URL parsing, latency, WebRTC and browser signals never leave this tab.') },
            { title: 'encrypted dns', body: t('DNS and email checks query Cloudflare or Google over HTTPS. The hostname you type goes to the resolver.') },
            { title: 'optional api', body: t('Website inspection, SMTP banners and TCP probes route through your own NetScope backend when configured.') },
          ].map((item) => (
            <div key={item.title} className="bg-panel p-4">
              <p className="label mb-1.5">{t(item.title)}</p>
              <p className="text-[11.5px] leading-relaxed text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

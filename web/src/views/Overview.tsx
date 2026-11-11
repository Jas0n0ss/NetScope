import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  ExternalLink,
  Globe2,
  Mail,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { Badge, CopyButton, ErrorState, GeoPlot, KVGrid, Panel, Sparkline, StatusDot, Busy } from '../components/ui';
import { toast } from '../components/toast';
import { myIP } from '../lib/net';
import { addHistory, clearHistory, getHistory } from '../lib/store';
import { cn, copyText, downloadFile, fmtNumber, localClock, timeAgo } from '../lib/format';
import type { HistoryEntry, MyIP } from '../lib/types';
import type { ViewId } from '../lib/views';
import { useT } from '../lib/i18n';

const qualityFor = (ms: number | null) => {
  if (ms === null) return { label: 'unknown', tone: 'mute' as const };
  if (ms < 60) return { label: 'excellent', tone: 'good' as const };
  if (ms < 120) return { label: 'good', tone: 'good' as const };
  if (ms < 250) return { label: 'fair', tone: 'warn' as const };
  return { label: 'slow', tone: 'bad' as const };
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

type NetworkInfo = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
};

function readConnection(): NetworkInfo {
  const nav = navigator as any;
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  return connection
    ? {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData,
        type: connection.type,
      }
    : {};
}

export function Overview({ onNavigate }: { onNavigate: (id: ViewId) => void }) {
  const t = useT();
  const [data, setData] = useState<MyIP | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<number[]>([]);
  const [medianMs, setMedianMs] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clock, setClock] = useState(() => localClock());
  const connection = useMemo(readConnection, []);

  const zone = data?.timezone?.id || undefined;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(localClock(zone)), 1000);
    return () => window.clearInterval(timer);
  }, [zone]);

  useEffect(() => {
    const onStore = () => setHistory(getHistory());
    window.addEventListener('netscope:store', onStore);
    setHistory(getHistory());
    return () => window.removeEventListener('netscope:store', onStore);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [info, latency] = await Promise.allSettled([myIP(), probeOrigin()]);
      if (!mounted) return;
      if (info.status === 'fulfilled') {
        setData(info.value);
        addHistory({
          target: info.value.primary,
          kind: info.value.type === 'IPv6' ? 'ip' : 'ip',
          ip: info.value.primary,
          country: info.value.country,
          countryCode: info.value.countryCode,
          city: info.value.city,
          at: Date.now(),
        });
        setError(null);
      } else {
        setError((info.reason as Error)?.message || t('Lookup failed'));
      }
      if (latency.status === 'fulfilled') {
        setSamples(latency.value.samples);
        setMedianMs(latency.value.median);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function probeOrigin(): Promise<{ samples: number[]; median: number | null }> {
    const target = new URL(`favicon.svg?ping=${Date.now()}`, window.location.href).href;
    const results: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      try {
        await fetch(`${target}&i=${index}`, { cache: 'no-store', credentials: 'omit' });
        results.push(performance.now() - started);
      } catch {
        /* ignore a failed ping */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 90));
    }
    return { samples: results.map((value) => Math.round(value)), median: median(results.map(Math.round)) };
  }

  async function refresh() {
    setProbing(true);
    const [info, latency] = await Promise.allSettled([myIP(), probeOrigin()]);
    if (info.status === 'fulfilled') {
      setData(info.value);
      setError(null);
    } else {
      setError((info.reason as Error)?.message || t('Lookup failed'));
      toast(t('Refresh failed'), 'bad');
    }
    if (latency.status === 'fulfilled') {
      setSamples(latency.value.samples);
      setMedianMs(latency.value.median);
    }
    setProbing(false);
  }

  if (loading) {
    return (
      <Panel label="workspace" title="Establishing session">
        <Busy label={t('Resolving public identity and probing origin')} />
      </Panel>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <ErrorState message={error || t('Public IP unavailable')} hint={t('A privacy extension, VPN or firewall can block IP lookups.')} />
        <button type="button" className="btn btn-primary" onClick={refresh}>
          <RefreshCw size={12} /> {t('Retry')}
        </button>
      </div>
    );
  }

  const quality = qualityFor(medianMs);
  const location = [data.city, data.region, data.country].filter(Boolean).join(', ') || t('Location unavailable');
  const maps =
    data.latitude !== null && data.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${data.latitude}&mlon=${data.longitude}#map=12/${data.latitude}/${data.longitude}`
      : '';
  const report = {
    generatedAt: new Date().toISOString(),
    publicIp: data.primary,
    ipv4: data.ipv4,
    ipv6: data.ipv6,
    location: { city: data.city, region: data.region, country: data.country, countryCode: data.countryCode, postal: data.postal },
    coordinates: { latitude: data.latitude, longitude: data.longitude },
    network: { isp: data.isp, org: data.org, asn: data.asn, domain: data.domain, source: data.source },
    timezone: data.timezone,
    latency: { samples, median: medianMs },
  };

  const shortcuts: { id: ViewId; label: string; hint: string; icon: any }[] = [
    { id: 'lookup', label: 'Address lookup', hint: 'geo + rdap', icon: Search },
    { id: 'dns', label: 'DNS resolver', hint: 'doh + dig', icon: Network },
    { id: 'email', label: 'Mail auth', hint: 'spf · dkim · dmarc', icon: Mail },
    { id: 'tools', label: 'Network tools', hint: 'subnet · url · probes', icon: Wrench },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          ticked
          className="lg:col-span-8"
          label="public identity"
          title={
            <span className="flex items-center gap-2">
              {t('Exit node')}
              <span className="led animate-pulseDot bg-acid" />
            </span>
          }
          bodyClassName="p-5"
          actions={
            <>
              <Badge tone="good" dot>{t('live')}</Badge>
              <button type="button" className="btn btn-ghost h-7 px-2 py-0" onClick={refresh} disabled={probing}>
                <RefreshCw size={11} className={cn(probing && 'animate-spin')} /> {t('Refresh')}
              </button>
            </>
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <p className="label mb-2">{t('primary address')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="break-all font-mono text-[30px] leading-none tracking-tight text-ink sm:text-[36px]">
                  {data.primary}
                </h1>
                <CopyButton value={data.primary} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
                <span className="text-acid/80">{data.type}</span>
                <span className="text-dim">·</span>
                <span>{data.ipv6 ? `IPv6 ${data.ipv6}` : t('IPv6 not exposed')}</span>
                {data.resolvedFrom && (
                  <>
                    <span className="text-dim">·</span>
                    <span>{t('resolved from {host}', { host: data.resolvedFrom })}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex h-10 w-14 items-center justify-center border border-line bg-raise/40 font-mono text-[13px] text-acid">
                {data.countryCode || '??'}
              </span>
              <div>
                <p className="font-mono text-[12px] text-ink">{data.country || t('Unknown region')}</p>
                <p className="mt-1 text-[11.5px] text-muted">{location}</p>
                {maps && (
                  <a
                    href={maps}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-acid/80 hover:text-acid"
                  >
                    <Globe2 size={10} /> {data.latitude?.toFixed(3)}, {data.longitude?.toFixed(3)}
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-px border border-line bg-line">
            {[
              { label: 'isp', value: data.isp || data.org || '—' },
              { label: 'asn', value: data.asn ? `AS${data.asn}` : '—' },
              { label: 'local time', value: clock.time },
              { label: 'zone', value: clock.offset || data.timezone.id || '—' },
            ].map((item) => (
              <div key={item.label} className="bg-panel px-3 py-3">
                <p className="label">{t(item.label)}</p>
                <p className="mt-1.5 truncate font-mono text-[12px] text-ink" title={item.value}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {data.latitude !== null && data.longitude !== null && (
            <GeoPlot lat={data.latitude} lon={data.longitude} className="mt-4 h-24" />
          )}
        </Panel>

        <Panel
          className="lg:col-span-4"
          label="round trip"
          title="Origin latency"
          actions={<Badge tone={quality.tone}>{t(quality.label)}</Badge>}
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[38px] leading-none tabular-nums text-ink">
                {medianMs === null ? '—' : Math.round(medianMs)}
              </p>
              <p className="label mt-2">{t('ms · median')}</p>
            </div>
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              <p>{t('{n} probes', { n: samples.length })}</p>
              <p className="mt-1">{t('same origin')}</p>
            </div>
          </div>

          <div className="mt-4 border border-line bg-inset px-2 py-1">
            <Sparkline values={samples.length ? samples : [0, 0]} height={46} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-px bg-line">
            {[
              { label: 'min', value: samples.length ? `${Math.min(...samples)}ms` : '—' },
              { label: 'median', value: medianMs === null ? '—' : `${Math.round(medianMs)}ms` },
              { label: 'max', value: samples.length ? `${Math.max(...samples)}ms` : '—' },
            ].map((item) => (
              <div key={item.label} className="bg-panel px-2.5 py-2">
                <p className="label">{t(item.label)}</p>
                <p className="mt-1 font-mono text-[11px] text-ink">{item.value}</p>
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-ghost mt-3 w-full" onClick={refresh} disabled={probing}>
            <RefreshCw size={11} className={cn(probing && 'animate-spin')} /> {probing ? t('Probing') : t('Run probe')}
          </button>

          {samples.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
              <span className="label mr-1 shrink-0">{t('samples')}</span>
              {samples.map((value, index) => (
                <span key={index} className="border border-line px-1.5 py-1 font-mono text-[9px] tabular-nums text-muted">
                  {Math.round(value)}
                </span>
              ))}
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.1em] text-dim">ms</span>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          className="lg:col-span-5"
          label="session log"
          title="Recent lookups"
          flush
          actions={
            <>
              <button
                type="button"
                className="icon-btn h-7 w-7"
                onClick={() => {
                  downloadFile('netscope-report.json', JSON.stringify(report, null, 2));
                  toast(t('Report exported'), 'good');
                }}
                aria-label={t('Export report')}
              >
                <Download size={12} />
              </button>
              <button
                type="button"
                className="icon-btn h-7 w-7 hover:!text-danger"
                onClick={() => {
                  clearHistory();
                  toast(t('Session log cleared'), 'good');
                }}
                aria-label={t('Clear session log')}
              >
                <Trash2 size={12} />
              </button>
            </>
          }
        >
          {history.length === 0 ? (
            <p className="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
              {t('no addresses resolved yet')}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((entry) => (
                <li key={`${entry.target}-${entry.at}`}>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('netscope:lookup', { detail: entry.target }));
                      onNavigate('lookup');
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
                  >
                    <span className="w-7 shrink-0 border border-line py-0.5 text-center font-mono text-[9px] text-dim">
                      {entry.countryCode || entry.country.slice(0, 2).toUpperCase() || '??'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11.5px] text-ink">{entry.target}</span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-dim">
                        {[entry.city, entry.country].filter(Boolean).join(', ') || 'unknown'}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
                      {timeAgo(entry.at)}
                    </span>
                  </button>
                </li>
              ))}
              {Array.from({ length: Math.max(0, 4 - history.length) }).map((_, index) => (
                <li key={`slot-${index}`} className="flex items-center gap-3 px-4 py-2.5" aria-hidden>
                  <span className="w-7 shrink-0 border border-line/50 py-0.5 text-center font-mono text-[9px] text-dim/40">
                    ··
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim/35">
                    {t('buffer slot {n} · empty', { n: String(history.length + index + 2).padStart(2, '0') })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="lg:col-span-3" label="link profile" title="Connection">
          <div className="space-y-3">
            {[
              { label: 'effective type', value: connection.effectiveType?.toUpperCase() || '—' },
              { label: 'downlink', value: connection.downlink ? `${connection.downlink} Mb/s` : '—' },
              { label: 'rtt', value: connection.rtt ? `${connection.rtt} ms` : '—' },
              { label: 'data saver', value: connection.saveData ? 'ON' : 'OFF' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3">
                <span className="label">{t(item.label)}</span>
                <span className="font-mono text-[11px] text-ink">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              <StatusDot status="pass" />
              {t('encrypted transport')}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              {t('Session state is stored locally. No request is logged on any server owned by NetScope.')}
            </p>
          </div>
        </Panel>

        <Panel className="lg:col-span-4" label="shortcuts" title="Jump to a tool" flush>
          <ul className="divide-y divide-line">
            {shortcuts.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                  >
                    <Icon size={14} className="text-dim group-hover:text-acid" />
                    <span className="flex-1">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.1em] text-ink">{t(item.label)}</span>
                      <span className="mt-0.5 block text-[10.5px] text-dim">{t(item.hint)}</span>
                    </span>
                    <ArrowRight size={12} className="text-dim group-hover:text-acid" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel className="lg:col-span-7" label="registry snapshot" title="Owner & routing">
          <KVGrid
            rows={[
              { label: 'ISP', value: data.isp || '—' },
              { label: 'ASN', value: data.asn ? `AS${data.asn}` : '—', mono: true },
              { label: 'Organization', value: data.org || '—', full: true },
              { label: 'Reverse domain', value: data.domain || '—', mono: true },
              { label: 'Data source', value: data.source, mono: true },
            ]}
          />
        </Panel>
        <Panel className="lg:col-span-5" label="time zone" title={data.timezone.id || zone || t('Local')}>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[26px] tabular-nums text-ink">{clock.time}</span>
            <span className="label">{clock.offset || t('utc')}</span>
          </div>
          <p className="mt-2 text-[11.5px] text-muted">{clock.date}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="info">{Intl.DateTimeFormat().resolvedOptions().locale}</Badge>
            <Badge tone="mute">{fmtNumber(data.postal || '—')}</Badge>
          </div>
        </Panel>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Download, Network, RefreshCw, Terminal as TerminalIcon } from 'lucide-react';
import { Badge, Busy, CopyButton, ErrorState, Panel, SectionTitle, Terminal } from '../components/ui';
import { toast } from '../components/toast';
import { dohQuery } from '../lib/net';
import { formatDig } from '../lib/dig';
import { addDnsHistory, getDnsHistory } from '../lib/store';
import { cn, downloadFile, timeAgo } from '../lib/format';
import type { DnsResult } from '../lib/types';
import { useT } from '../lib/i18n';

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'PTR', 'SRV', 'HTTPS'];

const typeTone = (type: string) => {
  if (['A', 'AAAA'].includes(type)) return 'good';
  if (['CNAME', 'MX', 'NS'].includes(type)) return 'info';
  if (['TXT', 'CAA'].includes(type)) return 'warn';
  return 'mute';
};

export function Dns() {
  const t = useT();
  const [name, setName] = useState('');
  const [type, setType] = useState('A');
  const [resolver, setResolver] = useState<'cloudflare' | 'google'>('cloudflare');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DnsResult | null>(null);
  const [history, setHistory] = useState(getDnsHistory());

  useEffect(() => {
    const onStore = () => setHistory(getDnsHistory());
    window.addEventListener('netscope:store', onStore);
    return () => window.removeEventListener('netscope:store', onStore);
  }, []);

  useEffect(() => {
    const onQuick = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string; type: string }>).detail;
      if (detail?.name) {
        setName(detail.name);
        setType(detail.type || 'A');
        void run(detail.name, detail.type || 'A');
      }
    };
    window.addEventListener('netscope:dns-quick', onQuick);
    return () => window.removeEventListener('netscope:dns-quick', onQuick);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams((window.location.hash.split('?')[1] || '').replace(/^\?/, ''));
    const presetName = params.get('name');
    if (presetName) {
      const presetType = params.get('type') || 'A';
      const presetResolver = params.get('resolver') === 'google' ? 'google' : 'cloudflare';
      setName(presetName);
      setType(presetType);
      setResolver(presetResolver);
      void run(presetName, presetType, presetResolver);
    }
  }, []);

  async function run(target = name, recordType = type, resolverId: 'cloudflare' | 'google' = resolver) {
    const value = target.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      const answer = await dohQuery(value, recordType, resolverId);
      setResult(answer);
      addDnsHistory({ name: value, type: recordType, at: Date.now() });
      setHistory(getDnsHistory());
    } catch (reason) {
      setError((reason as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const transcript = result ? formatDig(result) : '';

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="resolver"
        title="DNS over HTTPS"
        right={<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{t('encrypted · no logs')}</span>}
      />

      <Panel ticked label="query" title="Resolve records">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <input
            className="input flex-1 text-[14px]"
            placeholder={t('example.com · _dmarc.example.com · 8.8.8.8 (PTR)')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="btn btn-primary px-6" disabled={loading}>
            {loading ? t('Querying') : t('Query')}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">{t('type')}</span>
            {TYPES.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => {
                  setType(entry);
                  if (name.trim()) void run(name, entry);
                }}
                className={cn('chip', type === entry && 'chip-active')}
              >
                {entry}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="label mr-1">{t('resolver')}</span>
            {(['cloudflare', 'google'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setResolver(entry)}
                className={cn('chip', resolver === entry && 'chip-active')}
              >
                {entry}
              </button>
            ))}
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="label">{t('recent')}</span>
            {history.slice(0, 6).map((entry) => (
              <button
                key={`${entry.name}-${entry.type}`}
                type="button"
                className="chip"
                onClick={() => {
                  setName(entry.name);
                  setType(entry.type);
                  void run(entry.name, entry.type);
                }}
              >
                <span className="max-w-[220px] truncate">{entry.name}</span>
                <span className="text-acid/70">{entry.type}</span>
                <span className="text-dim/60">{timeAgo(entry.at)}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {loading && (
        <Panel>
          <Busy label={t('Resolving over DNS-over-HTTPS')} />
        </Panel>
      )}

      {error && <ErrorState message={error} hint={t('Try the other resolver or check that the record type is valid for this name.')} />}

      {result && !loading && (
        <>
          <Panel
            label="response"
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono">{result.name}</span>
                <Badge tone="info">{result.type}</Badge>
              </span>
            }
            actions={
              <Badge tone={result.status === 0 ? 'good' : 'bad'} dot>
                {result.statusText}
              </Badge>
            }
          >
            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
              {[
                { label: 'answers', value: String(result.answers.length) },
                { label: 'authority', value: String(result.authority.length) },
                { label: 'query time', value: `${result.elapsedMs} ms` },
                { label: 'resolver', value: result.resolver },
              ].map((item) => (
                <div key={item.label} className="bg-panel px-3 py-2.5">
                  <p className="label">{t(item.label)}</p>
                  <p className="mt-1 font-mono text-[12px] text-ink">{item.value}</p>
                </div>
              ))}
            </div>

            {result.answers.length > 0 ? (
              <div className="mt-4 overflow-x-auto border border-line">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-16">{t('Type')}</th>
                      <th className="w-16 text-right">{t('TTL')}</th>
                      <th>{t('Value')}</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.answers.map((answer, index) => (
                      <tr key={`${answer.data}-${index}`} className="group hover:bg-white/[0.02]">
                        <td>
                          <Badge tone={typeTone(answer.typeName)}>{answer.typeName}</Badge>
                        </td>
                        <td className="text-right font-mono text-[11px] tabular-nums text-dim">{answer.ttl ?? '—'}</td>
                        <td>
                          <span className="block break-all font-mono text-[11.5px] text-ink">{answer.data}</span>
                          <span className="mt-0.5 block break-all font-mono text-[10px] text-dim">{answer.name}</span>
                        </td>
                        <td>
                          <CopyButton value={answer.data} label="" className="opacity-0 group-hover:opacity-100" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 border border-line px-4 py-6 text-center">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t('no records returned')}</p>
                <p className="mt-1.5 text-[11.5px] text-dim">
                  {result.statusText === 'NXDOMAIN'
                    ? t('The name does not exist in this zone.')
                    : t('The query succeeded but this record type is empty.')}
                </p>
              </div>
            )}

            {result.authority.length > 0 && (
              <div className="mt-3">
                <p className="label mb-2">{t('authority section')}</p>
                <div className="space-y-1 border border-line bg-inset p-3">
                  {result.authority.map((answer, index) => (
                    <p key={index} className="break-all font-mono text-[10.5px] text-dim">
                      <span className="text-muted">{answer.typeName}</span> {answer.data}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Terminal
            title={t('dig transcript · {name} {type}', { name: result.name, type: result.type })}
            content={transcript}
            actions={
              <>
                <CopyButton value={transcript} />
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  onClick={() => {
                    downloadFile(`dig-${result.name.replace(/[^\w.-]/g, '_')}-${result.type}.txt`, transcript, 'text/plain');
                    toast(t('Transcript saved'), 'good');
                  }}
                  aria-label={t('Download transcript')}
                >
                  <Download size={12} />
                </button>
              </>
            }
          />
        </>
      )}

      {!result && !loading && !error && (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Network size={26} className="text-dim" />
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t('resolver idle')}</p>
            <p className="max-w-md text-[12px] leading-relaxed text-dim">
              {t('Nine record types are available over Cloudflare or Google DoH. The dig transcript is reconstructed locally — no shell, no server.')}
            </p>
            <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-dim">
              <TerminalIcon size={11} />
              {t('try')} <button className="text-acid" onClick={() => { setName('example.com'); void run('example.com', 'A'); }}>example.com</button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

import { useState } from 'react';
import {
  ArrowRight,
  Calculator,
  Download,
  ExternalLink,
  Mail,
  Network,
  Lock,
  Radar,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Busy, CopyButton, ErrorState, Gauge, KVGrid, Panel, SectionTitle, Terminal } from '../components/ui';
import { toast } from '../components/toast';
import { inspectWebsite } from '../lib/net';
import { auditHeaders } from '../lib/tools';
import { cn, downloadFile, fmtBytes, fmtDate, daysBetween } from '../lib/format';
import { useT, headerDetail } from '../lib/i18n';

const headerValue = (headers: Record<string, any> | undefined, name: string): string => {
  if (!headers) return '';
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
};

const normalizeUrl = (raw: string): string => {
  let value = raw.trim();
  if (!value) throw new Error('Enter a website URL to inspect.');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http:// and https:// URLs can be inspected.');
  return url.href;
};

export function Website({ apiOnline, onOpenSettings }: { apiOnline: boolean; onOpenSettings: () => void }) {
  const t = useT();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  async function run(target = input) {
    setLoading(true);
    setError(null);
    try {
      const url = normalizeUrl(target);
      setInput(url);
      const result = await inspectWebsite(url);
      setReport(result);
      toast(t('Inspected {host}', { host: new URL(result.final_url || url).hostname }), 'good');
    } catch (reason) {
      setError(t((reason as Error).message));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  const audit = report ? auditHeaders(report.headers || {}, { https: Boolean(report.https) }) : null;
  const tls = report?.tls;
  const expiresIn = tls ? daysBetween(tls.valid_to) : null;
  const redirects = Array.isArray(report?.redirects) ? report.redirects : [];
  const headers: Record<string, any> = report?.headers || {};
  const headerNames = Object.keys(headers).sort((a, b) => a.localeCompare(b));
  const meta = report?.meta || {};
  const og = meta.og || {};
  const twitter = meta.twitter || {};
  const sans: string[] = Array.isArray(tls?.sans) ? tls.sans : [];

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="security"
        title="Website inspector"
        right={<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{t('headers · tls · metadata')}</span>}
      />

      {!apiOnline && (
        <Panel ticked className="overflow-hidden" bodyClassName="p-0">
          <div className="flex items-center gap-2 border-b border-amber/20 bg-amber/[0.06] px-4 py-2">
            <TriangleAlert size={13} className="text-amber" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
              {t('inspector api required')}
            </span>
          </div>
          <div className="grid gap-6 p-5 md:grid-cols-[1.4fr_1fr]">
            <div>
              <h3 className="text-[17px] leading-tight text-ink">{t('Headers, TLS and metadata need a server.')}</h3>
              <p className="mt-2 max-w-lg text-[12.5px] leading-relaxed text-muted">
                {t('Browsers cannot read cross-origin response headers or inspect a certificate chain. NetScope keeps that work behind its own hardened API endpoint, so the page stays a pure client. Point it at any NetScope API instance in Settings to unlock this view.')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
                  <ServerCog size={12} /> {t('Configure API')}
                </button>
                <a
                  href="#/dns"
                  className="btn btn-ghost"
                >
                  <Radar size={12} /> {t('Use local DNS')}
                </a>
              </div>

              <div className="mt-6 space-y-2">
                {[
                  ['GET', '/api/health', t('service heartbeat')],
                  ['GET', '/api/inspect?url=', t('headers, redirects, TLS, meta')],
                  ['GET', '/api/smtp?host=&port=', t('SMTP banner and STARTTLS')],
                  ['GET', '/api/port?host=&port=', t('single TCP reachability')],
                ].map(([method, path, note]) => (
                  <div key={path} className="flex flex-wrap items-baseline gap-2 border-b border-line pb-2 font-mono text-[10.5px]">
                    <span className="text-acid">{method}</span>
                    <span className="text-ink">{path}</span>
                    <span className="ml-auto text-dim">{note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-line bg-inset p-4">
              <p className="label mb-3">{t('run the backend')}</p>
              <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-muted">{`python3 -m venv .venv
source .venv/bin/activate
pip install -r pyapp/requirements.txt
flask --app pyapp.app run -p 8080`}</pre>
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <ShieldCheck size={12} className="text-acid" />
                <span className="text-[10.5px] text-dim">{t('Public hosts only · private ranges blocked')}</span>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {!apiOnline && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: '#/dns', title: t('DNS resolver'), body: t('Nine record types over DoH, with dig transcripts.'), icon: Network },
            { href: '#/email', title: t('Email auth'), body: t('SPF, DKIM, DMARC, MTA-STS and BIMI scoring.'), icon: Mail },
            { href: '#/tools', title: t('Subnet math'), body: t('CIDR, conversions, URL anatomy and probes.'), icon: Calculator },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <a
                key={card.href}
                href={card.href}
                className="panel panel-hover group flex items-start gap-3 p-4"
              >
                <Icon size={16} className="mt-0.5 text-dim group-hover:text-acid" />
                <span className="flex-1">
                  <span className="block font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink">{card.title}</span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-muted">{card.body}</span>
                </span>
                <ArrowRight size={12} className="mt-1 text-dim group-hover:text-acid" />
              </a>
            );
          })}
        </div>
      )}

      {apiOnline && (
        <Panel label="target" title="Inspect a URL">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <input
              className="input flex-1 text-[14px]"
              placeholder={t('https://example.com')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button className="btn btn-primary px-6" disabled={loading}>
              <Radar size={12} /> {loading ? t('Inspecting') : t('Inspect')}
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="label">{t('presets')}</span>
            {['https://example.com', 'https://github.com', 'https://cloudflare.com'].map((url) => (
              <button
                key={url}
                type="button"
                className="chip"
                onClick={() => {
                  setInput(url);
                  void run(url);
                }}
              >
                {url.replace('https://', '')}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {loading && apiOnline && (
        <Panel>
          <Busy label={t('Fetching headers, certificate and page metadata')} />
        </Panel>
      )}

      {error && <ErrorState message={error} />}

      {report && !loading && (
        <>
          <Panel
            ticked
            label="inspection"
            title={report.meta?.title || report.final_url || input}
            actions={
              <>
                <Badge tone={report.status >= 200 && report.status < 400 ? 'good' : 'bad'}>
                  {report.status} {report.reason || ''}
                </Badge>
                <Badge tone={report.https ? 'good' : 'warn'}>{report.https ? 'https' : 'http'}</Badge>
              </>
            }
          >
            <p className="break-all font-mono text-[11.5px] text-acid/80">{report.final_url || input}</p>
            <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
              {headerValue(report.headers, 'server') && <span>server {headerValue(report.headers, 'server')}</span>}
              <span>· {Math.round(report.elapsed_ms || 0)} ms</span>
              {report.body_bytes ? <span>· {fmtBytes(report.body_bytes)}</span> : null}
              {redirects.length ? <span>· {t('{n} redirects', { n: redirects.length })}</span> : null}
              {report.ip && <span className="text-muted">· {report.ip}</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="btn btn-ghost h-8" href={report.final_url || input} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={11} /> {t('Open site')}
              </a>
              <button type="button" className="btn btn-ghost h-8" onClick={() => void run(report.final_url || input)}>
                <RefreshCw size={11} /> {t('Re-run')}
              </button>
              <CopyButton value={JSON.stringify(report, null, 2)} label={t('Copy JSON')} />
            </div>
          </Panel>

          <div className="grid gap-3 lg:grid-cols-12">
            <Panel className="lg:col-span-5" label="security posture" title="Header audit">
              {audit && (
                <>
                  <div className="flex items-center gap-4">
                    <Gauge score={audit.score} grade={audit.grade} size={116} />
                    <div>
                      <p className="font-mono text-[12px] text-ink">
                        {t('{passed} / {total} headers present', { passed: audit.passed, total: audit.total })}
                      </p>
                      <p className="mt-1.5 max-w-[190px] text-[11px] leading-relaxed text-muted">
                        {audit.score >= 75 ? t('Strong baseline for a production edge.') : audit.score >= 50 ? t('Usable, with clear gaps to close.') : t('Weak posture — most hardening headers are absent.')}
                      </p>
                    </div>
                  </div>

                  <ul className="mt-4 divide-y divide-line border-t border-line">
                    {audit.checks.map((check) => (
                      <li key={check.id} className="flex items-start gap-2.5 py-2.5">
                        <span
                          className={cn(
                            'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                            check.status === 'pass' ? 'bg-acid' : check.status === 'warn' ? 'bg-amber' : 'bg-danger',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink">{check.name}</p>
                          <p className="mt-0.5 break-all text-[10.5px] leading-relaxed text-dim">{headerDetail(check.detail, t)}</p>
                        </div>
                        <Badge tone={check.status === 'pass' ? 'good' : check.status === 'warn' ? 'warn' : 'bad'}>
                          {check.status === 'pass' ? t('pass') : check.status === 'warn' ? t('review') : t('missing')}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <div className="space-y-3 lg:col-span-7">
              <Panel
                label="tls"
                title={tls?.subject || t('Certificate')}
                actions={<Badge tone={report.https ? 'good' : 'warn'}>{report.https ? t('encrypted') : t('plain http')}</Badge>}
              >
                {!report.https ? (
                  <p className="text-[11.5px] leading-relaxed text-dim">
                    {t('This page was served over plain HTTP, so there is no certificate to present.')}
                  </p>
                ) : tls?.error ? (
                  <ErrorState message={t('Certificate details unavailable')} hint={tls.error} />
                ) : (
                  <>
                    <KVGrid
                      rows={[
                        { label: t('Issuer'), value: tls?.issuer || '—', full: true },
                        { label: t('Valid from'), value: tls?.valid_from ? fmtDate(tls.valid_from) : '—' },
                        { label: t('Expires'), value: tls?.valid_to ? fmtDate(tls.valid_to) : '—' },
                        { label: t('Protocol'), value: tls?.version || '—', mono: true },
                        { label: t('Cipher'), value: tls?.cipher || '—', mono: true },
                        { label: t('Days remaining'), value: expiresIn === null ? '—' : `${expiresIn}` },
                        { label: t('Serial'), value: tls?.serial || '—', mono: true, full: true },
                      ]}
                    />
                    {expiresIn !== null && (
                      <div className="mt-3">
                        <div className="h-1 bg-line">
                          <div
                            className={cn('h-1', expiresIn < 0 ? 'bg-danger' : expiresIn < 21 ? 'bg-amber' : 'bg-acid')}
                            style={{ width: `${Math.max(2, Math.min(100, (expiresIn / 365) * 100))}%` }}
                          />
                        </div>
                        <p className="mt-1.5 font-mono text-[10px] text-dim">
                          {expiresIn < 0 ? t('expired {n} days ago', { n: Math.abs(expiresIn) }) : t('{n} days until expiry', { n: expiresIn })}
                        </p>
                      </div>
                    )}
                    {sans.length > 0 && (
                      <div className="mt-3 border-t border-line pt-3">
                        <p className="label mb-1.5">{t('subject alternative names')} · {sans.length}</p>
                        <div className="flex flex-wrap gap-1">
                          {sans.slice(0, 10).map((name) => (
                            <span key={name} className="border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted">
                              {name}
                            </span>
                          ))}
                          {sans.length > 10 && <span className="px-1 font-mono text-[9px] text-dim">+{sans.length - 10}</span>}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Panel>

              <Panel label="response" title="Redirect chain" flush>
                {redirects.length ? (
                  <ol className="divide-y divide-line">
                    {redirects.map((step: any, index: number) => (
                      <li key={`${step.url}-${index}`} className="flex items-start gap-3 px-4 py-2.5">
                        <span className="font-mono text-[10px] text-dim">{String(index + 1).padStart(2, '0')}</span>
                        <div className="min-w-0 flex-1">
                          <p className="break-all font-mono text-[10.5px] text-ink">{step.url}</p>
                          <p className="mt-0.5 break-all font-mono text-[9.5px] text-dim">
                            {step.status}
                            {step.location ? ` → ${step.location}` : ''} · {Math.round(step.elapsed_ms || 0)} ms
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="px-4 py-4 text-[11.5px] text-dim">{t('No redirects — the requested URL responded directly.')}</p>
                )}
              </Panel>

              <Panel label="metadata" title="Page signals">
                <KVGrid
                  rows={[
                    { label: t('Title'), value: meta.title || '—', full: true },
                    { label: t('Description'), value: meta.description || '—', full: true },
                    { label: t('Canonical'), value: meta.canonical || '—', mono: true, full: true },
                    { label: t('Robots'), value: meta.robots || '—' },
                    { label: t('Viewport'), value: meta.viewport || '—', mono: true },
                    { label: t('Lang'), value: meta.lang || '—', mono: true },
                    { label: t('Generator'), value: meta.generator || '—' },
                    { label: 'Open Graph', value: [og.title, og.type, og.site_name].filter(Boolean).join(' · ') || '—', full: true },
                    { label: 'Twitter', value: [twitter.card, twitter.title].filter(Boolean).join(' · ') || '—', full: true },
                  ]}
                />
              </Panel>
            </div>
          </div>

          <Panel
            label="headers"
            title={t('Response headers · {n}', { n: headerNames.length })}
            flush
            actions={
              <>
                <CopyButton
                  value={headerNames.map((name) => `${name}: ${headers[name]}`).join('\n')}
                  label={t('Copy all')}
                />
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  onClick={() => {
                    downloadFile(`inspect-${new URL(report.final_url || input).hostname}.json`, JSON.stringify(report, null, 2));
                    toast(t('Report downloaded'), 'good');
                  }}
                  aria-label={t('Download JSON')}
                >
                  <Download size={12} />
                </button>
                <button type="button" className="btn btn-quiet h-7 px-2 py-0 text-[9px]" onClick={() => setRawOpen((open) => !open)}>
                  {rawOpen ? t('Table') : t('JSON')}
                </button>
              </>
            }
          >
            {rawOpen ? (
              <pre className="max-h-[420px] overflow-auto bg-inset p-4 font-mono text-[10.5px] leading-relaxed text-muted">
                {JSON.stringify(report, null, 2)}
              </pre>
            ) : headerNames.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-1/3">{t('Header')}</th>
                      <th>{t('Value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headerNames.map((name) => (
                      <tr key={name} className="hover:bg-white/[0.02]">
                        <td className="font-mono text-[10.5px] text-acid/80">{name}</td>
                        <td className="break-all font-mono text-[10.5px] text-muted">
                          {Array.isArray(headers[name]) ? headers[name].join(', ') : String(headers[name])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-4 text-[11.5px] text-dim">{t('No response headers were captured.')}</p>
            )}
          </Panel>
        </>
      )}

      {!report && !loading && !error && apiOnline && (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Lock size={26} className="text-dim" />
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t('inspector idle')}</p>
            <p className="max-w-md text-[12px] leading-relaxed text-dim">
              {t('Submit a URL above. The API follows redirects, captures headers, reads the certificate and extracts page metadata, then scores eight hardening headers.')}
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}

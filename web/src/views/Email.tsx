import { useEffect, useState } from 'react';
import { Download, Mail, Play, ServerCog, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge, Busy, CopyButton, ErrorState, Gauge, Panel, SectionTitle, Terminal } from '../components/ui';
import { toast } from '../components/toast';
import { auditEmail, type EmailCheck, type EmailReport } from '../lib/email';
import { checkSMTP } from '../lib/net';
import { combinedDig } from '../lib/dig';
import { cn, downloadFile } from '../lib/format';
import { emailDetail, useT } from '../lib/i18n';

const NEXT_STEPS: Record<string, string> = {
  spf: 'Publish exactly one SPF record that covers every sending service.',
  dkim: 'Verify the selector — common values are google, s1, mail, or the one issued by your ESP.',
  dmarc: 'Tighten the policy to p=quarantine or p=reject once alignment is clean.',
  'mta-sts': 'Publish a policy file at mta-sts.<domain> and reference it from the DNS record.',
  'tls-rpt': 'Add a TLS-RPT record so senders report failed TLS handshakes.',
  bimi: 'Optional: publish a BIMI record with an SVG logo and VMC.',
};

const statusTone = (status: 'pass' | 'warn' | 'fail') =>
  status === 'pass' ? ('good' as const) : status === 'warn' ? ('warn' as const) : ('bad' as const);

const statusIcon = (status: 'pass' | 'warn' | 'fail') =>
  status === 'pass' ? ShieldCheck : status === 'warn' ? ShieldAlert : ShieldAlert;

export function Email() {
  const t = useT();
  const [domain, setDomain] = useState('');
  const [selector, setSelector] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<EmailReport | null>(null);
  const [digOpen, setDigOpen] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('25');
  const [smtp, setSmtp] = useState<any>(null);
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [smtpLoading, setSmtpLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams((window.location.hash.split('?')[1] || '').replace(/^\?/, ''));
    const preset = params.get('domain');
    if (preset) {
      setDomain(preset);
      setSelector(params.get('selector') || 'default');
      void auditEmail(preset, params.get('selector') || 'default')
        .then((result) => {
          setReport(result);
          setSmtpHost(result.mx[0] || `mail.${result.domain}`);
        })
        .catch((reason: Error) => setError(reason.message));
    }
  }, []);

  async function run() {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await auditEmail(domain, selector);
      setReport(result);
      if (!smtpHost) setSmtpHost(result.mx[0] || `mail.${result.domain}`);
    } catch (reason) {
      setError((reason as Error).message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function probeSmtp() {
    if (!smtpHost.trim()) return;
    setSmtpLoading(true);
    setSmtpError(null);
    try {
      const result = await checkSMTP(smtpHost.trim(), Number(smtpPort) || 25, 'auto');
      setSmtp(result);
    } catch (reason) {
      setSmtpError((reason as Error).message);
      setSmtp(null);
    } finally {
      setSmtpLoading(false);
    }
  }

  const passed = report ? report.checks.filter((check) => check.status === 'pass').length : 0;
  const transcript = report ? combinedDig(report.results) : '';

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="mail"
        title="Email authentication"
        right={<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{t('spf · dkim · dmarc · mta-sts · bimi')}</span>}
      />

      <Panel ticked label="domain" title="Audit a sending domain">
        <form
          className="flex flex-col gap-2 lg:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <input
            className="input flex-1 text-[14px]"
            placeholder={t('example.com')}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            <span className="label whitespace-nowrap">{t('dkim selector')}</span>
            <input
              className="input w-28"
              value={selector}
              onChange={(event) => setSelector(event.target.value)}
              spellCheck={false}
            />
          </div>
          <button className="btn btn-primary px-6" disabled={loading}>
            <Play size={11} /> {loading ? t('Scanning') : t('Run scan')}
          </button>
        </form>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
          {t('Checks are performed by resolving TXT records over DoH. NetScope never sends test messages, credentials or addresses.')}
        </p>
      </Panel>

      {loading && (
        <Panel>
          <Busy label={t('Resolving SPF, DKIM, DMARC, MTA-STS, TLS-RPT and BIMI')} />
        </Panel>
      )}

      {error && <ErrorState message={error} hint={t('Use a bare domain like example.com, not an email address.')} />}

      {report && !loading && (
        <>
          <div className="grid gap-3 lg:grid-cols-12">
            <Panel className="lg:col-span-4" label="posture" title="Authentication score" ticked>
              <div className="flex items-center gap-5">
                <Gauge score={report.score} grade={report.grade} size={126} />
                <div className="min-w-0">
                  <p className="font-mono text-[12px] text-ink">{report.domain}</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                    {t('{passed} of {total} checks passing', { passed, total: report.checks.length })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={report.hasMx ? 'good' : 'bad'}>{report.hasMx ? t('mx present') : t('no mx')}</Badge>
                    <Badge tone="mute">{report.elapsedMs} ms</Badge>
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-2 border-t border-line pt-3">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                  <span>{t('mx targets')}</span>
                  <span>{report.mx.length}</span>
                </div>
                {report.mx.length ? (
                  report.mx.map((host) => (
                    <p key={host} className="truncate font-mono text-[11px] text-muted">
                      {host}
                    </p>
                  ))
                ) : (
                  <p className="text-[11px] text-dim">{t('No MX records — this domain may not receive mail.')}</p>
                )}
              </div>

              <div className="mt-5 border-t border-line pt-3">
                <p className="label mb-2">{t('next actions')}</p>
                {report.checks.filter((check) => check.status !== 'pass').length === 0 ? (
                  <p className="text-[11px] leading-relaxed text-acid/80">
                    {t('All checks pass. Keep keys rotated and monitor DMARC reports.')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {report.checks
                      .filter((check) => check.status !== 'pass')
                      .map((check) => (
                        <li key={check.id} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
                          <span className="mt-1.5 h-1 w-1 shrink-0 bg-amber" />
                          <span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink">{check.name}</span>
                            {' — '}
                            {t(NEXT_STEPS[check.id] || '') || emailDetail(check.detail, t)}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="mt-5 border-t border-line pt-3">
                <div className="flex items-center justify-between">
                  <p className="label">{t('weighting')}</p>
                  <span className="font-mono text-[9px] text-dim">{t('100 pts')}</span>
                </div>
                <div className="mt-2 flex h-1.5 gap-px overflow-hidden">
                  {report.checks.map((check) => (
                    <span
                      key={check.id}
                      title={`${check.name} ${check.weight} pts`}
                      style={{ width: `${check.weight}%` }}
                      className={cn(
                        check.earned === check.weight ? 'bg-acid/70' : check.earned > 0 ? 'bg-amber/70' : 'bg-danger/50',
                      )}
                    />
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
                  {report.checks.map((check) => (
                    <span key={check.id}>
                      {check.name} <span className="text-muted">{check.weight}</span>
                    </span>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel className="lg:col-span-8" label="checks" title="Record matrix" flush>
              <ul className="divide-y divide-line">
                {report.checks.map((check) => {
                  const Icon = statusIcon(check.status);
                  return (
                    <li key={check.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <Icon
                          size={14}
                          className={cn(
                            'mt-0.5 shrink-0',
                            check.status === 'pass' ? 'text-acid' : check.status === 'warn' ? 'text-amber' : 'text-danger',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">{check.name}</span>
                            <Badge tone={statusTone(check.status)}>{check.status}</Badge>
                            <span className="font-mono text-[9px] text-dim">
                              {check.earned}/{check.weight} pts
                            </span>
                          </div>
                          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{emailDetail(check.detail, t)}</p>
                          {check.records.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {check.records.slice(0, 2).map((record) => (
                                <p
                                  key={record}
                                  className="break-all border-l border-line bg-inset px-2 py-1 font-mono text-[10px] leading-relaxed text-dim"
                                >
                                  {record}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        {check.records[0] && <CopyButton value={check.records[0]} label="" />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>

          <Panel
            label="transcript"
            title="Combined dig output"
            flush
            actions={
              <>
                <button type="button" className="btn btn-quiet h-7 px-2 py-0 text-[9px]" onClick={() => setDigOpen((open) => !open)}>
                  {digOpen ? t('Hide') : t('Show')}
                </button>
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  onClick={() => {
                    downloadFile(`email-dns-${report.domain}.txt`, transcript, 'text/plain');
                    toast(t('Transcript saved'), 'good');
                  }}
                  aria-label={t('Download dig transcript')}
                >
                  <Download size={12} />
                </button>
              </>
            }
          >
            {digOpen ? (
              <Terminal content={transcript} title={t('dig · combined')} maxHeight={420} />
            ) : (
              <p className="px-4 py-3 text-[11.5px] text-dim">
                {t('{n} DNS lookups · expand for the raw dig transcript.', { n: report.results.length })}
              </p>
            )}
          </Panel>
        </>
      )}

      {!report && !loading && !error && (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Mail size={26} className="text-dim" />
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t('audit idle')}</p>
            <p className="max-w-md text-[12px] leading-relaxed text-dim">
              {t('Enter a domain to score its SPF, DKIM, DMARC, MTA-STS, TLS-RPT and BIMI records on a 0–100 scale.')}
            </p>
            <button
              type="button"
              className="chip mt-1"
              onClick={() => {
                setDomain('cloudflare.com');
                void run();
              }}
            >
              {t('try cloudflare.com')}
            </button>
          </div>
        </Panel>
      )}

      <Panel
        label="smtp probe"
        title="Mail server handshake"
        actions={
          <Badge tone="mute" dot>
            {t('requires api')}
          </Badge>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto]">
          <input
            className="input"
            placeholder={smtpHost || 'mail.example.com'}
            value={smtpHost}
            onChange={(event) => setSmtpHost(event.target.value)}
            spellCheck={false}
          />
          <input
            className="input"
            placeholder="25"
            value={smtpPort}
            onChange={(event) => setSmtpPort(event.target.value)}
            spellCheck={false}
          />
          <button type="button" className="btn btn-ghost" onClick={probeSmtp} disabled={smtpLoading}>
            <ServerCog size={12} /> {smtpLoading ? t('Connecting') : t('Probe')}
          </button>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">
          {t('Reads the banner, EHLO capabilities and STARTTLS certificate. No credentials or messages are sent. Needs the Flask inspector API — configure it in Settings.')}
        </p>

        {smtpError && (
          <div className="mt-3">
            <ErrorState message={smtpError} />
          </div>
        )}

        {smtp && (
          <div className="mt-3 space-y-2 border border-line bg-inset p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={smtp.reachable ? 'good' : 'bad'}>{smtp.reachable ? t('reachable') : t('unreachable')}</Badge>
              {smtp.tls?.version && <Badge tone="info">{smtp.tls.version}</Badge>}
              {smtp.elapsed_ms !== undefined && <span className="font-mono text-[10px] text-dim">{smtp.elapsed_ms} ms</span>}
            </div>
            <p className="break-all font-mono text-[10.5px] text-muted">{smtp.banner || t('No banner returned.')}</p>
            {Array.isArray(smtp.capabilities) && smtp.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {smtp.capabilities.map((cap: string) => (
                  <span key={cap} className="border border-line px-1.5 py-0.5 font-mono text-[9px] text-dim">
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

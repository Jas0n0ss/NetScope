import { useEffect, useState } from 'react';
import { ChevronDown, Download, ExternalLink, Globe2, MapPin, Radar, Search } from 'lucide-react';
import { Badge, Busy, CopyButton, ErrorState, GeoPlot, KVGrid, Panel, SectionTitle } from '../components/ui';
import { toast } from '../components/toast';
import { lookupIP, rdapLookup } from '../lib/net';
import { addHistory } from '../lib/store';
import { fmtDate, fmtDateTime, daysBetween, downloadFile, orDash, cn } from '../lib/format';
import type { IPInfo, RdapResult } from '../lib/types';
import { useT } from '../lib/i18n';

const PRESETS = ['1.1.1.1', '8.8.8.8', 'github.com', 'cloudflare.com'];

export function Lookup() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<IPInfo | null>(null);
  const [rdap, setRdap] = useState<RdapResult | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  useEffect(() => {
    const onQuick = (event: Event) => {
      const target = (event as CustomEvent<{ target: string }>).detail?.target;
      if (target) {
        setQuery(target);
        void run(target);
      }
    };
    window.addEventListener('netscope:lookup', onQuick);
    return () => window.removeEventListener('netscope:lookup', onQuick);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams((window.location.hash.split('?')[1] || '').replace(/^\?/, ''));
    const preset = params.get('q');
    if (preset) {
      setQuery(preset);
      void run(preset);
    }
  }, []);

  async function run(target = query) {
    const value = target.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    setRawOpen(false);
    try {
      const info = await lookupIP(value);
      setGeo(info);
      setRdap(null);
      const kind: 'domain' | 'ip' = info.resolvedFrom ? 'domain' : 'ip';
      addHistory({
        target: value,
        kind,
        ip: info.ip,
        country: info.country,
        countryCode: info.countryCode,
        city: info.city,
        at: Date.now(),
      });
      rdapLookup(kind, kind === 'domain' ? info.resolvedFrom! : info.ip)
        .then(setRdap)
        .catch(() => setRdap(null));
    } catch (reason) {
      setError((reason as Error).message);
      setGeo(null);
      setRdap(null);
    } finally {
      setLoading(false);
    }
  }

  const expiresIn = rdap ? daysBetween(rdap.events.expiration) : null;
  const payload = { ip: geo, rdap };

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="intelligence"
        title="Address intelligence"
        right={
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
            {t('geolocation · rdap registry')}
          </span>
        }
      />

      <Panel ticked label="target" title="Resolve an IP or domain">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <input
              className="input pl-9 text-[14px]"
              placeholder={t('1.1.1.1 · github.com · https://example.com/path')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button className="btn btn-primary px-6" disabled={loading}>
            {loading ? t('Resolving') : t('Lookup')}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="label">{t('presets')}</span>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip"
              onClick={() => {
                setQuery(preset);
                void run(preset);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      </Panel>

      {loading && (
        <Panel>
          <Busy label={t('Geolocating address and querying RDAP registry')} />
        </Panel>
      )}

      {error && <ErrorState message={error} hint={t('Private, loopback and reserved addresses have no public geolocation.')} />}

      {geo && !loading && (
        <>
          <div className="grid gap-3 lg:grid-cols-12">
            <Panel
              ticked
              className="lg:col-span-7"
              label="geolocation"
              title={geo.ip}
              actions={<CopyButton value={geo.ip} />}
              bodyClassName="p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <p className="label mb-2">{t('location')}</p>
                  <h3 className="text-[22px] leading-tight text-ink">
                    {[geo.city, geo.region].filter(Boolean).join(', ') || t('Unknown city')}
                  </h3>
                  <p className="mt-1.5 text-[12.5px] text-muted">{geo.country || t('Unknown country')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-16 items-center justify-center border border-line bg-raise/40 font-mono text-[15px] text-acid">
                    {geo.countryCode || '??'}
                  </span>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                    <p>{geo.type}</p>
                    <p className="mt-1">{geo.source}</p>
                  </div>
                </div>
              </div>

              {(geo.latitude !== null || geo.longitude !== null) && (
                <div className="mt-5 flex items-center justify-between border border-line bg-inset px-3 py-2.5">
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
                    <MapPin size={12} className="text-acid" />
                    {orDash(geo.latitude?.toFixed(4))}, {orDash(geo.longitude?.toFixed(4))}
                  </div>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${geo.latitude}&mlon=${geo.longitude}#map=11/${geo.latitude}/${geo.longitude}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-acid/80 hover:text-acid"
                  >
                    <Globe2 size={11} /> open map
                  </a>
                </div>
              )}

              <KVGrid
                className="mt-4"
                rows={[
                  { label: 'City', value: orDash(geo.city) },
                  { label: 'Region', value: orDash(geo.region) },
                  { label: 'Postal', value: orDash(geo.postal) },
                  { label: 'Country code', value: orDash(geo.countryCode), mono: true },
                  { label: 'ISP', value: orDash(geo.isp), full: true },
                  { label: 'Organization', value: orDash(geo.org), full: true },
                  { label: 'ASN', value: geo.asn ? `AS${geo.asn}` : '—', mono: true },
                  { label: 'Timezone', value: geo.timezone.id || '—', mono: true },
                ]}
              />

              {geo.latitude !== null && geo.longitude !== null && (
                <GeoPlot lat={geo.latitude} lon={geo.longitude} className="mt-4 h-32" />
              )}
            </Panel>

            <div className="space-y-3 lg:col-span-5">
              <Panel
                label="registry"
                title={rdap ? rdap.name : 'RDAP record'}
                actions={rdap?.selfLink ? <a className="btn btn-ghost h-7 gap-1 px-2 py-0 text-[9px]" href={rdap.selfLink} target="_blank" rel="noreferrer">rdap <ExternalLink size={9} /></a> : undefined}
              >
                {!rdap && (
                  <p className="font-mono text-[11px] leading-relaxed text-dim">
                    {t('No registry record returned for this target. Private addresses, single hosts and tiny TLDs often have none.')}
                  </p>
                )}
                {rdap && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-1.5">
                      {rdap.statuses.length ? (
                        rdap.statuses.slice(0, 6).map((status) => (
                          <Badge key={status} tone="mute">
                            {status.replace(/([A-Z])/g, ' $1').trim()}
                          </Badge>
                        ))
                      ) : (
                        <Badge tone="mute">{t('no status flags')}</Badge>
                      )}
                      {rdap.dnssec && <Badge tone={rdap.dnssec === 'Signed' ? 'good' : 'warn'}>dnssec {rdap.dnssec}</Badge>}
                    </div>

                    {rdap.kind === 'domain' && (
                      <div className="space-y-2.5">
                        {[
                          { label: 'registered', value: rdap.events.registration },
                          { label: 'expires', value: rdap.events.expiration },
                          { label: 'last changed', value: rdap.events['last changed'] || rdap.events['last update'] },
                        ]
                          .filter((row) => row.value)
                          .map((row) => (
                            <div key={row.label} className="flex items-baseline justify-between border-b border-line pb-2">
                              <span className="label">{t(row.label)}</span>
                              <span className="text-right">
                                <span className="block font-mono text-[11px] text-ink">{fmtDate(row.value)}</span>
                                <span className="mt-0.5 block text-[10px] text-dim">{fmtDateTime(row.value)}</span>
                              </span>
                            </div>
                          ))}
                        {expiresIn !== null && (
                          <div className="pt-1">
                            <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em]">
                              <span className="text-dim">{t('until expiry')}</span>
                              <span className={cn(expiresIn < 30 ? 'text-danger' : expiresIn < 90 ? 'text-amber' : 'text-acid')}>
                                {t('{n} days', { n: expiresIn })}
                              </span>
                            </div>
                            <div className="h-1 bg-line">
                              <div
                                className={cn('h-1', expiresIn < 30 ? 'bg-danger' : expiresIn < 90 ? 'bg-amber' : 'bg-acid')}
                                style={{ width: `${Math.max(2, Math.min(100, (expiresIn / 365) * 100))}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {rdap.kind === 'ip' && (
                      <KVGrid
                        rows={[
                          { label: 'Range', value: orDash(rdap.range), full: true, mono: true },
                          { label: 'Handle', value: orDash(rdap.handle), mono: true },
                          { label: 'Country', value: orDash(rdap.country), mono: true },
                        ]}
                      />
                    )}

                    {(rdap.registrar || rdap.abuseEmail) && (
                      <div className="space-y-1.5 border-t border-line pt-3">
                        {rdap.registrar && (
                          <div className="flex justify-between gap-4">
                            <span className="label">{t('registrar')}</span>
                            <span className="text-right text-[11.5px] text-ink">{rdap.registrar}</span>
                          </div>
                        )}
                        {rdap.abuseEmail && (
                          <div className="flex justify-between gap-4">
                            <span className="label">{t('abuse')}</span>
                            <span className="text-right font-mono text-[11px] text-muted">{rdap.abuseEmail}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {rdap.nameservers.length > 0 && (
                      <div className="border-t border-line pt-3">
                        <p className="label mb-2">{t('nameservers')}</p>
                        <ul className="space-y-1">
                          {rdap.nameservers.slice(0, 5).map((server) => (
                            <li key={server} className="truncate font-mono text-[11px] text-muted">
                              {server}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </Panel>

              {geo.resolvedFrom && (
                <Panel label="resolution" title="DNS chain">
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="flex-1 truncate border border-line px-2 py-1.5 text-ink">{geo.resolvedFrom}</span>
                    <span className="text-acid">→</span>
                    <span className="flex-1 truncate border border-line px-2 py-1.5 text-ink">{geo.ip}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-dim">{t('Resolved via {type} record, then geolocated.', { type: geo.resolvedRecord || 'A' })}</p>
                </Panel>
              )}
            </div>
          </div>

          <Panel
            label="raw payload"
            title="JSON output"
            flush
            actions={
              <>
                <CopyButton value={JSON.stringify(payload, null, 2)} />
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  onClick={() => {
                    downloadFile('netscope-lookup.json', JSON.stringify(payload, null, 2));
                    toast(t('JSON exported'), 'good');
                  }}
                  aria-label={t('Download JSON')}
                >
                  <Download size={12} />
                </button>
                <button type="button" className="icon-btn h-7 w-7" onClick={() => setRawOpen((open) => !open)} aria-label={t('Toggle raw JSON')}>
                  <ChevronDown size={13} className={cn('transition-transform', rawOpen && 'rotate-180')} />
                </button>
              </>
            }
          >
            {rawOpen ? (
              <pre className="max-h-[360px] overflow-auto bg-inset p-4 font-mono text-[11px] leading-relaxed text-muted">
                {JSON.stringify(payload, null, 2)}
              </pre>
            ) : (
              <p className="px-4 py-3 text-[11.5px] text-dim">{t('Expand to inspect the full normalized payload.')}</p>
            )}
          </Panel>
        </>
      )}

      {!geo && !loading && !error && (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Radar size={26} className="text-dim" />
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t('awaiting target')}</p>
            <p className="max-w-sm text-[12px] leading-relaxed text-dim">
              {t('Enter an address or domain above. Domains are resolved through DoH first, then the resulting address is geolocated and matched against RDAP.')}
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}

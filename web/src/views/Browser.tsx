import { useEffect, useMemo, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { Badge, CopyButton, KVGrid, Panel, SectionTitle, Terminal } from '../components/ui';
import { parseUserAgent } from '../lib/tools';
import { localClock } from '../lib/format';
import { useT } from '../lib/i18n';

function webglRenderer(): string {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!context) return 'unavailable';
    const info = context.getExtension('WEBGL_debug_renderer_info');
    const value = info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
    return String(value || 'unavailable');
  } catch {
    return 'blocked';
  }
}

export function Browser() {
  const t = useT();
  const ua = useMemo(() => parseUserAgent(), []);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [clock, setClock] = useState(() => localClock());

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const timer = window.setInterval(() => setClock(localClock()), 1000);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearInterval(timer);
    };
  }, []);

  const nav = navigator as any;
  const memory = nav.deviceMemory;
  const cores = nav.hardwareConcurrency;
  const renderer = useMemo(webglRenderer, []);
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  const flags = [
    { label: t('cookies'), value: navigator.cookieEnabled ? t('on') : t('off') },
    { label: 'DNT', value: nav.doNotTrack === '1' ? t('set') : t('unset') },
    { label: 'GPC', value: nav.globalPrivacyControl ? t('set') : t('unset') },
    { label: t('service worker'), value: 'serviceWorker' in navigator ? t('yes') : t('no') },
    { label: 'WebGPU', value: 'gpu' in navigator ? t('yes') : t('no') },
    { label: t('pdf viewer'), value: nav.pdfViewerEnabled ? t('yes') : t('no') },
  ];

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="client"
        title="Client signals"
        right={<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{t('fingerprint surface · live')}</span>}
      />

      <Panel ticked label="device" title="Session identity">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="label mb-2">{t('user agent')}</p>
            <h3 className="font-mono text-[15px] text-ink">
              {ua.browser} {ua.browserVersion}
              <span className="text-dim"> · </span>
              {ua.os} {ua.osVersion}
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="info">{ua.engine}</Badge>
              <Badge tone="mute">{ua.deviceType}</Badge>
              <Badge tone={connection.effectiveType === '4g' ? 'good' : 'warn'}>{connection.effectiveType?.toUpperCase() || t('network ?')}</Badge>
              <Badge tone={navigator.onLine ? 'good' : 'bad'}>{navigator.onLine ? t('online') : t('offline')}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center border border-line bg-raise/40 text-acid">
              <MonitorSmartphone size={20} />
            </span>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              <p>{viewport.width} × {viewport.height}</p>
              <p className="mt-1">{window.devicePixelRatio}× dpr</p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          {[
            { label: t('local time'), value: clock.time },
            { label: t('timezone'), value: clock.offset || 'utc' },
            { label: t('language'), value: navigator.language },
            { label: t('platform'), value: nav.userAgentData?.platform || navigator.platform || '—' },
          ].map((item) => (
            <div key={item.label} className="bg-panel px-3 py-2.5">
              <p className="label">{item.label}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-ink" title={item.value}>
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Terminal content={navigator.userAgent} title="navigator.userAgent" maxHeight={120} actions={<CopyButton value={navigator.userAgent} />} />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel className="lg:col-span-4" label="display" title="Screen & viewport">
          <KVGrid
            stacked
            rows={[
              { label: t('Viewport'), value: `${viewport.width} × ${viewport.height}`, mono: true },
              { label: t('Screen'), value: `${screen.width} × ${screen.height}`, mono: true },
              { label: t('Available'), value: `${screen.availWidth} × ${screen.availHeight}`, mono: true },
              { label: t('Pixel ratio'), value: `${window.devicePixelRatio}×`, mono: true },
              { label: t('Color depth'), value: `${screen.colorDepth}-bit`, mono: true },
              { label: t('Touch points'), value: String(navigator.maxTouchPoints), mono: true },
              { label: t('Orientation'), value: screen.orientation?.type || '—', mono: true },
              { label: t('Color scheme'), value: window.matchMedia('(prefers-color-scheme: dark)').matches ? t('dark') : t('light'), mono: true },
            ]}
          />
        </Panel>

        <Panel className="lg:col-span-4" label="hardware" title="Compute & memory">
          <KVGrid
            stacked
            rows={[
              { label: t('CPU threads'), value: cores ? String(cores) : '—', mono: true },
              { label: t('Device memory'), value: memory ? `≥ ${memory} GB` : '—', mono: true },
              { label: t('GPU renderer'), value: renderer },
              { label: t('Session storage'), value: 'sessionStorage' in window ? t('available') : t('no'), mono: true },
              { label: t('Local storage'), value: 'localStorage' in window ? t('available') : t('no'), mono: true },
              { label: t('IndexedDB'), value: 'indexedDB' in window ? t('available') : t('no'), mono: true },
            ]}
          />
        </Panel>

        <Panel className="lg:col-span-4" label="privacy" title="Exposure flags">
          <KVGrid stacked rows={flags.map((flag) => ({ label: flag.label, value: flag.value, mono: true }))} />
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            {t('Every value here is readable by any site you visit. Reducing resolution, blocking third-party storage and using a privacy browser lowers this surface.')}
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel className="lg:col-span-7" label="languages" title="Locale preferences" flush>
          <ul className="divide-y divide-line">
            {(navigator.languages || [navigator.language]).map((language, index) => (
              <li key={language} className="flex items-center justify-between px-4 py-2.5">
                <span className="font-mono text-[11px] text-ink">{language}</span>
                <Badge tone={index === 0 ? 'good' : 'mute'}>{index === 0 ? t('primary') : `#${index + 1}`}</Badge>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="lg:col-span-5" label="network" title="Reported link">
          <KVGrid
            stacked
            rows={[
              { label: t('Effective type'), value: String(connection.effectiveType || '—').toUpperCase(), mono: true },
              { label: t('Downlink'), value: connection.downlink ? `${connection.downlink} Mb/s` : '—', mono: true },
              { label: t('RTT estimate'), value: connection.rtt ? `${connection.rtt} ms` : '—', mono: true },
              { label: t('Save data'), value: connection.saveData ? t('on') : t('off'), mono: true },
              { label: t('Online'), value: navigator.onLine ? t('yes') : t('no'), mono: true },
              { label: t('Timezone'), value: Intl.DateTimeFormat().resolvedOptions().timeZone, mono: true },
            ]}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            {t('These hints are self-reported by the browser and can be inaccurate behind VPNs or proxies.')}
          </p>
        </Panel>
      </div>
    </div>
  );
}

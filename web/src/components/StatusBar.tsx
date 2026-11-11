import { useT } from '../lib/i18n';

export function StatusBar({ apiOnline }: { apiOnline: boolean }) {
  const t = useT();
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 flex h-7 items-center justify-between gap-4 border-t border-line bg-void/95 px-4 font-mono text-[9px] uppercase tracking-[0.14em] text-dim backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-4 overflow-hidden">
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className="led bg-acid" /> {t('doh · cloudflare')}
        </span>
        <span className="hidden items-center gap-1.5 md:flex">{t('zero cookies')}</span>
        <span className="hidden items-center gap-1.5 lg:flex">{t('no trackers')}</span>
        <span className="flex items-center gap-1.5">
          <span className={apiOnline ? 'led bg-acid' : 'led bg-dim'} />
          {t(apiOnline ? 'inspector api' : 'static mode')}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="hidden sm:inline">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        <span>v2.0.0</span>
      </div>
    </footer>
  );
}

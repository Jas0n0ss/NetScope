import { useEffect, useState } from 'react';
import { Command, Menu, Moon, Settings2, Sun } from 'lucide-react';
import { localClock } from '../lib/format';
import type { ViewMeta } from '../lib/views';
import { useLang, useT, toggleLang } from '../lib/i18n';
import { useResolvedTheme, toggleTheme } from '../lib/theme';

export function TopBar({
  view,
  ip,
  apiOnline,
  onOpenMenu,
  onOpenPalette,
  onOpenSettings,
}: {
  view: ViewMeta;
  ip: string | null;
  apiOnline: boolean;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const theme = useResolvedTheme();
  const [clock, setClock] = useState(() => localClock());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(localClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b border-line bg-void/85 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" className="icon-btn -ml-1 lg:hidden" onClick={onOpenMenu} aria-label={t('Open navigation')}>
          <Menu size={17} />
        </button>
        <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
          <span className="hidden sm:inline">netscope</span>
          <span className="hidden text-dim/40 sm:inline">/</span>
          <span className="hidden sm:inline">{t(view.group)}</span>
          <span className="hidden text-dim/40 sm:inline">/</span>
          <span className="truncate text-muted">{t(view.label)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3">
        <div
          className="hidden items-center gap-2 border border-line bg-raise/40 px-2.5 py-1.5 sm:flex"
          title={ip ? t('Public IP {ip}', { ip }) : t('Resolving public IP')}
        >
          <span className="label !text-[9px]">{t('exit')}</span>
          <span className="font-mono text-[11px] text-ink">{ip ?? '····'}</span>
        </div>

        <div className="hidden items-center gap-2 border border-line bg-raise/40 px-2.5 py-1.5 md:flex">
          <span className="led bg-acid/80" />
          <span className="font-mono text-[11px] tabular-nums text-muted">{clock.time}</span>
          <span className="label !text-[9px]">{clock.offset || t('local')}</span>
        </div>

        <div
          className="hidden items-center gap-1.5 border border-line px-2 py-1.5 xl:flex"
          title={t(apiOnline ? 'Inspector API reachable' : 'No inspector API configured')}
        >
          <span className={apiOnline ? 'led bg-acid' : 'led bg-dim'} />
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">
            {t(apiOnline ? 'api' : 'static')}
          </span>
        </div>

        <button
          type="button"
          className="icon-btn w-auto gap-1 px-1.5 font-mono text-[10px] tracking-[0.08em]"
          onClick={() => toggleLang()}
          aria-label={t('Switch language')}
          title={t('Switch language')}
        >
          {lang === 'zh' ? '中' : 'EN'}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => toggleTheme()}
          aria-label={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
          title={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button type="button" className="icon-btn" onClick={onOpenPalette} aria-label={t('Command palette')}>
          <Command size={15} />
        </button>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label={t('Settings')}>
          <Settings2 size={15} />
        </button>
      </div>
    </header>
  );
}

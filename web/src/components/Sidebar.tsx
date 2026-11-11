import { Command, Settings2, X } from 'lucide-react';
import { cn } from '../lib/format';
import { GROUPS, VIEWS, type ViewId } from '../lib/views';
import { useT } from '../lib/i18n';

function Mark() {
  return (
    <span className="relative flex h-9 w-9 items-center justify-center border border-acid/40 bg-acid/[0.07]">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="7.5" stroke="#b8f24a" strokeWidth="1.2" opacity="0.55" />
        <circle cx="10" cy="10" r="3" stroke="#b8f24a" strokeWidth="1.4" />
        <path d="M10 0v4M10 16v4M0 10h4M16 10h4" stroke="#b8f24a" strokeWidth="1.2" />
        <circle cx="10" cy="10" r="0.9" fill="#b8f24a" />
      </svg>
    </span>
  );
}

export function Sidebar({
  active,
  onNavigate,
  open,
  onClose,
  apiOnline,
  onOpenPalette,
  onOpenSettings,
}: {
  active: ViewId;
  onNavigate: (id: ViewId) => void;
  open: boolean;
  onClose: () => void;
  apiOnline: boolean;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-line bg-void/95 backdrop-blur-md transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label={t('Primary navigation')}
      >
        <div className="flex items-center justify-between px-4 pb-5 pt-5">
          <a
            href="#/overview"
            onClick={() => onNavigate('overview')}
            className="group flex items-center gap-3"
            aria-label={t('NetScope home')}
          >
            <Mark />
            <span className="leading-tight">
              <span className="block font-mono text-[13px] tracking-[0.22em] text-ink">NETSCOPE</span>
              <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.16em] text-dim">
                {t('network toolbox')}
              </span>
            </span>
          </a>
          <button type="button" className="icon-btn lg:hidden" onClick={onClose} aria-label={t('Close navigation')}>
            <X size={15} />
          </button>
        </div>

        <div className="mx-4 mb-4 flex items-center gap-2 border border-line bg-raise/30 px-2.5 py-1.5">
          <span className="led animate-pulseDot bg-acid shadow-[0_0_8px_rgba(184,242,74,0.7)]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
            {t(apiOnline ? 'inspector api online' : 'client-side mode')}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto pb-4">
          {GROUPS.map((group) => (
            <div key={group.id} className="mb-4">
              <p className="label px-4 pb-2">{t(group.label)}</p>
              <ul>
                {VIEWS.filter((view) => view.group === group.id).map((view) => {
                  const Icon = view.icon;
                  const isActive = active === view.id;
                  return (
                    <li key={view.id}>
                      <a
                        href={`#/${view.id}`}
                        onClick={() => onNavigate(view.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'group relative flex items-center gap-3 border-l-2 px-4 py-2.5 transition-colors',
                          isActive
                            ? 'border-acid bg-acid/[0.06] text-ink'
                            : 'border-transparent text-muted hover:border-edge hover:bg-white/[0.02] hover:text-ink',
                        )}
                      >
                        <Icon size={15} className={cn('shrink-0', isActive ? 'text-acid' : 'text-dim group-hover:text-muted')} />
                        <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.1em]">{t(view.label)}</span>
                        <span
                          className={cn(
                            'font-mono text-[9px]',
                            isActive ? 'text-acid/70' : 'text-dim/60',
                          )}
                        >
                          {view.key}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={onOpenPalette}
            className="flex w-full items-center justify-between border border-line bg-raise/30 px-2.5 py-2 text-muted transition-colors hover:border-edge hover:text-ink"
          >
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
              <Command size={12} />
              {t('Command palette')}
            </span>
            <kbd className="border border-edge px-1.5 py-0.5 font-mono text-[9px] text-dim">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-1.5 flex w-full items-center gap-2 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim transition-colors hover:text-ink"
          >
            <Settings2 size={12} />
            {t('Settings')}
          </button>
          <div className="mt-2 flex items-center justify-between px-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-dim/70">
            <span>v2.0.0</span>
            <span>{t('local-first')}</span>
          </div>
        </div>
      </aside>
    </>
  );
}

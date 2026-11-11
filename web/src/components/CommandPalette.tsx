import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, Terminal } from 'lucide-react';
import { cn } from '../lib/format';
import { VIEWS, type ViewId } from '../lib/views';
import { useT } from '../lib/i18n';

export type PaletteAction = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (id: ViewId) => void;
  actions: PaletteAction[];
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const viewItems = VIEWS.filter(
      (view) => !q || [view.label, t(view.label), view.id, view.description, t(view.description), view.kicker].some((text) => text.toLowerCase().includes(q)),
    ).map((view) => ({
      id: `view:${view.id}`,
      label: t(view.label),
      hint: t(view.description),
      icon: view.icon,
      run: () => onNavigate(view.id),
    }));
    const actionItems = actions
      .filter((action) => !q || action.label.toLowerCase().includes(q))
      .map((action) => ({ ...action, icon: null as any }));
    return [...viewItems, ...actionItems];
  }, [query, actions, onNavigate, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 px-4 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('Command palette')}
    >
      <div className="w-full max-w-[560px] border border-edge bg-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={15} className="text-acid" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, results.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === 'Enter' && results[index]) {
                results[index].run();
                onClose();
              }
            }}
            placeholder={t('Jump to a tool or run an action…')}
            className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-dim/80 focus:outline-none"
          />
          <kbd className="border border-edge px-1.5 py-0.5 font-mono text-[9px] text-dim">esc</kbd>
        </div>

        <ul className="max-h-[64vh] overflow-y-auto p-1.5">
          {results.map((item, itemIndex) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(itemIndex)}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                    itemIndex === index ? 'bg-acid/[0.08] text-ink' : 'text-muted hover:bg-white/[0.03]',
                  )}
                >
                  {Icon ? <Icon size={14} className="text-dim" /> : <Terminal size={14} className="text-dim" />}
                  <span className="flex-1">
                    <span className="block font-mono text-[11px] uppercase tracking-[0.1em]">{item.label}</span>
                    {'hint' in item && item.hint && <span className="mt-0.5 block text-[11px] normal-case tracking-normal text-dim">{item.hint}</span>}
                  </span>
                  {itemIndex === index && <CornerDownLeft size={12} className="text-acid" />}
                </button>
              </li>
            );
          })}
          {!results.length && <li className="px-3 py-6 text-center font-mono text-[11px] text-dim">{t('no matches')}</li>}
        </ul>

        <div className="flex items-center justify-between border-t border-line px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-dim">
          <span>{t('↑↓ navigate · ↵ run')}</span>
          <span>{t('{n} entries', { n: results.length })}</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/format';
import { useT } from '../lib/i18n';

type Tone = 'info' | 'good' | 'warn' | 'bad';
type ToastItem = { id: number; message: string; tone: Tone };

let listeners: ((item: ToastItem) => void)[] = [];
let seed = 0;

export function toast(message: string, tone: Tone = 'info'): void {
  const item = { id: (seed += 1), message, tone };
  listeners.forEach((listener) => listener(item));
}

export function Toaster() {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (item: ToastItem) => {
      setItems((current) => [...current.slice(-3), item]);
      window.setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      }, 3800);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((entry) => entry !== listener);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[80] flex w-[300px] max-w-[calc(100vw-2rem)] flex-col gap-2 sm:bottom-12">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 border bg-panel/95 px-3 py-2.5 shadow-lg backdrop-blur',
            item.tone === 'good' && 'border-acid/40',
            item.tone === 'warn' && 'border-amber/40',
            item.tone === 'bad' && 'border-danger/40',
            item.tone === 'info' && 'border-edge',
          )}
        >
          {item.tone === 'good' ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-acid" />
          ) : item.tone === 'warn' ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />
          ) : item.tone === 'bad' ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-sky" />
          )}
          <p className="flex-1 font-mono text-[11px] leading-relaxed text-ink">{item.message}</p>
          <button
            type="button"
            className="text-dim hover:text-ink"
            onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
            aria-label={t('Dismiss')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

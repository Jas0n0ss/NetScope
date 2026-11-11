import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, Loader2, TriangleAlert } from 'lucide-react';
import { cn, copyText } from '../lib/format';
import { useT } from '../lib/i18n';

/* ------------------------------- panel -------------------------------- */

export function Panel({
  label,
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  ticked = false,
  flush = false,
}: {
  label?: string;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  ticked?: boolean;
  flush?: boolean;
}) {
  const t = useT();
  return (
    <section className={cn('panel', ticked && 'ticked', className)}>
      {(label || title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {label && <p className="label">{t(label)}</p>}
            {title && <div className="mt-1 truncate text-[13px] font-medium text-ink">{typeof title === 'string' ? t(title) : title}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {meta}
            {actions}
          </div>
        </header>
      )}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function SectionTitle({ kicker, title, right }: { kicker?: string; title: string; right?: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div>
        {kicker && <p className="label mb-1.5">{t(kicker)}</p>}
        <h2 className="text-[19px] leading-none text-ink">{t(title)}</h2>
      </div>
      {right && <div className="hidden sm:block">{right}</div>}
    </div>
  );
}

/* ------------------------------- badges ------------------------------- */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'mute';

export function Badge({ tone = 'mute', children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  const t = useT();
  return (
    <span className={cn('badge', `badge-${tone}`)}>
      {dot && <span className={cn('led', tone === 'good' && 'bg-acid', tone === 'warn' && 'bg-amber', tone === 'bad' && 'bg-danger', tone === 'info' && 'bg-sky', tone === 'mute' && 'bg-dim')} />}
      {typeof children === 'string' ? t(children) : children}
    </span>
  );
}

export function StatusDot({ status }: { status: 'pass' | 'warn' | 'fail' | 'idle' }) {
  const tone =
    status === 'pass' ? 'bg-acid shadow-[0_0_8px_rgb(var(--c-acid)/0.8)]' : status === 'warn' ? 'bg-amber' : status === 'fail' ? 'bg-danger' : 'bg-dim';
  return <span className={cn('led', tone)} />;
}

/* ------------------------------- copy --------------------------------- */

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={cn('btn-quiet btn h-7 gap-1.5 border-transparent px-2 py-0 text-[9px]', done && 'text-acid', className)}
      onClick={async () => {
        const ok = await copyText(value);
        setDone(ok);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1400);
      }}
      aria-label={`${t(label)}: ${value}`}
    >
      {done ? <Check size={11} /> : <Copy size={11} />}
      {done ? t('Copied') : t(label)}
    </button>
  );
}

/* -------------------------------- kv ---------------------------------- */

export type Row = { label: string; value: ReactNode; mono?: boolean; full?: boolean; emphasis?: boolean };

export function KVGrid({
  rows,
  className,
  stacked = false,
}: {
  rows: Row[];
  className?: string;
  stacked?: boolean;
}) {
  const t = useT();
  return (
    <div className={cn('kv', className)}>
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className={cn('kv-row', stacked && 'flex-col gap-1', row.full && 'sm:col-span-2')}
        >
          <span className="kv-label">{t(row.label)}</span>
          <span
            className={cn(
              'kv-value',
              stacked && 'text-left',
              !row.mono && 'font-sans text-[12px]',
              row.emphasis && 'text-acid',
            )}
          >
            {row.value ?? '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------- sparkline ------------------------------ */

export function Sparkline({
  values,
  width = 220,
  height = 44,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!values.length) return <div className={cn('h-11', className)} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const span = Math.max(1, range);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const flat = range === 0;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = flat ? height * 0.38 : height - 4 - ((value - min) / span) * (height - 10);
    return [x, y] as const;
  });
  const d = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('w-full', className)} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--c-acid))" stopOpacity="0.22" />
          <stop offset="100%" stopColor="rgb(var(--c-acid))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${d} ${width},${height}`} fill="url(#spark-fill)" />
      <polyline points={d} fill="none" stroke="rgb(var(--c-acid))" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="rgb(var(--c-acid))" />
    </svg>
  );
}

/* -------------------------------- gauge ------------------------------- */

export function GeoPlot({ lat, lon, className }: { lat: number; lon: number; className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden border border-line bg-inset', className)}
      style={{
        backgroundImage:
          'linear-gradient(to right, rgb(var(--c-grid) / 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--c-grid) / 0.06) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-acid/20" />
      <span className="absolute inset-x-0 top-1/2 h-px bg-acid/20" />
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        <span className="absolute h-8 w-8 rounded-full border border-acid/30" />
        <span className="absolute h-14 w-14 rounded-full border border-acid/15" />
        <span className="h-1.5 w-1.5 bg-acid shadow-[0_0_10px_rgb(var(--c-acid)/0.9)]" />
      </span>
      <div className="absolute bottom-0 left-0 flex w-full items-center justify-between px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
        <span className="text-muted">
          {lat.toFixed(3)} / {lon.toFixed(3)}
        </span>
        <span className="text-dim">wgs84 · schematic</span>
      </div>
    </div>
  );
}

export function Gauge({ score, grade, size = 132 }: { score: number; grade: string; size?: number }) {
  const stroke = 3;
  const radius = size / 2 - 6;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const tone = clamped >= 80 ? 'rgb(var(--c-acid))' : clamped >= 55 ? 'rgb(var(--c-amber))' : 'rgb(var(--c-danger))';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--c-line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap="butt"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[26px] leading-none text-ink">{clamped}</span>
        <span className="label mt-1.5">grade {grade}</span>
      </div>
    </div>
  );
}

/* ------------------------------ terminal ------------------------------ */

export function Terminal({
  content,
  title = 'transcript',
  actions,
  maxHeight = 340,
}: {
  content: string;
  title?: string;
  actions?: ReactNode;
  maxHeight?: number;
}) {
  const t = useT();
  return (
    <div className="border border-line bg-inset">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-danger/70" />
            <span className="h-2 w-2 rounded-full bg-amber/70" />
            <span className="h-2 w-2 rounded-full bg-acid/70" />
          </span>
          <span className="label ml-1">{t(title)}</span>
        </div>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <pre className="terminal whitespace-pre text-[10.5px] sm:text-[12px] !border-0" style={{ maxHeight }}>
        {content}
      </pre>
    </div>
  );
}

/* ------------------------------ states -------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={14} className={cn('animate-spin text-acid', className)} />;
}

export function Busy({ label = 'Querying' }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 py-10 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
      <Spinner />
      {t(label)}
      <span className="inline-block h-3 w-1.5 animate-pulseDot bg-acid" />
    </div>
  );
}

export function ErrorState({ message, hint }: { message: string; hint?: string }) {
  const t = useT();
  return (
    <div className="flex items-start gap-3 border border-danger/25 bg-danger/[0.06] px-4 py-3">
      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
      <div>
        <p className="font-mono text-[12px] text-danger">{t(message)}</p>
        {hint && <p className="mt-1 text-[11px] text-muted">{t(hint)}</p>}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-dim">{icon}</div>}
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t(title)}</p>
      {body && <p className="max-w-sm text-[12px] leading-relaxed text-dim">{t(body)}</p>}
    </div>
  );
}

/* -------------------------------- link -------------------------------- */

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-[11px] text-acid/90 underline decoration-acid/30 underline-offset-2 hover:text-acid"
    >
      {children}
      <ChevronRight size={11} />
    </a>
  );
}

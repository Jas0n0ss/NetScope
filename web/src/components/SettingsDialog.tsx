import { useEffect, useState } from 'react';
import { Database, Languages, Monitor, Moon, Server, ShieldCheck, Sun, Trash2, X } from 'lucide-react';
import { healthCheck, invalidateHealthCache } from '../lib/net';
import { getApiBase, setApiBase } from '../lib/store';
import { Badge } from './ui';
import { toast } from './toast';
import { useLang, useT, setLang } from '../lib/i18n';
import { useTheme, setTheme } from '../lib/theme';
import { cn } from '../lib/format';

export function SettingsDialog({
  open,
  onClose,
  apiOnline,
  onChanged,
  onClearData,
}: {
  open: boolean;
  onClose: () => void;
  apiOnline: boolean;
  onChanged: (online: boolean) => void;
  onClearData: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const theme = useTheme();
  const [base, setBase] = useState(getApiBase());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) setBase(getApiBase());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('Settings')}
    >
      <div className="w-full max-w-[520px] border border-edge bg-panel" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="label">{t('configuration')}</p>
            <h2 className="mt-1 text-[14px] text-ink">{t('Settings')}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close settings')}>
            <X size={15} />
          </button>
        </div>

        <div className="space-y-5 p-4">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Server size={13} className="text-acid" />
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{t('Inspector API')}</h3>
              <Badge tone={apiOnline ? 'good' : 'mute'} dot>
                {apiOnline ? t('online') : t('not configured')}
              </Badge>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-muted">
              {t('Website inspection, SMTP probes and TCP port checks need the Flask backend. Everything else runs entirely in this browser. Leave empty for a pure static deploy.')}
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="https://api.example.com"
                value={base}
                onChange={(event) => setBase(event.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={checking}
                onClick={async () => {
                  setApiBase(base);
                  invalidateHealthCache();
                  setChecking(true);
                  const health = await healthCheck(true);
                  setChecking(false);
                  onChanged(health.online);
                  toast(health.online ? t('Inspector API connected') : health.error || t('API unreachable'), health.online ? 'good' : 'bad');
                }}
              >
                {checking ? t('Probing') : t('Test')}
              </button>
            </div>
          </section>

          <div className="rule" />

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Database size={13} className="text-acid" />
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{t('Local data')}</h3>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-muted">
              {t('Lookups and DNS history live in localStorage on this device only. Nothing is uploaded.')}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                onClearData();
                toast(t('Local history cleared'), 'good');
              }}
            >
              <Trash2 size={12} /> {t('Clear history')}
            </button>
          </section>

          <div className="rule" />

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Languages size={13} className="text-acid" />
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{t('Locale preferences')}</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="label mb-1.5">{t('Language')}</p>
                <div className="grid grid-cols-2 gap-px bg-line">
                  {([['zh', '中文'], ['en', 'English']] as const).map(([code, label]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setLang(code)}
                      className={cn(
                        'px-3 py-2 font-mono text-[11px] transition-colors',
                        lang === code ? 'bg-acid/10 text-acid' : 'bg-panel text-muted hover:text-ink',
                      )}
                      aria-pressed={lang === code}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="label mb-1.5">{t('Theme')}</p>
                <div className="grid grid-cols-3 gap-px bg-line">
                  {([['system', 'System', Monitor], ['dark', 'Dark', Moon], ['light', 'Light', Sun]] as const).map(([code, label, Icon]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setTheme(code)}
                      className={cn(
                        'flex items-center justify-center gap-1 whitespace-nowrap px-2 py-2 font-mono text-[10.5px] transition-colors',
                        theme === code ? 'bg-acid/10 text-acid' : 'bg-panel text-muted hover:text-ink',
                      )}
                      aria-pressed={theme === code}
                    >
                      <Icon size={12} /> {t(label)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="rule" />

          <section className="flex items-start gap-2.5 border border-line bg-raise/30 p-3">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-acid" />
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{t('Privacy model')}</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                {t('No analytics, no cookies, no server-side logging. DNS queries go straight to Cloudflare or Google over DoH; geolocation uses public IP databases.')}
              </p>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-dim">
          <span>netscope v2.0.0</span>
          <span>{t('local-first')}</span>
        </div>
      </div>
    </div>
  );
}

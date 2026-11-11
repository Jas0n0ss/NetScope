import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { Toaster, toast } from './components/toast';
import { healthCheck, myAddresses } from './lib/net';
import { clearDnsHistory, clearHistory } from './lib/store';
import { copyText } from './lib/format';
import { VIEWS, viewById, type ViewId } from './lib/views';
import { useT } from './lib/i18n';
import { Overview } from './views/Overview';
import { Lookup } from './views/Lookup';
import { Dns } from './views/Dns';
import { Email } from './views/Email';
import { Website } from './views/Website';
import { Tools } from './views/Tools';
import { Browser } from './views/Browser';

const readHash = (): ViewId => {
  const raw = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (VIEWS.find((view) => view.id === raw)?.id ?? 'overview') as ViewId;
};

export function App() {
  const t = useT();
  const [view, setView] = useState<ViewId>(readHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const [apiOnline, setApiOnline] = useState(false);

  const navigate = useCallback((id: ViewId) => {
    if (window.location.hash !== `#/${id}`) window.history.replaceState(null, '', `#/${id}`);
    setView(id);
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    myAddresses()
      .then((addresses) => setIp(addresses.ipv4 || addresses.ipv6))
      .catch(() => setIp(null));
    healthCheck(true).then((health) => setApiOnline(health.online));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') return;
      if (!typing && /^[1-7]$/.test(event.key)) {
        const next = VIEWS.find((entry) => entry.key === event.key);
        if (next) {
          event.preventDefault();
          navigate(next.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    document.title = `NetScope — ${t(viewById(view).title)}`;
  }, [view]);

  const meta = viewById(view);

  const paletteActions = useMemo(
    () => [
      {
        id: 'copy-ip',
        label: t('Copy public IP'),
        hint: ip ?? t('not resolved yet'),
        run: async () => {
          if (!ip) return toast(t('Public IP not resolved yet'), 'warn');
          const ok = await copyText(ip);
          toast(ok ? t('Copied {value}', { value: ip }) : t('Clipboard unavailable'), ok ? 'good' : 'bad');
        },
      },
      {
        id: 'dns-quick',
        label: t('Resolve cloudflare.com A'),
        hint: t('DNS · DoH'),
        run: () => {
          navigate('dns');
          window.dispatchEvent(new CustomEvent('netscope:dns-quick', { detail: { name: 'cloudflare.com', type: 'A' } }));
        },
      },
      {
        id: 'clear',
        label: t('Clear local history'),
        hint: t('lookups · dns'),
        run: () => {
          clearHistory();
          clearDnsHistory();
          toast(t('Local history cleared'), 'good');
        },
      },
    ],
    [ip, navigate, t],
  );

  const views: Record<ViewId, JSX.Element> = {
    overview: <Overview onNavigate={navigate} />,
    lookup: <Lookup />,
    dns: <Dns />,
    email: <Email />,
    website: <Website apiOnline={apiOnline} onOpenSettings={() => setSettingsOpen(true)} />,
    tools: <Tools apiOnline={apiOnline} />,
    browser: <Browser />,
  };

  return (
    <div className="min-h-screen lg:pl-[252px]">
      <Sidebar
        active={view}
        onNavigate={navigate}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        apiOnline={apiOnline}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <TopBar
        view={meta}
        ip={ip}
        apiOnline={apiOnline}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main key={view} className="mx-auto w-full max-w-[1340px] px-4 pb-16 pt-6 sm:px-6">
        {views[view]}
      </main>

      <StatusBar apiOnline={apiOnline} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={navigate} actions={paletteActions} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiOnline={apiOnline}
        onChanged={setApiOnline}
        onClearData={() => {
          clearHistory();
          clearDnsHistory();
        }}
      />
      <Toaster />
    </div>
  );
}

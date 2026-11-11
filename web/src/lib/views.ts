import {
  Activity,
  Fingerprint,
  Gauge,
  Mail,
  MonitorSmartphone,
  Network,
  Search,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type ViewId = 'overview' | 'lookup' | 'dns' | 'email' | 'website' | 'tools' | 'browser';

export type ViewMeta = {
  id: ViewId;
  label: string;
  title: string;
  kicker: string;
  description: string;
  group: 'monitor' | 'resolve' | 'inspect' | 'utility';
  key: string;
  icon: LucideIcon;
};

export const VIEWS: ViewMeta[] = [
  {
    id: 'overview',
    label: 'Overview',
    title: 'Network overview',
    kicker: 'workspace',
    description: 'Public identity, latency and session state',
    group: 'monitor',
    key: '1',
    icon: Gauge,
  },
  {
    id: 'lookup',
    label: 'IP Lookup',
    title: 'Address intelligence',
    kicker: 'intelligence',
    description: 'Geolocate an address and read registry data',
    group: 'resolve',
    key: '2',
    icon: Search,
  },
  {
    id: 'dns',
    label: 'DNS',
    title: 'Resolver',
    kicker: 'resolver',
    description: 'Encrypted DNS over HTTPS with dig transcripts',
    group: 'resolve',
    key: '3',
    icon: Network,
  },
  {
    id: 'email',
    label: 'Email',
    title: 'Mail authentication',
    kicker: 'mail',
    description: 'SPF, DKIM, DMARC, MTA-STS and BIMI posture',
    group: 'inspect',
    key: '4',
    icon: Mail,
  },
  {
    id: 'website',
    label: 'Website',
    title: 'Website inspector',
    kicker: 'security',
    description: 'Headers, TLS and security scoring',
    group: 'inspect',
    key: '5',
    icon: ShieldCheck,
  },
  {
    id: 'tools',
    label: 'Tools',
    title: 'Network toolbox',
    kicker: 'utilities',
    description: 'Subnets, conversions, URL anatomy, probes',
    group: 'utility',
    key: '6',
    icon: Wrench,
  },
  {
    id: 'browser',
    label: 'Browser',
    title: 'Client signals',
    kicker: 'client',
    description: 'What a website can read about this device',
    group: 'utility',
    key: '7',
    icon: MonitorSmartphone,
  },
];

export const GROUPS: { id: ViewMeta['group']; label: string }[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'resolve', label: 'Resolve' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'utility', label: 'Utility' },
];

export const viewById = (id: string | null | undefined): ViewMeta =>
  VIEWS.find((view) => view.id === id) ?? VIEWS[0];

export const brandIcons = { Activity, Fingerprint };

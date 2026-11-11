import type { DnsHistoryEntry, HistoryEntry } from './types';

const PREFIX = 'netscope.v2.';
const HISTORY_LIMIT = 8;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    window.dispatchEvent(new Event('netscope:store'));
  } catch {
    /* storage may be unavailable */
  }
}

export const getHistory = (): HistoryEntry[] => read<HistoryEntry[]>('history', []);

export function addHistory(entry: HistoryEntry): void {
  const list = getHistory().filter((item) => item.target !== entry.target);
  write('history', [entry, ...list].slice(0, HISTORY_LIMIT));
}

export function clearHistory(): void {
  write('history', []);
}

export const getDnsHistory = (): DnsHistoryEntry[] => read<DnsHistoryEntry[]>('dnsHistory', []);

export function addDnsHistory(entry: DnsHistoryEntry): void {
  const list = getDnsHistory().filter((item) => !(item.name === entry.name && item.type === entry.type));
  write('dnsHistory', [entry, ...list].slice(0, HISTORY_LIMIT));
}

export function clearDnsHistory(): void {
  write('dnsHistory', []);
}

export function getApiBase(): string {
  try {
    return String(localStorage.getItem(PREFIX + 'apiBase') || '')
      .trim()
      .replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function setApiBase(value: string): void {
  try {
    localStorage.setItem(PREFIX + 'apiBase', value.trim().replace(/\/$/, ''));
    window.dispatchEvent(new Event('netscope:api'));
  } catch {
    /* ignore */
  }
}

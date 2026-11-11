import clsx, { type ClassValue } from 'clsx';
import { getLang, translate as tr } from './i18n';

export const cn = (...values: ClassValue[]) => clsx(values);

export const DASH = '—';

export const orDash = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return DASH;
  return String(value);
};

export const nf = new Intl.NumberFormat('en-US');

export const fmtNumber = (value: number | string | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? DASH : nf.format(Number(value));

export const fmtMs = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? DASH : `${Number(value).toFixed(digits)} ms`;

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return DASH;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function fmtDate(input?: string | number | Date | null): string {
  if (!input) return DASH;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function fmtDateTime(input?: string | number | Date | null): string {
  if (!input) return DASH;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(input?: number | string | Date | null): string {
  if (!input) return DASH;
  const time = new Date(input).getTime();
  const diff = Date.now() - time;
  if (!Number.isFinite(diff)) return DASH;
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) return tr('just now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('{n}m ago', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr('{n}h ago', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return tr('{n}d ago', { n: days });
  return fmtDate(input);
}

export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function localClock(zone?: string): { time: string; date: string; offset: string } {
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: zone || undefined,
  };
  let time = '';
  try {
    time = now.toLocaleTimeString(getLang() === 'zh' ? 'zh-CN' : 'en-GB', opts);
  } catch {
    time = now.toLocaleTimeString(getLang() === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  const date = now.toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: zone || undefined,
  });
  let offset = '';
  try {
    offset =
      new Intl.DateTimeFormat('en-US', { timeZone: zone || undefined, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((part) => part.type === 'timeZoneName')?.value || '';
  } catch {
    offset = '';
  }
  return { time, date, offset: offset.replace('GMT', 'UTC') };
}

export function daysBetween(from?: string | number | null, to: Date = new Date()): number | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.round((start - to.getTime()) / 86400000);
}

/**
 * NetScope core utilities — DOM, formatting, theme, storage, feedback.
 */

import { getLocale, translateDOM, t } from './i18n.js';

const THEME_KEY = 'netscope:theme';
const SETTINGS_KEY = 'netscope:settings';
const HISTORY_KEY = 'netscope:history';
const DNS_HISTORY_KEY = 'netscope:dns-history';
const DEFAULT_SETTINGS = { apiBase: '', onlineRefresh: true };

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escape untrusted text for HTML text and attribute contexts. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

export function icon(name, className = '') {
  return `<svg class="icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Only allow http(s) URLs in generated links. */
export function safeHref(value) {
  try {
    const url = new URL(String(value), window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const DASH = '—';

export function orDash(value) {
  if (value === null || value === undefined || value === '') return DASH;
  return value;
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return DASH;
  return new Intl.NumberFormat(getLocale()).format(Number(value));
}

export function formatMs(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return DASH;
  return `${Number(value).toFixed(digits)} ms`;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return DASH;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDate(input, options = {}) {
  if (!input) return DASH;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric', month: 'short', day: 'numeric', ...options,
  }).format(date);
}

export function formatDateTime(input) {
  return formatDate(input, { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return DASH;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return t('just now');
  const formatter = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const units = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(-Math.round(seconds / size), unit);
  }
  return formatter.format(-seconds, 'second');
}

export function daysBetween(from, to = new Date()) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.ceil((end - start) / 86400000);
}

export function zoneOffsetSeconds(zone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === 'timeZoneName')?.value || '';
    const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      return sign * (Number(match[2]) * 3600 + Number(match[3] || 0) * 60);
    }
  } catch {
    /* fall through to the browser offset */
  }
  return -new Date().getTimezoneOffset() * 60;
}

export function formatZoneOffset(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return DASH;
  const total = Number(seconds) / 60;
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const minutes = Math.round(abs % 60);
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatClock(zone) {
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat(getLocale(), {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date());
  }
}

export function formatLongDate(zone) {
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: zone, weekday: 'long', day: 'numeric', month: 'long',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat(getLocale(), {
      weekday: 'long', day: 'numeric', month: 'long',
    }).format(new Date());
  }
}

export function titleCase(value) {
  return String(value ?? '').replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Clipboard / toasts / downloads                                      */
/* ------------------------------------------------------------------ */

export async function copyText(text) {
  const value = String(text ?? '');
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through to legacy path */
    }
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function toast(message, type = 'info', timeout = 4200) {
  const stack = $('#toasts');
  if (!stack) return;
  const iconName = {
    good: 'check', bad: 'alert', warn: 'alert', info: 'info',
  }[type] || 'info';
  const node = document.createElement('div');
  node.className = `toast is-${type}`;
  node.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  stack.append(node);
  translateDOM(node);
  const remove = () => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };
  const timer = setTimeout(remove, timeout);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

export async function copyWithFeedback(button, text, label = 'Copied') {
  const ok = await copyText(text);
  if (!ok) {
    toast('Could not copy — your browser blocked clipboard access.', 'bad');
    return;
  }
  const use = button.querySelector('use');
  const originalHref = use?.getAttribute('href') || '';
  if (use) use.setAttribute('href', '#i-check');
  button.classList.add('is-copied');
  if (button.hasAttribute('aria-label')) {
    button.dataset.originalLabel ||= button.getAttribute('aria-label');
    button.setAttribute('aria-label', 'Copied');
  }
  toast(`${label} to clipboard`, 'good', 1800);
  setTimeout(() => {
    button.classList.remove('is-copied');
    if (use && originalHref) use.setAttribute('href', originalHref);
    if (button.dataset.originalLabel) button.setAttribute('aria-label', button.dataset.originalLabel);
  }, 1500);
}

export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

/* ------------------------------------------------------------------ */
/* Settings & history                                                  */
/* ------------------------------------------------------------------ */

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage can be blocked; settings stay in memory for this page */
  }
  window.dispatchEvent(new CustomEvent('netscope:settings', { detail: next }));
  return next;
}

export function getApiBase() {
  const base = getSettings().apiBase || '';
  return base.replace(/\/+$/, '');
}

export function apiUrl(path) {
  return `${getApiBase()}${path}`;
}

export function getHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function addHistory(entry) {
  if (!entry || !entry.ip) return getHistory();
  const list = getHistory().filter((item) => item.ip !== entry.ip);
  list.unshift({ ...entry, ts: Date.now() });
  const trimmed = list.slice(0, 10);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota errors */
  }
  return trimmed;
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(DNS_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export function getDnsHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(DNS_HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function addDnsHistory(entry) {
  if (!entry || !entry.name) return getDnsHistory();
  const key = `${entry.name}|${entry.type}`.toLowerCase();
  const list = getDnsHistory().filter((item) => `${item.name}|${item.type}`.toLowerCase() !== key);
  list.unshift({ ...entry, ts: Date.now() });
  const trimmed = list.slice(0, 8);
  try {
    localStorage.setItem(DNS_HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export function getThemePreference() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function resolveTheme(preference = getThemePreference()) {
  if (preference === 'dark' || preference === 'light') return preference;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(preference, { persist = true } = {}) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new CustomEvent('netscope:theme', { detail: { preference, resolved } }));
  return resolved;
}

export function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const sync = () => {
    if (getThemePreference() === 'auto') applyTheme('auto', { persist: false });
  };
  if (media.addEventListener) media.addEventListener('change', sync);
  else if (media.addListener) media.addListener(sync);
  return getThemePreference();
}

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

export function sparkline(values, { width = 140, height = 38 } = {}) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const clean = values.map((value) => Number(value) || 0);
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pad = 3;
  const points = clean.map((value, index) => {
    const x = pad + (index / (clean.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y];
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M${pad},${height - pad} L${line.replaceAll(' ', ' L')} L${width - pad},${height - pad} Z`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Latency samples">
    <path class="spark-area" d="${area}" style="fill:var(--accent-soft-2)"/>
    <polyline class="spark-line" points="${line}"/>
  </svg>`;
}

export function qualityLabel(ms) {
  if (!Number.isFinite(ms)) return { label: 'Unknown', tone: 'neutral' };
  if (ms < 60) return { label: 'Excellent', tone: 'good' };
  if (ms < 120) return { label: 'Good', tone: 'good' };
  if (ms < 250) return { label: 'Fair', tone: 'warn' };
  return { label: 'Slow', tone: 'bad' };
}

export function scoreTone(score) {
  if (score >= 90) return 'var(--accent)';
  if (score >= 70) return 'var(--cyan)';
  if (score >= 50) return 'var(--amber)';
  return 'var(--red)';
}

export function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(Boolean(busy)));
  button.classList.toggle('is-loading', busy);
  if (label) {
    const span = button.querySelector('span');
    if (span) span.textContent = label;
  }
}

export function errorCard(message, detail = '') {
  return `<div class="error-card">
    <span class="empty-icon">${icon('alert')}</span>
    <div>
      <h3>Something went wrong</h3>
      <p>${esc(message)}</p>
      ${detail ? `<p class="error-code">${esc(detail)}</p>` : ''}
    </div>
  </div>`;
}

export function emptyState({ iconName = 'search', title, body, actions = '' }) {
  return `<div class="empty-state card">
    <span class="empty-icon">${icon(iconName)}</span>
    <h3>${esc(title)}</h3>
    <p>${body}</p>
    ${actions}
  </div>`;
}

/** Read the current view name from the hash. */
export function hashView() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
  return raw.split(/[/?]/)[0] || 'overview';
}

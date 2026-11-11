import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

const KEY = 'netscope.v2.theme';
const listeners = new Set<() => void>();
const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const read = (): Theme => {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch {
    /* storage may be unavailable */
  }
  return 'system';
};

let current: Theme = read();

const resolve = (theme: Theme): ResolvedTheme =>
  theme === 'system' ? (query?.matches ? 'dark' : 'light') : theme;

const apply = (theme: Theme) => {
  const resolved = resolve(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f3f4ef' : '#060708');
};

if (typeof document !== 'undefined') apply(current);

if (query) {
  const onSchemeChange = () => {
    if (current !== 'system') return;
    apply(current);
    listeners.forEach((listener) => listener());
  };
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onSchemeChange);
  else query.addListener(onSchemeChange);
}

export const getTheme = (): Theme => current;
export const getResolvedTheme = (): ResolvedTheme => resolve(current);

export function setTheme(theme: Theme): void {
  current = theme;
  apply(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((listener) => listener());
}

export const toggleTheme = (): Theme => {
  setTheme(getResolvedTheme() === 'dark' ? 'light' : 'dark');
  return current;
};

export const subscribeTheme = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = (): Theme => useSyncExternalStore(subscribeTheme, getTheme, getTheme);
export const useResolvedTheme = (): ResolvedTheme =>
  useSyncExternalStore(subscribeTheme, getResolvedTheme, getResolvedTheme);

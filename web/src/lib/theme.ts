import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'netscope.v2.theme';
const listeners = new Set<() => void>();

const read = (): Theme => {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

let current: Theme = read();

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f4ef' : '#060708');
};

if (typeof document !== 'undefined') apply(current);

export const getTheme = (): Theme => current;

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
  setTheme(current === 'dark' ? 'light' : 'dark');
  return current;
};

export const useTheme = (): Theme => useSyncExternalStore(subscribeTheme, getTheme, getTheme);

export const subscribeTheme = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

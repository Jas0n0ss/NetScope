/**
 * NetScope application shell — routing, command palette, settings, theme.
 */

import {
  $, $$, esc, icon, toast, getThemePreference, resolveTheme, applyTheme,
  initTheme, getSettings, saveSettings, clearHistory,
  copyWithFeedback, copyText, debounce,
} from './lib/core.js';
import { healthCheck, invalidateHealthCache } from './lib/api.js';
import { initI18n, t, getLanguage, setLanguage, translateDOM } from './lib/i18n.js';
import { initOverview, showOverview } from './views/overview.js';
import { initLookup, showLookup } from './views/lookup.js';
import { initDns, showDns } from './views/dns.js';
import { initWebsite, showWebsite } from './views/website.js';
import { initTools, showTools } from './views/tools.js';
import { initEmail, showEmail } from './views/email.js';
import { initBrowser, showBrowser } from './views/browser.js';

const VIEW_META = {
  overview: { title: 'Overview', eyebrow: 'Workspace', doc: 'Network overview', desc: 'Public IP, location and connection health' },
  lookup: { title: 'IP Lookup', eyebrow: 'Intelligence', doc: 'IP & domain lookup', desc: 'Geolocate an address and read RDAP registry data' },
  dns: { title: 'DNS Records', eyebrow: 'Resolver', doc: 'DNS records', desc: 'Resolve records over encrypted DNS-over-HTTPS' },
  email: { title: 'Email', eyebrow: 'Mail', doc: 'Email diagnostics', desc: 'SMTP and email DNS diagnostics' },
  website: { title: 'Website Inspector', eyebrow: 'Security', doc: 'Website inspector', desc: 'Headers, TLS, metadata and security posture' },
  tools: { title: 'Network Tools', eyebrow: 'Utilities', doc: 'Network tools', desc: 'Subnets, conversions, latency and WebRTC checks' },
  browser: { title: 'Browser Signals', eyebrow: 'Client', doc: 'Browser environment', desc: 'The environment signals websites can read' },
};

const VIEW_INIT = {
  overview: initOverview,
  lookup: initLookup,
  dns: initDns,
  email: initEmail,
  website: initWebsite,
  tools: initTools,
  browser: initBrowser,
};

const VIEW_SHOW = {
  overview: showOverview,
  lookup: showLookup,
  dns: showDns,
  email: showEmail,
  website: showWebsite,
  tools: showTools,
  browser: showBrowser,
};

let currentView = null;
let paletteIndex = 0;
let paletteItems = [];
let lastFocused = null;

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

function normalizeRoute() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return VIEW_META[raw] ? raw : 'overview';
}

function setActiveNav(view) {
  $$('[data-route]').forEach((link) => {
    if (link.dataset.route === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function go(view, { replace = false, focus = true } = {}) {
  if (!VIEW_META[view]) view = 'overview';
  const hash = `#/${view}`;
  if (window.location.hash !== hash) {
    if (replace) window.history.replaceState(null, '', hash);
    else window.history.pushState(null, '', hash);
  }
  switchView(view, { focus });
}

function switchView(view, { focus = true } = {}) {
  const meta = VIEW_META[view];
  if (!meta) return;
  const changed = currentView !== view;

  $$('.view').forEach((section) => {
    const active = section.dataset.view === view;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });

  $('#page-title').textContent = t(meta.title);
  $('#page-eyebrow').textContent = t(meta.eyebrow);
  document.title = `${t(meta.doc)} · NetScope`;
  setActiveNav(view);

  currentView = view;
  VIEW_SHOW[view]?.();

  if (changed && focus) {
    const main = $('#main');
    if (main) {
      main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  closeSidebar({ restoreFocus: false });
}

/* ------------------------------------------------------------------ */
/* Sidebar drawer                                                      */
/* ------------------------------------------------------------------ */

function syncSidebarA11y() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  const mobile = window.innerWidth <= 960;
  const open = sidebar.classList.contains('is-open');
  if (mobile && !open) {
    sidebar.setAttribute('inert', '');
    sidebar.setAttribute('aria-hidden', 'true');
  } else {
    sidebar.removeAttribute('inert');
    sidebar.removeAttribute('aria-hidden');
  }
}

function openSidebar() {
  const sidebar = $('#sidebar');
  const scrim = $('.sidebar-scrim');
  const menu = $('[data-open-sidebar]');
  if (!sidebar) return;
  sidebar.classList.add('is-open');
  syncSidebarA11y();
  document.body.classList.add('drawer-open');
  if (scrim) scrim.hidden = false;
  menu?.setAttribute('aria-expanded', 'true');
  sidebar.querySelector('a, button')?.focus();
}

function closeSidebar({ restoreFocus = true } = {}) {
  const sidebar = $('#sidebar');
  const scrim = $('.sidebar-scrim');
  const menu = $('[data-open-sidebar]');
  if (!sidebar || !sidebar.classList.contains('is-open')) return;
  sidebar.classList.remove('is-open');
  document.body.classList.remove('drawer-open');
  if (scrim) scrim.hidden = true;
  menu?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menu?.focus();
  syncSidebarA11y();
}

function trapSidebarFocus(event) {
  if (event.key !== 'Tab') return;
  const sidebar = $('#sidebar');
  if (!sidebar?.classList.contains('is-open')) return;
  const focusable = $$('a[href], button:not([disabled])', sidebar).filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function syncThemeControls() {
  const preference = getThemePreference();
  const resolved = resolveTheme(preference);
  const button = $('#theme-toggle');
  if (button) {
    const target = resolved === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${target} theme`);
    button.setAttribute('title', `Switch to ${target} theme`);
  }
  $$('input[name="theme"]').forEach((radio) => {
    radio.checked = radio.value === preference;
  });
  $$('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', resolved === 'dark' ? '#06090f' : '#f4f7fb');
  });
}

function toggleTheme() {
  const resolved = resolveTheme();
  applyTheme(resolved === 'dark' ? 'light' : 'dark');
}

/* ------------------------------------------------------------------ */
/* API status                                                          */
/* ------------------------------------------------------------------ */

async function refreshApiStatus({ notify = false } = {}) {
  const dot = $('#api-dot');
  const title = $('#api-title');
  const sub = $('#api-sub');
  const settingsState = $('#settings-api-state');
  if (dot && !dot.classList.contains('is-online')) dot.className = 'api-dot is-checking';
  if (title) title.textContent = 'Checking API…';

  const result = await healthCheck();
  if (dot) dot.className = `api-dot ${result.online ? 'is-online' : 'is-offline'}`;
  if (title) title.textContent = result.online ? 'Inspector API ready' : 'Static mode';
  if (sub) sub.textContent = result.online ? 'Inspect · DNS · SMTP · TLS' : 'Client-side tools only';
  if (settingsState) settingsState.textContent = result.online ? 'API online' : 'API offline';
  $('.api-card')?.setAttribute('aria-label', `${result.online ? 'Inspector API ready' : 'Static mode'} — open settings`);
  window.dispatchEvent(new CustomEvent('netscope:api', { detail: result }));
  if (notify) toast(result.online ? 'Inspector API connected' : 'Inspector API is offline', result.online ? 'good' : 'warn');
  return result;
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

function commandList() {
  return [
    { group: 'Navigate', title: 'Overview', desc: VIEW_META.overview.desc, icon: 'gauge', kbd: '1', run: () => go('overview') },
    { group: 'Navigate', title: 'IP Lookup', desc: VIEW_META.lookup.desc, icon: 'search', kbd: '2', run: () => go('lookup') },
    { group: 'Navigate', title: 'DNS Records', desc: VIEW_META.dns.desc, icon: 'network', kbd: '3', run: () => go('dns') },
    { group: 'Navigate', title: 'Email Diagnostics', desc: VIEW_META.email.desc, icon: 'mail', kbd: '4', run: () => go('email') },
    { group: 'Navigate', title: 'Website Inspector', desc: VIEW_META.website.desc, icon: 'shield', kbd: '5', run: () => go('website') },
    { group: 'Navigate', title: 'Network Tools', desc: VIEW_META.tools.desc, icon: 'wrench', kbd: '6', run: () => go('tools') },
    { group: 'Navigate', title: 'Browser Signals', desc: VIEW_META.browser.desc, icon: 'monitor', kbd: '7', run: () => go('browser') },
    { group: 'Actions', title: 'Refresh my public IP', desc: 'Reload geolocation and latency', icon: 'refresh', keywords: 'reload update', run: () => { go('overview'); setTimeout(() => $('#overview-refresh')?.click(), 120); } },
    { group: 'Actions', title: 'Copy my public IP', desc: 'Copy the address currently shown', icon: 'copy', keywords: 'clipboard', run: async () => { const value = $('.ip-value')?.textContent?.trim(); if (value) { const ok = await copyText(value); toast(ok ? 'Public IP copied' : 'Could not copy', ok ? 'good' : 'bad'); } else { toast('No IP loaded yet', 'warn'); } } },
    { group: 'Actions', title: 'Inspect this site', desc: 'Open the inspector for the current origin', icon: 'scan', keywords: 'website headers tls', run: () => { go('website'); const input = $('#website-input'); if (input) { input.value = window.location.origin; input.focus(); } } },
    { group: 'Actions', title: 'Look up a domain', desc: 'Jump to the lookup form', icon: 'globe', keywords: 'whois geolocation', run: () => { go('lookup'); setTimeout(() => $('#lookup-input')?.focus(), 120); } },
    { group: 'Actions', title: 'Resolve a DNS record', desc: 'Open the DNS resolver', icon: 'network', keywords: 'dns mx txt', run: () => { go('dns'); setTimeout(() => $('#dns-input')?.focus(), 120); } },
    { group: 'Actions', title: 'Toggle color theme', desc: 'Switch between dark and light', icon: 'moon', keywords: 'appearance dark light', run: toggleTheme },
    { group: 'Actions', title: 'Check an email server', desc: 'SMTP and email DNS diagnostics', icon: 'mail', keywords: 'smtp mail spf dkim dmarc', run: () => { go('email'); setTimeout(() => $('#smtp-host')?.focus(), 120); } },
    { group: 'Actions', title: 'Open settings', desc: 'Theme, API endpoint and history', icon: 'settings', keywords: 'preferences config', run: () => openSettings() },
    { group: 'Actions', title: getLanguage() === 'zh' ? 'Switch to English' : 'Switch to Chinese', desc: 'Switch language', icon: 'globe', keywords: 'language 语言 english chinese', run: () => setLanguage(getLanguage() === 'zh' ? 'en' : 'zh') },
  ];
}

function renderPalette(query = '') {
  const list = $('#palette-list');
  const empty = $('#palette-empty');
  if (!list) return;
  const normalized = query.trim().toLowerCase();
  const all = commandList();
  paletteItems = normalized
    ? all.filter((item) => `${item.title} ${item.desc} ${item.keywords || ''} ${t(item.title)} ${t(item.desc)}`.toLowerCase().includes(normalized))
    : all;

  if (!paletteItems.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    paletteIndex = 0;
    return;
  }
  if (empty) empty.hidden = true;

  let lastGroup = '';
  list.innerHTML = paletteItems.map((item, index) => {
    const groupHeading = item.group !== lastGroup
      ? `<li class="palette-group" role="presentation"><p class="palette-label" style="padding-left:10px">${esc(item.group)}</p></li>`
      : '';
    lastGroup = item.group;
    return `${groupHeading}<li role="presentation">
      <button class="palette-item" id="palette-item-${index}" role="option" type="button"
        aria-selected="${index === paletteIndex}" data-palette-index="${index}">
        ${icon(item.icon)}
        <span class="palette-item-copy">
          <span class="palette-item-title">${esc(item.title)}</span>
          <span class="palette-item-desc">${esc(item.desc)}</span>
        </span>
        ${item.kbd ? `<kbd class="palette-item-kbd">${esc(item.kbd)}</kbd>` : ''}
      </button>
    </li>`;
  }).join('');
  selectPaletteItem(Math.min(paletteIndex, paletteItems.length - 1), { scroll: false });
  translateDOM(list);
}

function selectPaletteItem(index, { scroll = true } = {}) {
  if (!paletteItems.length) return;
  paletteIndex = Math.max(0, Math.min(index, paletteItems.length - 1));
  $$('.palette-item').forEach((item) => {
    item.setAttribute('aria-selected', String(Number(item.dataset.paletteIndex) === paletteIndex));
  });
  const input = $('#palette-input');
  input?.setAttribute('aria-activedescendant', `palette-item-${paletteIndex}`);
  if (scroll) {
    const active = $(`#palette-item-${paletteIndex}`);
    active?.scrollIntoView({ block: 'nearest' });
  }
}

function openPalette() {
  const dialog = $('#palette');
  if (!dialog) return;
  lastFocused = document.activeElement;
  if (!dialog.open) dialog.showModal();
  const input = $('#palette-input');
  if (input) input.value = '';
  paletteIndex = 0;
  renderPalette('');
  setTimeout(() => input?.focus(), 30);
}

function closePalette() {
  const dialog = $('#palette');
  if (dialog?.open) dialog.close();
  lastFocused?.focus?.();
}

function runPaletteItem(index) {
  const item = paletteItems[index];
  if (!item) return;
  closePalette();
  setTimeout(() => item.run(), 20);
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function normalizeApiBase(raw) {
  let value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API base must use http or https.');
  return url.href.replace(/\/+$/, '');
}

function commitApiBase() {
  const input = $('#api-base');
  const result = $('#api-test-result');
  if (!input) return true;
  try {
    const value = normalizeApiBase(input.value);
    saveSettings({ apiBase: value });
    input.value = value;
    return true;
  } catch (error) {
    if (result) {
      result.className = 'api-test-result is-bad';
      result.textContent = error.message || 'That API base URL is invalid.';
    }
    if (input.value.trim()) toast(error.message || 'That API base URL is invalid.', 'bad');
    return false;
  }
}

function openSettings() {
  const dialog = $('#settings');
  if (!dialog) return;
  const fromSidebar = Boolean(document.activeElement?.closest?.('.sidebar'));
  closeSidebar({ restoreFocus: false });
  lastFocused = fromSidebar ? $('.topbar [data-open-settings]') : document.activeElement;
  const settings = getSettings();
  const apiInput = $('#api-base');
  if (apiInput) apiInput.value = settings.apiBase || '';
  const onlineRefresh = $('#setting-online-refresh');
  if (onlineRefresh) onlineRefresh.checked = settings.onlineRefresh !== false;
  const result = $('#api-test-result');
  if (result) {
    result.textContent = '';
    result.className = 'api-test-result';
  }
  syncThemeControls();
  if (!dialog.open) dialog.showModal();
  setTimeout(() => $('input[name="theme"]:checked')?.focus(), 40);
}

function closeSettings() {
  const dialog = $('#settings');
  if (!dialog?.open) return;
  commitApiBase();
  dialog.close();
  lastFocused?.focus?.();
}

async function testApi() {
  const result = $('#api-test-result');
  if (!commitApiBase()) return;
  invalidateHealthCache();
  if (result) {
    result.className = 'api-test-result';
    result.textContent = 'Testing…';
  }
  const status = await refreshApiStatus();
  if (result) {
    result.className = `api-test-result ${status.online ? 'is-good' : 'is-bad'}`;
    result.textContent = status.online
      ? `Connected to ${status.base || 'this origin'} — ${status.data?.version || 'API'} ready.`
      : `No API response${status.base ? ` from ${status.base}` : ' on this origin'}. ${status.error || ''}`.trim();
  }
}

/* ------------------------------------------------------------------ */
/* Global interactions                                                */
/* ------------------------------------------------------------------ */

function bindGlobalActions() {
  document.addEventListener('click', (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      const value = copy.dataset.copy;
      if (value) copyWithFeedback(copy, value, copy.dataset.copyLabel || 'Copied');
      return;
    }
    const copyTextButton = event.target.closest('[data-copy-text]');
    if (copyTextButton) {
      copyWithFeedback(copyTextButton, copyTextButton.dataset.copyText, 'Copied');
      return;
    }
    const clear = event.target.closest('[data-clear]');
    if (clear) {
      const input = document.getElementById(clear.dataset.clear);
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    }
  });

  $$('[data-clear]').forEach((button) => {
    const input = document.getElementById(button.dataset.clear);
    if (!input) return;
    const sync = () => { button.hidden = !input.value; };
    input.addEventListener('input', sync);
    sync();
  });

  $$('[data-open-palette]').forEach((button) => button.addEventListener('click', openPalette));
  $$('[data-open-settings]').forEach((button) => button.addEventListener('click', openSettings));
  $$('[data-close-settings]').forEach((button) => button.addEventListener('click', closeSettings));
  $$('[data-open-sidebar]').forEach((button) => button.addEventListener('click', openSidebar));
  $$('[data-close-sidebar]').forEach((button) => button.addEventListener('click', () => closeSidebar()));

  $('#theme-toggle')?.addEventListener('click', toggleTheme);

  $('#sidebar')?.addEventListener('click', (event) => {
    if (event.target.closest('a[href^="#/"]')) closeSidebar({ restoreFocus: false });
  });

  const palette = $('#palette');
  palette?.addEventListener('close', () => {
    lastFocused?.focus?.();
    lastFocused = null;
  });
  palette?.addEventListener('click', (event) => {
    if (event.target === palette) closePalette();
  });
  const paletteInput = $('#palette-input');
  paletteInput?.addEventListener('input', () => {
    paletteIndex = 0;
    renderPalette(paletteInput.value);
  });
  paletteInput?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectPaletteItem(paletteIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectPaletteItem(paletteIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runPaletteItem(paletteIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    }
  });
  palette?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-palette-index]');
    if (item) runPaletteItem(Number(item.dataset.paletteIndex));
  });

  const settings = $('#settings');
  settings?.addEventListener('click', (event) => {
    if (event.target === settings) closeSettings();
  });
  settings?.addEventListener('close', () => {
    commitApiBase();
    lastFocused?.focus?.();
    lastFocused = null;
  });

  $$('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) applyTheme(radio.value);
    });
  });

  $('#api-test')?.addEventListener('click', testApi);
  $('#api-base')?.addEventListener('change', () => commitApiBase());

  $('#setting-online-refresh')?.addEventListener('change', (event) => {
    saveSettings({ onlineRefresh: event.target.checked });
  });

  $('#clear-history')?.addEventListener('click', () => {
    clearHistory();
    window.dispatchEvent(new CustomEvent('netscope:history'));
    toast('Local history cleared', 'info');
  });

  $('#footer-year').textContent = String(new Date().getFullYear());

  window.addEventListener('netscope:theme', syncThemeControls);
  window.addEventListener('netscope:settings', debounce(() => {
    invalidateHealthCache();
    refreshApiStatus();
  }, 350));

  window.addEventListener('online', () => toast('You are back online', 'good', 2400));
  window.addEventListener('offline', () => toast('You are offline — some lookups will fail', 'warn', 3600));
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target.matches('input, textarea, select, [contenteditable="true"]'));

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }

    if (event.key === 'Escape') {
      closeSidebar();
      return;
    }

    if (typing) return;

    if (event.key === '/') {
      const map = {
        overview: '#lookup-input',
        lookup: '#lookup-input',
        dns: '#dns-input',
        email: '#smtp-host',
        website: '#website-input',
        tools: '#subnet-input',
        browser: null,
      };
      const selector = map[currentView];
      if (selector) {
        event.preventDefault();
        $(selector)?.focus();
      }
      return;
    }

    if (/^[1-7]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      go(Object.keys(VIEW_META)[Number(event.key) - 1]);
      return;
    }

    if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (currentView === 'overview') {
        event.preventDefault();
        $('#overview-refresh')?.click();
      }
    }
  });

  document.addEventListener('keydown', trapSidebarFocus);

  const resize = () => {
    if (window.innerWidth > 960) closeSidebar({ restoreFocus: false });
    syncSidebarA11y();
  };
  window.addEventListener('resize', debounce(resize, 150));
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  initI18n();
  initTheme();
  syncThemeControls();
  bindGlobalActions();
  bindKeyboard();
  syncSidebarA11y();

  Object.values(VIEW_INIT).forEach((init) => {
    try {
      init();
    } catch (error) {
      console.error('View init failed', error);
    }
  });

  const initial = normalizeRoute();
  if (!window.location.hash) {
    window.history.replaceState(null, '', '#/overview');
  }
  switchView(initial, { focus: false });
  currentView = initial;

  window.addEventListener('hashchange', () => {
    const view = normalizeRoute();
    switchView(view);
  });

  refreshApiStatus();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshApiStatus();
  }, 90000);

  // Keep the route stable if a stale hash points nowhere.
  if (window.location.hash && !VIEW_META[window.location.hash.replace(/^#\/?/, '')]) {
    window.history.replaceState(null, '', '#/overview');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

/**
 * Browser — the signals every website can read, surfaced for debugging.
 */

import {
  $, esc, icon, toast, formatBytes, copyText, downloadFile,
} from '../lib/core.js';
import { parseUserAgent } from '../lib/tools.js';
import { t } from '../lib/i18n.js';

let report = null;
let loaded = false;

function withTimeout(promise, ms, fallback = null) {
  if (!promise || typeof promise.then !== 'function') return Promise.resolve(fallback);
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function gpuInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'Unavailable';
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {
    return 'Unavailable';
  }
}

function preference(query) {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

async function gather() {
  const ua = parseUserAgent();
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  const intl = Intl.DateTimeFormat().resolvedOptions();

  let quota = null;
  let usage = null;
  if (navigator.storage?.estimate) {
    const estimate = await withTimeout(navigator.storage.estimate(), 1500);
    if (estimate) {
      quota = estimate.quota ?? null;
      usage = estimate.usage ?? null;
    }
  }

  let battery = null;
  if (typeof navigator.getBattery === 'function') {
    battery = await withTimeout(navigator.getBattery(), 1500);
  }

  const gpu = gpuInfo();
  const screenOrientation = screen.orientation?.type || (screen.width > screen.height ? 'landscape' : 'portrait');

  const data = {
    userAgent: navigator.userAgent,
    browser: ua.browser,
    browserVersion: ua.browserVersion,
    engine: ua.engine,
    os: ua.os,
    osVersion: ua.osVersion,
    deviceType: ua.deviceType,
    language: navigator.language,
    languages: (navigator.languages || []).join(', '),
    platform: navigator.platform || '—',
    vendor: navigator.vendor || '—',
    timezone: intl.timeZone,
    locale: intl.locale,
    calendar: intl.calendar,
    numberingSystem: intl.numberingSystem,
    online: navigator.onLine,
    effectiveType: connection.effectiveType || '—',
    downlink: Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : '—',
    rtt: Number.isFinite(connection.rtt) ? `${connection.rtt} ms` : '—',
    saveData: connection.saveData ? 'On' : 'Off',
    protocol: window.location.protocol.replace(':', '').toUpperCase(),
    secureContext: window.isSecureContext,
    cookies: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack === '1' ? 'Enabled' : 'Not set',
    screen: `${screen.width} × ${screen.height}`,
    availableScreen: `${screen.availWidth} × ${screen.availHeight}`,
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    colorDepth: `${screen.colorDepth}-bit`,
    orientation: screenOrientation,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    colorScheme: preference('(prefers-color-scheme: dark)') ? 'Dark' : 'Light',
    reducedMotion: preference('(prefers-reduced-motion: reduce)'),
    highContrast: preference('(prefers-contrast: more)') || preference('(forced-colors: active)'),
    storageQuota: quota === null ? '—' : formatBytes(quota),
    storageUsage: usage === null ? '—' : formatBytes(usage),
    storagePercent: quota ? `${Math.max(1, Math.round((usage / quota) * 100))}%` : '—',
    battery: battery
      ? `${Math.round((battery.level ?? 0) * 100)}%${battery.charging ? ' · charging' : ''}`
      : 'Not exposed',
    gpu,
    cores: navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'Not exposed',
    memory: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'Not exposed',
    webgl: gpu !== 'Unavailable',
    webRtc: typeof RTCPeerConnection === 'function',
    serviceWorker: 'serviceWorker' in navigator,
    pdfViewer: navigator.pdfViewerEnabled ? 'Yes' : 'No',
    webAuthn: typeof PublicKeyCredential !== 'undefined',
    characterSet: document.characterSet,
    webdriver: navigator.webdriver ? 'Yes' : 'No',
  };

  return data;
}

function envRows(rows) {
  return `<dl class="env-list">${rows.map((row) => `
    <div><dt>${esc(row.label)}</dt>
      <dd${row.mono ? ' class="mono"' : ''}>${esc(row.value ?? '—')}</dd>
    </div>`).join('')}</dl>`;
}

function render(data) {
  const grid = $('#browser-grid');
  if (!grid) return;
  const card = (title, iconName, rows, span = 6) => `
    <article class="card span-${span} env-card">
      <div class="card-top">
        <span class="card-kicker">${esc(title)}</span>
        <span class="card-icon" style="width:30px;height:30px;border-radius:8px">${icon(iconName)}</span>
      </div>
      ${envRows(rows)}
    </article>`;

  grid.innerHTML = `
    ${card('Browser & device', 'monitor', [
      { label: 'Browser', value: `${data.browser} ${data.browserVersion}`.trim() },
      { label: 'Engine', value: data.engine },
      { label: 'Operating system', value: `${data.os} ${data.osVersion}`.trim() },
      { label: 'Device type', value: data.deviceType },
      { label: 'Platform', value: data.platform },
      { label: 'Language', value: data.languages || data.language },
      { label: 'Timezone', value: data.timezone, mono: true },
      { label: 'Locale', value: `${data.locale} · ${data.calendar} · ${data.numberingSystem}` },
    ], 6)}
    ${card('Display & viewport', 'layers', [
      { label: 'Screen', value: data.screen, mono: true },
      { label: 'Available', value: data.availableScreen, mono: true },
      { label: 'Viewport', value: data.viewport, mono: true },
      { label: 'Device pixel ratio', value: String(data.pixelRatio), mono: true },
      { label: 'Color depth', value: data.colorDepth },
      { label: 'Orientation', value: data.orientation.startsWith('portrait') ? t('Portrait') : t('Landscape') },
      { label: 'Touch points', value: String(data.maxTouchPoints) },
      { label: 'Character set', value: data.characterSet, mono: true },
    ], 6)}
    ${card('Network', 'wifi', [
      { label: 'Status', value: data.online ? 'Online' : 'Offline' },
      { label: 'Effective type', value: data.effectiveType },
      { label: 'Downlink', value: data.downlink },
      { label: 'Round-trip estimate', value: data.rtt },
      { label: 'Data saver', value: data.saveData },
      { label: 'Page protocol', value: data.protocol },
      { label: 'Secure context', value: data.secureContext ? 'Yes' : 'No' },
      { label: 'WebDriver', value: data.webdriver },
    ], 6)}
    ${card('Privacy & storage', 'shield', [
      { label: 'Cookies enabled', value: data.cookies ? 'Yes' : 'No' },
      { label: 'Do Not Track', value: data.doNotTrack },
      { label: 'Color scheme', value: data.colorScheme },
      { label: 'Reduced motion', value: data.reducedMotion ? 'Preferred' : 'Not set' },
      { label: 'High contrast', value: data.highContrast ? 'Preferred' : 'Not set' },
      { label: 'Storage used', value: t('{used} of {quota} ({pct})', { used: data.storageUsage, quota: data.storageQuota, pct: data.storagePercent }) },
      { label: 'Battery', value: data.battery },
      { label: 'Local history', value: 'Stored only in this browser' },
    ], 6)}
    ${card('Capabilities', 'cpu', [
      { label: 'Logical cores', value: data.cores },
      { label: 'Device memory', value: data.memory },
      { label: 'WebGL', value: data.webgl ? 'Supported' : 'Unavailable' },
      { label: 'WebRTC', value: data.webRtc ? 'Supported' : 'Unavailable' },
      { label: 'Service worker', value: data.serviceWorker ? 'Supported' : 'Unavailable' },
      { label: 'PDF viewer', value: data.pdfViewer },
      { label: 'WebAuthn', value: data.webAuthn ? 'Supported' : 'Unavailable' },
      { label: 'GPU renderer', value: data.gpu, mono: true },
    ], 6)}
    ${card('User agent', 'code', [
      { label: 'Raw string', value: data.userAgent, mono: true },
    ], 12)}
  `;
}

async function load() {
  const grid = $('#browser-grid');
  grid?.setAttribute('aria-busy', 'true');
  try {
    report = await gather();
    loaded = true;
    render(report);
  } catch (error) {
    toast(error.message || 'Could not read browser signals', 'bad');
  } finally {
    grid?.setAttribute('aria-busy', 'false');
  }
}

export function initBrowser() {
  $('#browser-copy')?.addEventListener('click', async () => {
    if (!report) {
      toast('Environment is still loading…', 'info');
      return;
    }
    const ok = await copyText(JSON.stringify(report, null, 2));
    toast(ok ? 'Environment report copied' : 'Could not copy report', ok ? 'good' : 'bad');
  });

  $('#browser-download')?.addEventListener('click', () => {
    if (!report) {
      toast('Environment is still loading…', 'info');
      return;
    }
    downloadFile(`netscope-browser-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report, null, 2));
    toast('Environment report downloaded', 'good');
  });
}

export function showBrowser() {
  if (!loaded) load();
}

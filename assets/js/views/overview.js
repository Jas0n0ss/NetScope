/**
 * Overview — public IP, network, latency, location and local time.
 */

import {
  $, esc, icon, toast, formatClock, formatLongDate, formatZoneOffset,
  getHistory, addHistory, clearHistory, downloadFile, qualityLabel, zoneOffsetSeconds,
  sparkline, clamp, setBusy, errorCard, getSettings, timeAgo,
} from '../lib/core.js';
import { t } from '../lib/i18n.js';
import { myIP } from '../lib/api.js';

let state = null;
let loadedAt = 0;
let loading = false;
let latencySamples = [];
let latencyMedian = null;
let clockTimer = null;

const ONE_MINUTE = 60 * 1000;

function connectionInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  return {
    online: navigator.onLine,
    effectiveType: connection.effectiveType || '',
    downlink: connection.downlink,
    rtt: connection.rtt,
    saveData: Boolean(connection.saveData),
    type: connection.type || '',
    protocol: window.location.protocol.replace(':', '').toUpperCase(),
  };
}

function measureLatency(samples = 3) {
  const target = new URL(`assets/favicon.svg?ping=${Date.now()}`, window.location.href).href;
  const run = async () => {
    const started = performance.now();
    try {
      await fetch(target, { cache: 'no-store', credentials: 'omit' });
      return performance.now() - started;
    } catch {
      return null;
    }
  };
  return (async () => {
    const results = [];
    for (let index = 0; index < samples; index += 1) {
      const value = await run();
      if (value !== null) results.push(value);
    }
    const sorted = results.sort((a, b) => a - b);
    return {
      samples: results.map((value) => Math.round(value)),
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    };
  })();
}

async function load() {
  if (loading) return;
  loading = true;
  const button = $('#overview-refresh');
  setBusy(button, true, 'Refreshing');
  $('#overview-bento')?.setAttribute('aria-busy', 'true');

  try {
    const [infoResult, latencyResult] = await Promise.allSettled([myIP(), measureLatency()]);
    if (infoResult.status !== 'fulfilled') throw infoResult.reason;

    state = infoResult.value;
    loadedAt = Date.now();
    if (latencyResult.status === 'fulfilled') {
      latencySamples = latencyResult.value.samples;
      latencyMedian = latencyResult.value.median;
    } else {
      latencySamples = [];
      latencyMedian = null;
    }
    addHistory({
      ip: state.primary,
      city: state.city,
      country: state.country,
      countryCode: state.countryCode,
    });
    render();
  } catch (error) {
    const bento = $('#overview-bento');
    if (bento) {
      bento.innerHTML = errorCard(
        error.message || 'Could not load your network information.',
        'Public IP providers may be blocked by a firewall, VPN or content blocker.',
      );
      bento.setAttribute('aria-busy', 'false');
    }
    toast(error.message || 'Could not load network information', 'bad');
  } finally {
    loading = false;
    setBusy(button, false, 'Refresh');
    $('#overview-bento')?.setAttribute('aria-busy', 'false');
  }
}

function flagMarkup(info, className = 'flag') {
  const url = info?.flag;
  if (!url || !/^https:\/\//i.test(url)) return '';
  return `<img class="${className}" src="${esc(url)}" alt="" width="20" height="14" loading="lazy" referrerpolicy="no-referrer">`;
}

function mapUrl(info) {
  if (!Number.isFinite(Number(info?.latitude)) || !Number.isFinite(Number(info?.longitude))) return '';
  const lat = Number(info.latitude);
  const lon = Number(info.longitude);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=12/${lat}/${lon}`;
}

function render() {
  const bento = $('#overview-bento');
  if (!bento || !state) return;

  const info = state;
  const connection = connectionInfo();
  const quality = qualityLabel(latencyMedian);
  const health = latencyMedian === null ? 0 : clamp(100 - latencyMedian / 5, 5, 100);
  const location = [info.city, info.region, info.country].filter(Boolean).join(', ') || 'Location unavailable';
  const maps = mapUrl(info);
  const timezone = info.timezone?.id || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = info.timezone?.offset !== null && info.timezone?.offset !== undefined
    ? formatZoneOffset(info.timezone.offset)
    : formatZoneOffset(zoneOffsetSeconds(timezone));
  const isV4 = info.type === 'IPv4' || (!String(info.primary).includes(':'));
  const history = getHistory();
  const effective = connection.effectiveType || connection.type || 'Unknown';
  const downlink = Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : '—';
  const rtt = Number.isFinite(connection.rtt) ? `${connection.rtt} ms` : '—';

  bento.innerHTML = `
    <article class="card span-8 ip-card">
      <div class="card-top">
        <span class="card-kicker"><span class="live-dot" aria-hidden="true"></span> Public address
          <span class="badge badge-neutral">${esc(info.type || (isV4 ? 'IPv4' : 'IPv6'))}</span>
        </span>
        <div class="card-tools">
          <span class="badge badge-good">${connection.online ? 'Online' : 'Offline'}</span>
          <button class="icon-btn" type="button" data-copy="${esc(info.primary)}" aria-label="Copy public IP address" title="Copy IP address">
            ${icon('copy')}
          </button>
        </div>
      </div>
      <p class="ip-value${isV4 ? ' is-v4' : ''}">${esc(info.primary)}</p>
      <div class="ip-sub">
        ${flagMarkup(info)}
        <span>${esc(location)}</span>
        ${info.isp ? `<span class="dot-sep" aria-hidden="true">·</span><span>${esc(info.isp)}</span>` : ''}
        ${info.asn ? `<span class="dot-sep" aria-hidden="true">·</span><span class="mono">AS${esc(info.asn)}</span>` : ''}
      </div>
      <div class="ip-actions">
        <button class="btn btn-small btn-secondary" type="button" data-copy="${esc(info.primary)}">
          ${icon('copy')}<span>Copy ${isV4 ? 'IPv4' : 'IPv6'}</span>
        </button>
        ${maps ? `<a class="btn btn-small btn-ghost" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">
          ${icon('map')}<span>Open in maps</span>
        </a>` : ''}
        <button class="btn btn-small btn-ghost" type="button" data-refresh-overview>
          ${icon('refresh')}<span>Re-check</span>
        </button>
      </div>
      <dl class="ip-facts">
        <div>
          <dt>IPv4</dt>
          <dd class="mono">${info.ipv4 ? esc(info.ipv4) : 'Not available'}</dd>
        </div>
        <div>
          <dt>IPv6</dt>
          <dd class="mono">${info.ipv6 ? esc(info.ipv6) : 'Not available'}</dd>
        </div>
        <div>
          <dt>Timezone</dt>
          <dd>${esc(timezone)} <span class="muted">${esc(offset)}</span></dd>
        </div>
      </dl>
    </article>

    <article class="card span-4">
      <div class="card-top">
        <span class="card-kicker">Network</span>
        <span class="badge badge-info badge-no-dot">${esc(info.source || 'Live')}</span>
      </div>
      <dl class="fact-list">
        <div><dt>Provider</dt><dd>${esc(info.isp || info.org || '—')}</dd></div>
        <div><dt>AS number</dt><dd class="mono">${info.asn ? `AS${esc(info.asn)}` : '—'}</dd></div>
        <div><dt>Organization</dt><dd>${esc(info.org || '—')}</dd></div>
        <div><dt>Domain</dt><dd class="mono">${esc(info.domain || '—')}</dd></div>
      </dl>
    </article>

    <article class="card span-4 metric-card">
      <div class="card-top">
        <span class="card-kicker">Latency</span>
        <span class="badge badge-${quality.tone === 'neutral' ? 'neutral' : quality.tone}">${esc(quality.label)}</span>
      </div>
      <p class="metric-value">${latencyMedian === null ? '—' : Math.round(latencyMedian)}<span class="metric-unit">ms</span></p>
      <p class="metric-sub">${latencySamples.length === 1
        ? esc(t('Median of 1 probe to this origin'))
        : esc(t('Median of {n} probes to this origin', { n: latencySamples.length || 0 }))}</p>
      <div class="sparkline">${sparkline(latencySamples)}</div>
      <div class="meter" role="img" aria-label="${esc(t('Connection health {n} percent', { n: Math.round(health) }))}">
        <span style="width:${health}%"></span>
      </div>
    </article>

    <article class="card span-4">
      <div class="card-top">
        <span class="card-kicker">Location</span>
        <span class="badge badge-neutral badge-no-dot">Approximate</span>
      </div>
      <div class="location-row">
        ${flagMarkup(info, 'flag')}
        <div>
          <p class="metric-value-sm">${esc(info.city || info.region || info.country || 'Unknown')}</p>
          <p class="metric-sub">${esc([info.region, info.country].filter(Boolean).join(', ') || 'No geolocation data')}</p>
        </div>
      </div>
      <dl class="mini-facts">
        <div><dt>Coordinates</dt><dd class="mono">${
          Number.isFinite(Number(info.latitude)) && Number.isFinite(Number(info.longitude))
            ? `${Number(info.latitude).toFixed(2)}, ${Number(info.longitude).toFixed(2)}`
            : '—'
        }</dd></div>
        <div><dt>Postal code</dt><dd>${esc(info.postal || '—')}</dd></div>
      </dl>
      ${maps ? `<a class="text-link" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">
        ${icon('map')}<span>OpenStreetMap</span>${icon('arrow-up-right')}
      </a>` : ''}
    </article>

    <article class="card span-4 metric-card">
      <div class="card-top">
        <span class="card-kicker">Local time</span>
        <span class="badge badge-neutral badge-no-dot">${esc(offset)}</span>
      </div>
      <p class="metric-value clock-value" id="local-clock">${esc(formatClock(timezone))}</p>
      <p class="clock-date" id="local-date">${esc(formatLongDate(timezone))}</p>
      <p class="metric-sub">${esc(info.timezone?.abbr ? `${info.timezone.abbr} · ` : '')}${esc(timezone)}</p>
      <div class="day-track" aria-hidden="true">
        ${Array.from({ length: 24 }, (_, hour) => {
          const current = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(new Date()));
          const cls = hour < current ? 'is-past' : hour === current ? 'is-now' : '';
          return `<span class="${cls}"></span>`;
        }).join('')}
      </div>
    </article>

    <article class="card span-7">
      <div class="card-top">
        <span class="card-kicker">Recent lookups</span>
        <div class="card-tools">
          ${history.length ? `<button class="text-link" type="button" data-clear-history>Clear</button>` : ''}
          <button class="icon-btn" type="button" data-goto="lookup" aria-label="Open IP lookup" title="Open IP lookup">
            ${icon('arrow-up-right')}
          </button>
        </div>
      </div>
      ${history.length ? `<ul class="history-list">
        ${history.slice(0, 5).map((entry) => `<li>
          <span class="history-dot" aria-hidden="true"></span>
          <div class="history-copy">
            <p class="history-ip">${esc(entry.ip)}</p>
            <p class="history-meta">${esc([entry.city, entry.country].filter(Boolean).join(', ') || 'Unknown location')}</p>
          </div>
          <span class="history-time">${esc(timeAgo(entry.ts))}</span>
        </li>`).join('')}
      </ul>` : `<p class="placeholder-note">Lookups you run will appear here. Nothing is sent anywhere except the lookup provider.</p>`}
    </article>

    <article class="card span-5 privacy-card">
      <div class="card-top">
        <span class="card-kicker">Connection &amp; privacy</span>
        <span class="badge badge-good">No tracking</span>
      </div>
      <ul class="check-list">
        <li>${icon('check')}<span>${esc(t('Effective link type: {type}', { type: effective }))}${connection.saveData ? esc(t(' · data saver on')) : ''}</span></li>
        <li>${icon('check')}<span>${esc(t('Estimated downlink: {downlink} · RTT {rtt}', { downlink, rtt }))}</span></li>
        <li>${icon('check')}<span>${esc(window.isSecureContext
          ? t('Transport: {protocol} · secure context', { protocol: connection.protocol })
          : t('Transport: {protocol} · not a secure context', { protocol: connection.protocol }))}</span></li>
        <li>${icon('check')}<span>No accounts, cookies or analytics. History stays in this browser.</span></li>
      </ul>
    </article>
  `;

  startClock(timezone);
}

function startClock(timezone) {
  if (clockTimer) clearInterval(clockTimer);
  const tick = () => {
    const clock = $('#local-clock');
    const date = $('#local-date');
    if (!clock || !date) return;
    clock.textContent = formatClock(timezone);
    date.textContent = formatLongDate(timezone);
  };
  clockTimer = setInterval(tick, 1000);
}

export function exportOverview() {
  if (!state) {
    toast('No network data to export yet.', 'warn');
    return;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    ip: state.primary,
    ipv4: state.ipv4,
    ipv6: state.ipv6,
    geolocation: {
      city: state.city, region: state.region, country: state.country,
      countryCode: state.countryCode, postal: state.postal,
      latitude: state.latitude, longitude: state.longitude,
      timezone: state.timezone,
    },
    network: { isp: state.isp, org: state.org, asn: state.asn, domain: state.domain, source: state.source },
    latency: { samples: latencySamples, median: latencyMedian === null ? null : Math.round(latencyMedian) },
    connection: connectionInfo(),
    browser: { userAgent: navigator.userAgent, language: navigator.language, platform: navigator.platform },
  };
  downloadFile(`netscope-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  toast('Network report downloaded', 'good');
}

export function initOverview() {
  const refresh = () => load();
  $('#overview-refresh')?.addEventListener('click', refresh);
  $('#overview-export')?.addEventListener('click', exportOverview);

  $('#overview-bento')?.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-clear-history]');
    if (clear) {
      clearHistory();
      render();
      toast('Local history cleared', 'info');
      return;
    }
    const goto = event.target.closest('[data-goto]');
    if (goto) {
      window.location.hash = `#/${goto.dataset.goto}`;
      return;
    }
    if (event.target.closest('[data-refresh-overview]')) refresh();
  });

  window.addEventListener('netscope:history', () => {
    if (state) render();
  });

  window.addEventListener('online', () => {
    if (getSettings().onlineRefresh) {
      toast('Back online — refreshing network details', 'info');
      load();
    }
  });

  load();
}

export function showOverview() {
  if (state && Date.now() - loadedAt > ONE_MINUTE && !loading) load();
  if (state) startClock(state.timezone?.id || Intl.DateTimeFormat().resolvedOptions().timeZone);
}

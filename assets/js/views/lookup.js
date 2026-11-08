/**
 * Lookup — geolocation, network ownership and RDAP registry data.
 */

import {
  $, esc, icon, toast, formatDate, setBusy, errorCard, safeHref,
} from '../lib/core.js';
import { lookupIP, rdapLookup, myIP } from '../lib/api.js';
import { isIP } from '../lib/tools.js';
import { t } from '../lib/i18n.js';

let lastResult = null;
let loading = false;
let lookupToken = 0;

function loadingCard() {
  return `<article class="card skeleton-card" aria-hidden="true">
    <span class="sk sk-line w-40"></span>
    <span class="sk sk-line w-70 tall"></span>
    <span class="sk sk-line w-50"></span>
  </article>`;
}

function mapUrl(info) {
  if (!Number.isFinite(Number(info?.latitude)) || !Number.isFinite(Number(info?.longitude))) return '';
  const lat = Number(info.latitude);
  const lon = Number(info.longitude);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=12/${lat}/${lon}`;
}

function rowsMarkup(rows) {
  return `<dl class="kv">${rows.map((row) => `
    <div${row.full ? ' class="span-all"' : ''}>
      <dt>${esc(row.label)}</dt>
      <dd${row.mono ? ' class="mono"' : ''} data-i18n-ignore>${row.html || esc(row.value ?? '—')}</dd>
    </div>`).join('')}</dl>`;
}

function statusesMarkup(statuses) {
  if (!statuses.length) return '<span class="muted">—</span>';
  return statuses.map((status) => `<span class="badge badge-neutral badge-no-dot">${esc(String(status).replaceAll('-', ' '))}</span>`).join(' ');
}

function renderRegistry(rdap) {
  const target = $('#registry-card');
  if (!target) return;

  if (!rdap) {
    target.innerHTML = `<div class="card-top"><span class="card-kicker">Registry</span></div>
      <p class="placeholder-note">No RDAP registry data was returned for this target. Some TLDs and private ranges do not publish public registry data.</p>`;
    return;
  }

  if (rdap.kind === 'ip') {
    target.innerHTML = `
      <div class="card-top">
        <span class="card-kicker">Network registry · RDAP</span>
        <span class="badge badge-info badge-no-dot">${esc(rdap.elapsedMs)} ms</span>
      </div>
      ${rowsMarkup([
        { label: 'Network name', value: rdap.name || '—' },
        { label: 'Handle', value: rdap.handle || '—', mono: true },
        { label: 'Address range', value: rdap.range || '—', mono: true, full: true },
        { label: 'Type', value: [rdap.type, rdap.ipVersion ? `IPv${rdap.ipVersion}` : ''].filter(Boolean).join(' · ') || '—' },
        { label: 'Country', value: rdap.country || '—' },
        { label: 'Organization', value: rdap.registrar || '—', full: true },
        { label: 'Abuse contact', value: rdap.abuseEmail || '—', mono: Boolean(rdap.abuseEmail) },
      ])}
    `;
    return;
  }

  const expiration = rdap.events.expiration || rdap.events['expiration date'] || '';
  const registration = rdap.events.registration || rdap.events['registration date'] || '';
  const updated = rdap.events['last changed'] || rdap.events['last update of rdap database'] || '';
  const daysLeft = expiration ? Math.ceil((new Date(expiration).getTime() - Date.now()) / 86400000) : null;
  const totalDays = expiration && registration
    ? Math.max(1, (new Date(expiration).getTime() - new Date(registration).getTime()) / 86400000)
    : null;
  const remainingPct = daysLeft !== null && totalDays ? Math.min(100, Math.max(0, (daysLeft / totalDays) * 100)) : null;
  const expiryBadge = daysLeft === null
    ? ''
    : daysLeft >= 0
      ? `<span class="badge badge-good badge-no-dot">${esc(t('in {n} days', { n: daysLeft }))}</span>`
      : `<span class="badge badge-bad badge-no-dot">${esc(t('expired {n} days ago', { n: Math.abs(daysLeft) }))}</span>`;
  const registrarUrl = safeHref(rdap.registrarUrl);

  target.innerHTML = `
    <div class="card-top">
      <span class="card-kicker">Domain registry · RDAP</span>
      <div class="card-tools">
        ${expiryBadge}
        <span class="badge badge-neutral badge-no-dot">${esc(rdap.elapsedMs)} ms</span>
      </div>
    </div>
    ${rowsMarkup([
      {
        label: 'Registrar',
        value: rdap.registrar || '—',
        html: registrarUrl
          ? `<a class="text-link" href="${esc(registrarUrl)}" target="_blank" rel="noopener noreferrer">${esc(rdap.registrar)} ${icon('arrow-up-right')}</a>`
          : esc(rdap.registrar || '—'),
      },
      { label: 'Registered', value: registration ? formatDate(registration) : '—' },
      { label: 'Expires', value: expiration ? formatDate(expiration) : '—' },
      { label: 'Last changed', value: updated ? formatDate(updated) : '—' },
      { label: 'DNSSEC', value: rdap.dnssec || '—' },
      { label: 'Handle', value: rdap.handle || '—', mono: true },
      { label: 'Status', value: '', html: statusesMarkup(rdap.statuses), full: true },
      {
        label: 'Nameservers',
        value: '',
        html: rdap.nameservers.length
          ? rdap.nameservers.map((server) => `<span class="badge badge-neutral badge-no-dot mono">${esc(server)}</span>`).join(' ')
          : '<span class="muted">—</span>',
        full: true,
      },
      { label: 'Abuse contact', value: rdap.abuseEmail || '—', mono: Boolean(rdap.abuseEmail) },
      ...(rdap.startAddress && rdap.endAddress
        ? [{ label: 'Address range', value: rdap.range, mono: true, full: true }]
        : []),
    ])}
    ${remainingPct !== null ? `<div class="cert-validity">
      <div class="bar"><span style="width:${remainingPct}%"></span></div>
      <p>${daysLeft >= 0
        ? esc(t('{pct}% of the registration period remains — renew before {date}.', { pct: Math.round(remainingPct), date: formatDate(expiration) }))
        : esc(t('This registration expired {n} days ago.', { n: Math.abs(daysLeft) }))}</p>
    </div>` : ''}
  `;
}

function renderResult(info) {
  const container = $('#lookup-results');
  if (!container) return;
  const location = [info.city, info.region, info.country].filter(Boolean).join(', ') || 'Location unavailable';
  const maps = mapUrl(info);
  const flag = info.flag && /^https:\/\//i.test(info.flag)
    ? `<img class="flag" src="${esc(info.flag)}" alt="" width="22" height="16" referrerpolicy="no-referrer">`
    : '';
  const resolved = info.resolvedFrom
    ? `<span class="badge badge-info">${esc(info.resolvedFrom)} → ${esc(info.ip)}</span>`
    : '';

  container.innerHTML = `
    <article class="card result-hero">
      <div class="card-top">
        <span class="card-kicker">IP address</span>
        <div class="card-tools">
          ${resolved}
          <span class="badge badge-good">${esc(info.type || 'IP')}</span>
          <button class="icon-btn" type="button" data-copy="${esc(info.ip)}" aria-label="${esc(t('Copy IP address'))}" title="${esc(t('Copy IP'))}">
            ${icon('copy')}
          </button>
        </div>
      </div>
      <p class="result-value">${esc(info.ip)}</p>
      <div class="ip-sub">${flag}<span>${esc(location)}</span>${info.isp ? `<span class="dot-sep">·</span><span>${esc(info.isp)}</span>` : ''}</div>
      <div class="result-actions">
        <button class="btn btn-small btn-secondary" type="button" data-copy="${esc(info.ip)}">${icon('copy')}<span>Copy address</span></button>
        ${maps ? `<a class="btn btn-small btn-ghost" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">${icon('map')}<span>Open in maps</span></a>` : ''}
        <button class="btn btn-small btn-ghost" type="button" data-lookup-again>${icon('refresh')}<span>Look up again</span></button>
      </div>
    </article>

    <div class="bento">
      <article class="card span-6">
        <div class="card-top">
          <span class="card-kicker">Network ownership</span>
          <span class="badge badge-info badge-no-dot">${esc(info.source || 'live')}</span>
        </div>
        ${rowsMarkup([
          { label: 'ISP', value: info.isp || '—' },
          { label: 'Organization', value: info.org || '—' },
          { label: 'AS number', value: info.asn ? `AS${info.asn}` : '—', mono: true },
          { label: 'Domain', value: info.domain || '—', mono: true },
        ])}
      </article>

      <article class="card span-6">
        <div class="card-top">
          <span class="card-kicker">Geolocation</span>
          <span class="badge badge-neutral badge-no-dot">Approximate</span>
        </div>
        ${rowsMarkup([
          { label: 'City', value: info.city || '—' },
          { label: 'Region', value: info.region || '—' },
          { label: 'Country', value: info.country ? `${info.country}${info.countryCode ? ` (${info.countryCode})` : ''}` : '—' },
          { label: 'Postal code', value: info.postal || '—' },
          {
            label: 'Coordinates',
            value: Number.isFinite(Number(info.latitude)) && Number.isFinite(Number(info.longitude))
              ? `${Number(info.latitude).toFixed(3)}, ${Number(info.longitude).toFixed(3)}`
              : '—',
            mono: true,
          },
          { label: 'Timezone', value: info.timezone?.id || '—', mono: true },
        ])}
      </article>

      <article class="card span-12" id="registry-card" aria-busy="true">
        <div class="card-top"><span class="card-kicker">Registry · RDAP</span></div>
        <span class="sk sk-line w-30"></span>
        <span class="sk sk-line w-70"></span>
        <span class="sk sk-line w-50"></span>
      </article>
    </div>
  `;
}

async function runLookup(target) {
  if (loading) return;
  const value = String(target ?? $('#lookup-input')?.value ?? '').trim();
  if (!value) {
    $('#lookup-input')?.focus();
    return;
  }
  loading = true;
  const runToken = ++lookupToken;
  const button = $('#lookup-submit');
  const results = $('#lookup-results');
  setBusy(button, true, 'Looking up');
  results?.setAttribute('aria-busy', 'true');
  if (results) results.innerHTML = loadingCard();

  try {
    const info = await lookupIP(value);
    if (runToken !== lookupToken) return;
    lastResult = info;
    renderResult(info);
    toast(t('Found {ip}', { ip: info.ip }), 'good', 2200);

    const registryTarget = info.resolvedFrom || (isIP(value) ? info.ip : value);
    rdapLookup(info.resolvedFrom ? 'domain' : isIP(value) ? 'ip' : 'domain', registryTarget)
      .then((rdap) => { if (runToken === lookupToken) renderRegistry(rdap); })
      .catch((error) => { if (runToken === lookupToken) renderRegistry(null, error); });
  } catch (error) {
    if (runToken !== lookupToken) return;
    if (results) {
      results.innerHTML = errorCard(
        error.message || 'The lookup failed.',
        error.code === 'network' ? 'A content blocker or firewall may be blocking the geolocation provider.' : '',
      );
    }
    toast(error.message || 'Lookup failed', 'bad');
  } finally {
    if (runToken === lookupToken) {
      loading = false;
      setBusy(button, false, 'Look up');
      results?.setAttribute('aria-busy', 'false');
    }
  }
}

export function initLookup() {
  $('#lookup-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runLookup($('#lookup-input')?.value);
  });

  document.addEventListener('click', (event) => {
    const example = event.target.closest('[data-lookup-example]');
    if (example) {
      const input = $('#lookup-input');
      if (input) {
        input.value = example.dataset.lookupExample;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      runLookup(example.dataset.lookupExample);
      return;
    }
    if (event.target.closest('[data-lookup-again]') && lastResult) {
      runLookup(lastResult.ip);
    }
  });

  $('#lookup-self')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, 'Finding');
    try {
      const info = await myIP();
      const input = $('#lookup-input');
      if (input) {
        input.value = info.primary;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await runLookup(info.primary);
    } catch (error) {
      toast(error.message || 'Could not determine your IP', 'bad');
    } finally {
      setBusy(button, false, 'My IP');
    }
  });
}

export function showLookup() {
  if (!lastResult && window.location.hash.includes('lookup')) {
    // Keep the empty state; no automatic query.
  }
}

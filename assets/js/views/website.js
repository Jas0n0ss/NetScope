/**
 * Website inspector — headers, redirects, TLS, metadata and security posture.
 */

import {
  $, esc, icon, toast, setBusy, errorCard, formatBytes, formatDate,
  downloadFile, safeHref, scoreTone, copyText,
} from '../lib/core.js';
import { inspectWebsite, healthCheck } from '../lib/api.js';
import { auditHeaders } from '../lib/tools.js';
import { t } from '../lib/i18n.js';

let lastReport = null;
let lastUrl = '';
let loading = false;
let apiOnline = null;

function headerValue(headers, name) {
  if (!headers) return '';
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
}

function rowsMarkup(rows) {
  return `<dl class="kv">${rows.map((row) => `
    <div${row.full ? ' class="span-all"' : ''}>
      <dt>${esc(row.label)}</dt>
      <dd${row.mono ? ' class="mono"' : ''} data-i18n-ignore>${row.html || esc(row.value ?? '—')}</dd>
    </div>`).join('')}</dl>`;
}

async function refreshApiStatus({ silent = false } = {}) {
  const result = await healthCheck();
  apiOnline = result.online;
  const notice = $('#api-notice');
  if (notice) notice.hidden = result.online;
  if (!silent && result.online) toast('Inspector API connected', 'good', 2200);
  return result;
}

function renderAudit(audit) {
  const rows = audit.checks.map((check) => {
    const toneClass = check.status === 'pass' ? 'is-pass' : check.status === 'warn' ? 'is-warn' : 'is-fail';
    const iconName = check.status === 'pass' ? 'check' : check.status === 'warn' ? 'alert' : 'x';
    const badge = check.status === 'pass' ? 'Pass' : check.status === 'warn' ? 'Review' : 'Missing';
    const badgeTone = check.status === 'pass' ? 'good' : check.status === 'warn' ? 'warn' : 'bad';
    return `<div class="audit-row ${toneClass}">
      <span class="audit-icon">${icon(iconName)}</span>
      <div>
        <p class="audit-name">${esc(check.name)}</p>
        <p class="audit-detail">${esc(check.detail)}</p>
      </div>
      <span class="badge badge-${badgeTone}">${badge}</span>
    </div>`;
  }).join('');

  return `<div class="score-wrap">
    <div class="score-ring" style="--score:${audit.score};--ring-color:${scoreTone(audit.score)}" role="img"
         aria-label="${esc(t('Security score {score} out of 100, grade {grade}', { score: audit.score, grade: audit.grade }))}">
      <span>${audit.score}<small>/100</small></span>
    </div>
    <div>
      <p class="metric-value-sm">${esc(t('Grade {grade}', { grade: audit.grade }))}</p>
      <p class="metric-sub">${esc(t('{passed} of {total} security headers present', { passed: audit.passed, total: audit.total }))}</p>
      <div class="meta-chips">
        <span>${esc(audit.score >= 75 ? 'Strong baseline' : audit.score >= 50 ? 'Needs work' : 'Weak posture')}</span>
      </div>
    </div>
  </div>
  <div class="audit-grid">${rows}</div>
  ${audit.observations.length ? `<div class="cert-validity">
    <p class="metric-sub" style="margin:0 0 6px">Observations</p>
    <ul class="check-list">
      ${audit.observations.map((item) => `<li>${icon('info')}<span>${esc(item.text)}</span></li>`).join('')}
    </ul>
  </div>` : ''}`;
}

function renderTls(tls, https) {
  if (!https) {
    return `<p class="placeholder-note">This page was served over plain HTTP, so no certificate is presented.</p>`;
  }
  if (!tls || tls.error) {
    return `<div class="notice" style="border-color:var(--amber-soft);background:var(--amber-soft);margin:0">
      <span class="notice-icon">${icon('lock')}</span>
      <div class="notice-copy">
        <strong>Certificate details unavailable</strong>
        <p>${esc(tls?.error || 'The TLS handshake could not be inspected from the API server.')}</p>
      </div>
    </div>`;
  }

  const totalDays = tls.valid_from && tls.valid_to
    ? Math.max(1, (new Date(tls.valid_to).getTime() - new Date(tls.valid_from).getTime()) / 86400000)
    : null;
  const remaining = Number(tls.days_remaining);
  const pct = Number.isFinite(remaining) && totalDays
    ? Math.max(0, Math.min(100, (remaining / totalDays) * 100))
    : 0;
  const expiresTone = remaining <= 0 ? 'bad' : remaining < 21 ? 'warn' : 'good';
  const sans = Array.isArray(tls.sans) ? tls.sans : [];

  return `
    ${rowsMarkup([
      { label: 'Common name', value: tls.subject || '—', mono: true, full: true },
      { label: 'Issuer', value: tls.issuer || '—', full: true },
      { label: 'Valid from', value: tls.valid_from ? formatDate(tls.valid_from) : '—' },
      {
        label: 'Expires',
        value: tls.valid_to ? formatDate(tls.valid_to) : '—',
        html: tls.valid_to
          ? `${esc(formatDate(tls.valid_to))} <span class="badge badge-${expiresTone} badge-no-dot">${Number.isFinite(remaining) ? esc(t('{n} days', { n: remaining })) : esc(t('unknown'))}</span>`
          : '—',
      },
      { label: 'Protocol', value: tls.version || '—', mono: true },
      { label: 'Cipher', value: tls.cipher || '—', mono: true, full: true },
      { label: 'Serial', value: tls.serial || '—', mono: true, small: true, full: true },
      { label: 'SHA-256 fingerprint', value: tls.fingerprint_sha256 || '—', mono: true, small: true, full: true },
      {
        label: t('Subject alternative names ({n})', { n: sans.length }),
        value: '',
        html: sans.length
          ? sans.slice(0, 12).map((name) => `<span class="badge badge-neutral badge-no-dot mono">${esc(name)}</span>`).join(' ')
            + (sans.length > 12 ? ` <span class="muted">+${sans.length - 12} more</span>` : '')
          : '<span class="muted">—</span>',
        full: true,
      },
    ])}
    <div class="cert-validity">
      <div class="bar"><span style="width:${pct}%"></span></div>
      <p>${Number.isFinite(remaining)
        ? (remaining >= 0
          ? esc(t('{pct}% of the certificate lifetime remains — {n} days until expiry.', { pct: Math.round(pct), n: remaining }))
          : esc(t('The certificate expired {n} days ago.', { n: Math.abs(remaining) })))
        : esc(t('Certificate lifetime could not be calculated.'))}</p>
    </div>
  `;
}

function render(report, requested) {
  const container = $('#website-results');
  if (!container) return;
  const audit = auditHeaders(report.headers, { https: Boolean(report.https) });
  const finalUrl = report.final_url || requested;
  const openUrl = safeHref(finalUrl);
  const server = headerValue(report.headers, 'server');
  const title = report.meta?.title || finalUrl;
  const redirects = Array.isArray(report.redirects) ? report.redirects : [];
  const headers = report.headers || {};
  const headerNames = Object.keys(headers).sort((a, b) => a.localeCompare(b));

  const meta = report.meta || {};
  const og = meta.og || {};
  const twitter = meta.twitter || {};

  container.innerHTML = `
    <article class="card result-hero site-hero">
      <div class="card-top">
        <span class="card-kicker">Inspection result</span>
        <div class="card-tools">
          <span class="badge badge-${report.status >= 200 && report.status < 400 ? 'good' : 'bad'}">${esc(report.status)} ${esc(report.reason || '')}</span>
          <span class="badge badge-${report.https ? 'good' : 'warn'}">${report.https ? 'HTTPS' : 'HTTP'}</span>
        </div>
      </div>
      <h3 class="site-title">${esc(title)}</h3>
      <p class="site-url mono">${esc(finalUrl)}</p>
      <div class="meta-chips">
        ${server ? `<span>Server <strong>${esc(server)}</strong></span>` : ''}
        <span>${esc(Math.round(report.elapsed_ms || 0))} ms</span>
        ${report.body_bytes ? `<span>${esc(formatBytes(report.body_bytes))}</span>` : ''}
        ${redirects.length ? `<span>${redirects.length === 1 ? esc(t('1 redirect')) : esc(t('{n} redirects', { n: redirects.length }))}</span>` : ''}
        ${report.ip ? `<span class="mono">${esc(report.ip)}</span>` : ''}
      </div>
      <div class="result-actions">
        ${openUrl ? `<a class="btn btn-small btn-secondary" href="${esc(openUrl)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>Open site</span></a>` : ''}
        <button class="btn btn-small btn-ghost" type="button" data-copy="${esc(finalUrl)}">${icon('copy')}<span>Copy URL</span></button>
        <button class="btn btn-small btn-ghost" type="button" data-site-rerun>${icon('refresh')}<span>Inspect again</span></button>
      </div>
    </article>

    <div class="bento">
      <article class="card span-5" aria-labelledby="audit-title">
        <div class="card-top">
          <span class="card-kicker" id="audit-title">Security posture</span>
          <span class="badge badge-info badge-no-dot">${audit.passed}/${audit.total}</span>
        </div>
        ${renderAudit(audit)}
      </article>

      <article class="card span-7" aria-labelledby="tls-title">
        <div class="card-top">
          <span class="card-kicker" id="tls-title">TLS certificate</span>
          <span class="badge badge-${report.https ? 'good' : 'warn'} badge-no-dot">${report.https ? 'Encrypted' : 'Not encrypted'}</span>
        </div>
        ${renderTls(report.tls, report.https)}
      </article>

      <article class="card span-7" aria-labelledby="response-title">
        <div class="card-top">
          <span class="card-kicker" id="response-title">Response</span>
          <span class="badge badge-neutral badge-no-dot">${esc(headerValue(report.headers, 'content-type').split(';')[0] || 'unknown type')}</span>
        </div>
        ${rowsMarkup([
          { label: 'Status', value: `${report.status} ${report.reason || ''}`.trim() },
          { label: 'Final URL', value: finalUrl, mono: true, full: true },
          { label: 'Content type', value: headerValue(report.headers, 'content-type') || '—', mono: true },
          { label: 'Content length', value: report.body_bytes ? formatBytes(report.body_bytes) : (headerValue(report.headers, 'content-length') || '—') },
          { label: 'Round trip', value: `${Math.round(report.elapsed_ms || 0)} ms` },
        ])}
        <h4 style="margin:16px 0 0;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3)">Redirect chain</h4>
        ${redirects.length
          ? `<ol class="chain">${redirects.map((step) => `<li class="chain-step">
              <div>
                <p class="chain-url">${esc(step.url)}</p>
                <p class="chain-meta">${esc(step.status)}${step.location ? ` → ${esc(step.location)}` : ''} · ${esc(Math.round(step.elapsed_ms || 0))} ms</p>
              </div>
            </li>`).join('')}</ol>`
          : '<p class="placeholder-note">No redirects — the requested URL responded directly.</p>'}
      </article>

      <article class="card span-5" aria-labelledby="meta-title">
        <div class="card-top">
          <span class="card-kicker" id="meta-title">Page metadata</span>
          <span class="badge badge-neutral badge-no-dot">${esc(meta.lang || 'no lang')}</span>
        </div>
        ${rowsMarkup([
          { label: 'Title', value: meta.title || '—', full: true },
          { label: 'Description', value: meta.description || '—', full: true },
          { label: 'Canonical', value: meta.canonical || '—', mono: true, full: true },
          { label: 'Robots', value: meta.robots || '—' },
          { label: 'Viewport', value: meta.viewport || '—', mono: true },
          { label: 'Generator', value: meta.generator || '—' },
          { label: 'Open Graph', value: [og.title, og.type, og.site_name].filter(Boolean).join(' · ') || '—', full: true },
          { label: 'Twitter card', value: [twitter.card, twitter.title].filter(Boolean).join(' · ') || '—', full: true },
          ...(og.image ? [{ label: 'OG image', value: '', html: `<a class="text-link" href="${esc(safeHref(og.image) || '#')}" target="_blank" rel="noopener noreferrer">${esc(og.image)} ${icon('arrow-up-right')}</a>`, full: true }] : []),
        ])}
      </article>

      <article class="card span-12" aria-labelledby="headers-title">
        <div class="card-top">
          <span class="card-kicker" id="headers-title">Response headers</span>
          <div class="card-tools">
            <button class="text-link" type="button" data-site-copy-headers>${icon('copy')} Copy all</button>
            <button class="text-link" type="button" data-site-download>${icon('download')} JSON</button>
          </div>
        </div>
        ${headerNames.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Response headers">
          <table class="data headers-table">
            <thead><tr><th scope="col">Header</th><th scope="col">Value</th></tr></thead>
            <tbody>${headerNames.map((name) => `<tr>
              <td class="cell-type" data-i18n-ignore>${esc(name)}</td>
              <td class="cell-value" data-i18n-ignore>${esc(Array.isArray(headers[name]) ? headers[name].join(', ') : headers[name])}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : '<p class="placeholder-note">No response headers were captured.</p>'}
      </article>
    </div>
  `;
}

function normalizeUrl(raw) {
  let value = String(raw ?? '').trim();
  if (!value) throw new Error('Enter a website URL to inspect.');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs can be inspected.');
  }
  return url.href;
}

async function inspect(rawUrl) {
  if (loading) return;
  let url;
  try {
    url = normalizeUrl(rawUrl);
  } catch (error) {
    toast(error.message, 'bad');
    $('#website-input')?.focus();
    return;
  }

  loading = true;
  const button = $('#website-submit');
  const results = $('#website-results');
  const input = $('#website-input');
  if (input) {
    input.value = url;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  lastUrl = url;
  setBusy(button, true, 'Inspecting');
  results?.setAttribute('aria-busy', 'true');
  if (results) {
    results.innerHTML = `<article class="card skeleton-card" aria-hidden="true">
      <span class="sk sk-line w-40"></span><span class="sk sk-line w-70 tall"></span><span class="sk sk-line w-50"></span>
    </article>`;
  }

  try {
    const report = await inspectWebsite(url);
    lastReport = report;
    apiOnline = true;
    const notice = $('#api-notice');
    if (notice) notice.hidden = true;
    render(report, url);
    toast(t('Inspected {host}', { host: new URL(report.final_url || url).hostname }), 'good', 2400);
  } catch (error) {
    if (results) {
      results.innerHTML = errorCard(
        error.message || 'The site could not be inspected.',
        error.hint || (error.code === 'network'
          ? 'The inspector API may be offline. Start the bundled server or configure the API base URL in Settings.'
          : ''),
      );
    }
    if (error.code === 'network' || error.code === 'invalid_json') {
      apiOnline = false;
      const notice = $('#api-notice');
      if (notice) notice.hidden = false;
    }
    toast(error.message || 'Inspection failed', 'bad');
  } finally {
    loading = false;
    setBusy(button, false, 'Inspect');
    results?.setAttribute('aria-busy', 'false');
  }
}

export function initWebsite() {
  $('#website-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    inspect($('#website-input')?.value);
  });

  $('#show-api-help')?.addEventListener('click', (event) => {
    const help = $('#api-help');
    if (help) {
      help.hidden = !help.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!help.hidden));
    }
  });

  document.addEventListener('click', (event) => {
    const example = event.target.closest('[data-website-example]');
    if (example) {
      inspect(example.dataset.websiteExample);
      return;
    }
    if (event.target.closest('[data-site-rerun]') && lastUrl) {
      inspect(lastUrl);
      return;
    }
    if (event.target.closest('[data-site-copy-headers]') && lastReport) {
      const text = Object.entries(lastReport.headers || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n');
      copyText(text).then((ok) => {
        if (ok) toast('Headers copied', 'good', 1800);
        else toast('Could not copy headers', 'bad');
      });
      return;
    }
    if (event.target.closest('[data-site-download]') && lastReport) {
      downloadFile(`inspect-${new URL(lastReport.final_url || lastUrl).hostname}.json`, JSON.stringify(lastReport, null, 2));
      toast('Inspection report downloaded', 'good');
      return;
    }
    if (event.target.closest('[data-site-raw]') && lastReport) {
      // reserved for future raw view
    }
  });

  window.addEventListener('netscope:api', (event) => {
    apiOnline = Boolean(event.detail?.online);
    const notice = $('#api-notice');
    if (notice) notice.hidden = apiOnline;
  });

  refreshApiStatus({ silent: true });
}

export function showWebsite() {
  if (apiOnline === null) refreshApiStatus({ silent: true });
}

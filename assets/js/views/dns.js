/**
 * DNS — DNS-over-HTTPS records with history and raw response.
 */

import {
  $, esc, icon, toast, setBusy, errorCard, downloadFile, copyWithFeedback,
  addDnsHistory, getDnsHistory, timeAgo, copyText,
} from '../lib/core.js';
import { dohQuery } from '../lib/api.js';
import { formatDig } from '../lib/dig.js';
import { t } from '../lib/i18n.js';
import { isIP } from '../lib/tools.js';

let lastResult = null;
let lastQuery = null;
let loading = false;
let token = 0;

function statusTone(status) {
  if (status === 'NOERROR') return 'good';
  if (status === 'NXDOMAIN') return 'warn';
  return 'bad';
}

function formatTtl(ttl) {
  if (ttl === null || ttl === undefined) return '—';
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.round(ttl / 60)}m`;
  if (ttl < 86400) return `${(ttl / 3600).toFixed(ttl % 3600 ? 1 : 0)}h`;
  return `${(ttl / 86400).toFixed(ttl % 86400 ? 1 : 0)}d`;
}

function historyMarkup() {
  const history = getDnsHistory();
  if (!history.length) return '';
  return `<div class="recent-chips" aria-label="${esc(t('Recent DNS queries'))}">
    <span class="recent-label">Recent</span>
    ${history.map((entry) => `<button class="recent-chip" type="button"
      data-dns-recent="${esc(entry.name)}" data-dns-recent-type="${esc(entry.type)}"
      title="${esc(`${entry.name} ${entry.type} · ${timeAgo(entry.ts)}`)}">
      <span class="mono">${esc(entry.name)}</span><span class="recent-type">${esc(entry.type)}</span>
    </button>`).join('')}
  </div>`;
}

function render(result) {
  const container = $('#dns-results');
  if (!container) return;
  const tone = statusTone(result.statusText);
  const answers = result.answers;
  const queryLabel = lastQuery?.name || result.name;
  const isReverse = lastQuery?.type === 'PTR' && isIP(queryLabel);

  const table = answers.length
    ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(t('DNS answers'))}">
        <table class="data">
          <thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">TTL</th><th scope="col">Value</th></tr></thead>
          <tbody>
            ${answers.map((answer) => `<tr>
              <td class="cell-type" data-i18n-ignore>${esc(answer.typeName)}</td>
              <td class="mono" data-i18n-ignore>${esc(answer.name)}</td>
              <td class="mono" data-i18n-ignore>${esc(formatTtl(answer.ttl))}</td>
              <td class="cell-value" data-i18n-ignore>${esc(answer.data)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : `<div class="notice" style="border-color:var(--border);background:var(--surface-2)">
        <span class="notice-icon" style="color:var(--amber)">${icon('info')}</span>
        <div class="notice-copy">
          <strong>No ${esc(result.type)} records returned</strong>
          <p>${esc(result.statusText === 'NXDOMAIN'
            ? 'The domain does not exist according to this resolver.'
            : 'The name exists but has no records of this type. Try another record type.')}</p>
        </div>
      </div>`;

  const authority = result.authority.length
    ? `<div class="raw"><details>
        <summary>Authority section</summary>
        <div class="table-wrap" style="margin-top:10px" tabindex="0">
          <table class="data compact">
            <thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">TTL</th><th scope="col">Value</th></tr></thead>
            <tbody>${result.authority.map((entry) => `<tr>
              <td class="cell-type" data-i18n-ignore>${esc(entry.typeName)}</td>
              <td class="mono" data-i18n-ignore>${esc(entry.name)}</td>
              <td class="mono" data-i18n-ignore>${esc(formatTtl(entry.ttl))}</td>
              <td class="cell-value" data-i18n-ignore>${esc(entry.data)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </details></div>`
    : '';

  container.innerHTML = `
    ${historyMarkup()}
    <article class="card">
      <div class="card-top">
        <div>
          <span class="card-kicker">DNS response</span>
          <p class="result-title mono" style="margin-top:5px">${esc(queryLabel)} <span class="muted">${esc(result.type)}</span></p>
        </div>
        <div class="card-tools">
          <span class="badge badge-${tone}">${esc(result.statusText)}</span>
          <button class="icon-btn" type="button" data-dns-copy aria-label="${esc(t('Copy DNS response as JSON'))}" title="${esc(t('Copy JSON'))}">
            ${icon('copy')}
          </button>
        </div>
      </div>
      <div class="dns-meta">
        <span>${esc(t('{resolver} resolver', { resolver: result.resolver }))}</span>
        <span>${esc(result.elapsedMs)} ms</span>
        <span>${answers.length === 1 ? esc(t('1 answer')) : esc(t('{n} answers', { n: answers.length }))}</span>
        ${isReverse ? '<span>Reverse lookup</span>' : ''}
        ${result.truncated ? '<span>Truncated response</span>' : ''}
      </div>
      ${table}
      ${authority}
      <div class="result-actions">
        <button class="btn btn-small btn-ghost" type="button" data-dns-download>
          ${icon('download')}<span>Download JSON</span>
        </button>
        <button class="btn btn-small btn-ghost" type="button" data-dns-dig aria-expanded="false">
          ${icon('terminal')}<span>Dig output</span>
        </button>
        <button class="btn btn-small btn-ghost" type="button" data-dns-raw>
          ${icon('code')}<span>Raw response</span>
        </button>
        <button class="btn btn-small btn-ghost" type="button" data-dns-rerun>
          ${icon('refresh')}<span>Run again</span>
        </button>
      </div>
      <div class="raw" id="dns-dig" hidden>
        <div class="dig-head">
          <span class="card-kicker">dig transcript</span>
          <button class="text-link" type="button" data-dns-dig-copy>${icon('copy')} Copy dig output</button>
        </div>
        <pre class="code-panel" tabindex="0" aria-label="dig transcript">${esc(formatDig(result, { name: queryLabel, type: result.type }))}</pre>
      </div>
      <div class="raw" id="dns-raw" hidden>
        <pre class="code-panel" tabindex="0" aria-label="JSON response">${esc(JSON.stringify({ question: { name: queryLabel, type: result.type }, ...result }, null, 2))}</pre>
      </div>
    </article>
  `;
}

async function resolve(nameOverride, typeOverride) {
  if (loading) return;
  const input = $('#dns-input');
  const name = String(nameOverride ?? input?.value ?? '').trim();
  if (!name) {
    input?.focus();
    return;
  }
  const type = typeOverride || document.querySelector('input[name="dns-type"]:checked')?.value || 'A';
  const resolver = $('#dns-resolver')?.value || 'cloudflare';

  if (input && nameOverride) {
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeOverride) {
    const radio = document.querySelector(`input[name="dns-type"][value="${typeOverride}"]`);
    if (radio) radio.checked = true;
  }

  loading = true;
  const runToken = ++token;
  const button = $('#dns-submit');
  const results = $('#dns-results');
  setBusy(button, true, 'Resolving');
  results?.setAttribute('aria-busy', 'true');

  try {
    const result = await dohQuery(name, type, resolver);
    if (runToken !== token) return;
    lastResult = result;
    lastQuery = { name, type, resolver };
    addDnsHistory({ name, type });
    render(result);
    if (!result.answers.length) toast(t('No {type} records found', { type }), 'warn');
  } catch (error) {
    if (runToken !== token) return;
    if (results) {
      results.innerHTML = errorCard(
        error.message || 'DNS resolution failed.',
        'Both Cloudflare and Google DNS-over-HTTPS were attempted.',
      );
    }
    toast(error.message || 'DNS resolution failed', 'bad');
  } finally {
    if (runToken === token) {
      loading = false;
      setBusy(button, false, 'Resolve');
      results?.setAttribute('aria-busy', 'false');
    }
  }
}

export function initDns() {
  $('#dns-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    resolve();
  });

  document.addEventListener('click', (event) => {
    const example = event.target.closest('[data-dns-example]');
    if (example) {
      resolve(example.dataset.dnsExample, 'A');
      return;
    }
    const recent = event.target.closest('[data-dns-recent]');
    if (recent) {
      resolve(recent.dataset.dnsRecent, recent.dataset.dnsRecentType);
      return;
    }
    if (event.target.closest('[data-dns-copy]') && lastResult) {
      copyWithFeedback(event.target.closest('[data-dns-copy]'), JSON.stringify(lastResult, null, 2), t('DNS response copied'));
      return;
    }
    if (event.target.closest('[data-dns-download]') && lastResult) {
      downloadFile(`dns-${(lastQuery?.name || 'query').replaceAll(/[^\w.-]/g, '_')}-${lastResult.type}.json`, JSON.stringify(lastResult, null, 2));
      toast(t('DNS response downloaded'), 'good');
      return;
    }
    const digButton = event.target.closest('[data-dns-dig]');
    if (digButton) {
      const panel = $('#dns-dig');
      if (panel) {
        panel.hidden = !panel.hidden;
        digButton.setAttribute('aria-expanded', String(!panel.hidden));
      }
      return;
    }
    if (event.target.closest('[data-dns-dig-copy]') && lastResult) {
      const text = formatDig(lastResult, { name: lastQuery?.name || lastResult.name, type: lastResult.type });
      copyText(text).then((ok) => toast(ok ? t('Dig output copied') : t('Copy failed'), ok ? 'good' : 'bad'));
      return;
    }
    if (event.target.closest('[data-dns-raw]')) {
      const raw = $('#dns-raw');
      if (raw) raw.hidden = !raw.hidden;
      return;
    }
    if (event.target.closest('[data-dns-rerun]') && lastQuery) {
      resolve(lastQuery.name, lastQuery.type);
    }
  });
}

export function showDns() {
  /* intentionally no automatic network call */
}

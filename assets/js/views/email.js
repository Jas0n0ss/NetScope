/**
 * Email — SMTP diagnostics and email authentication DNS checks.
 */

import {
  $, esc, icon, toast, setBusy, errorCard, formatDate, downloadFile,
  copyText, scoreTone,
} from '../lib/core.js';
import { checkSMTP, dohQuery, normalizeTarget } from '../lib/api.js';
import { formatDig, combineDigs } from '../lib/dig.js';
import { t, translateDOM } from '../lib/i18n.js';

let lastSmtp = null;
let lastEmail = null;
let smtpLoading = false;
let emailLoading = false;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function skeleton() {
  return `<article class="card skeleton-card" aria-hidden="true">
    <span class="sk sk-line w-40"></span><span class="sk sk-line w-70 tall"></span><span class="sk sk-line w-50"></span>
  </article>`;
}

function rowsMarkup(rows) {
  return `<dl class="kv">${rows.map((row) => `
    <div${row.full ? ' class="span-all"' : ''}>
      <dt>${esc(row.label)}</dt>
      <dd${row.mono ? ' class="mono"' : ''} data-i18n-ignore>${row.html || esc(row.value ?? '—')}</dd>
    </div>`).join('')}</dl>`;
}

function badge(tone, label) {
  return `<span class="badge badge-${tone} badge-no-dot">${esc(label)}</span>`;
}

function txtValue(data) {
  return String(data ?? '')
    .replace(/"\s+"/g, '')
    .replace(/^"|"$/g, '')
    .replace(/\\"/g, '"');
}

function txtAnswers(result) {
  return (result?.answers || [])
    .filter((answer) => answer.typeName === 'TXT')
    .map((answer) => ({ ...answer, text: txtValue(answer.data) }));
}

function findTxt(result, prefix) {
  const lower = prefix.toLowerCase();
  return txtAnswers(result).find((answer) => answer.text.toLowerCase().startsWith(lower))?.text || '';
}

function renderTls(tls, secure) {
  if (!secure) {
    return `<div class="result-pill is-bad" style="margin-bottom:10px">${icon('lock')}<span>${esc(t('Not encrypted'))}</span></div>
      <p class="placeholder-note">${esc(t('The server did not offer STARTTLS. Credentials and mail would travel in clear text.'))}</p>`;
  }
  if (!tls || tls.error) {
    return `<div class="notice" style="border-color:var(--amber-soft);background:var(--amber-soft);margin:0">
      <span class="notice-icon">${icon('lock')}</span>
      <div class="notice-copy"><strong>${esc(t('Certificate details unavailable'))}</strong>
      <p>${esc(tls?.error || t('The TLS handshake could not be inspected from the API server.'))}</p></div>
    </div>`;
  }
  return rowsMarkup([
    { label: t('Common name'), value: tls.subject || '—', mono: true, full: true },
    { label: t('Issuer'), value: tls.issuer || '—', full: true },
    { label: t('Expires'), value: tls.valid_to ? formatDate(tls.valid_to) : '—' },
    { label: t('Days remaining'), value: Number.isFinite(Number(tls.days_remaining)) ? `${tls.days_remaining}` : '—' },
    { label: t('Protocol'), value: tls.version || '—', mono: true },
    { label: t('Cipher'), value: tls.cipher || '—', mono: true, full: true },
  ]);
}

/* ------------------------------------------------------------------ */
/* SMTP                                                                */
/* ------------------------------------------------------------------ */

function renderSmtp(report) {
  const container = $('#smtp-results');
  if (!container) return;

  if (!report.reachable) {
    container.innerHTML = `
      <article class="card error-card" style="display:block">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span class="empty-icon" style="margin:0">${icon('mail')}</span>
          <div>
            <h3>${esc(t('Connection failed'))}</h3>
            <p><strong class="mono">${esc(report.host)}:${esc(report.port)}</strong> — ${esc(report.error || 'No SMTP response.')}</p>
            <p class="error-code">${esc(report.ip || '')} · ${esc(Math.round(report.elapsed_ms || 0))} ms</p>
          </div>
        </div>
      </article>`;
    translateDOM(container);
    return;
  }

  const caps = report.capabilities || {};
  const auth = Array.isArray(caps.auth) ? caps.auth : [];
  const extensions = Array.isArray(caps.extensions) ? caps.extensions : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const banner = Array.isArray(report.banner) ? report.banner : [];
  const modeLabel = report.mode === 'auto' ? t('Auto') : report.mode === 'starttls' ? 'STARTTLS' : t('Implicit TLS');
  const securityBadge = report.secure
    ? badge('good', report.implicit_tls ? t('Implicit TLS') : 'STARTTLS')
    : badge('bad', t('Not encrypted'));
  const reachBadge = badge('good', t('Reachable'));

  const chips = [
    caps.starttls ? `<span class="cap-chip">STARTTLS</span>` : '',
    caps.size ? `<span class="cap-chip">SIZE ${esc(caps.size)}</span>` : '',
    caps.pipelining ? '<span class="cap-chip">PIPELINING</span>' : '',
    caps['8bitmime'] ? '<span class="cap-chip">8BITMIME</span>' : '',
    caps.smtputf8 ? '<span class="cap-chip">SMTPUTF8</span>' : '',
    caps.chunking ? '<span class="cap-chip">CHUNKING</span>' : '',
    caps.enhancedstatuscodes ? '<span class="cap-chip">ENHANCEDSTATUSCODES</span>' : '',
    caps.dsn ? '<span class="cap-chip">DSN</span>' : '',
  ].filter(Boolean).join('');

  container.innerHTML = `
    <article class="card result-hero smtp-hero">
      <div class="card-top">
        <span class="card-kicker">${esc(t('SMTP response'))}</span>
        <div class="card-tools">${reachBadge}${securityBadge}</div>
      </div>
      <p class="result-title mono">${esc(report.host)}:${esc(report.port)}</p>
      <div class="meta-chips">
        <span class="mono">${esc(report.ip || '—')}</span>
        <span>${esc(Math.round(report.elapsed_ms || 0))} ms</span>
        <span>${esc(modeLabel)}</span>
        ${report.starttls_used ? `<span>${esc(t('STARTTLS'))}</span>` : ''}
      </div>
      <div class="result-actions">
        <button class="btn btn-small btn-ghost" type="button" data-smtp-rerun>
          ${icon('refresh')}<span>${esc(t('Test SMTP'))}</span>
        </button>
      </div>
    </article>

    <div class="bento">
      <article class="card span-6">
        <div class="card-top"><span class="card-kicker">${esc(t('Banner'))}</span></div>
        <pre class="code-panel" tabindex="0" aria-label="SMTP banner">${esc(banner.join('\n') || '—')}</pre>
      </article>

      <article class="card span-6">
        <div class="card-top">
          <span class="card-kicker">${esc(t('Capabilities'))}</span>
          <span class="badge badge-neutral badge-no-dot">${extensions.length}</span>
        </div>
        <div class="cap-list">${chips || `<span class="muted">${esc(t('No data'))}</span>`}</div>
        <h4>${esc(t('Authentication'))}</h4>
        ${auth.length
          ? `<div class="cap-list">${auth.map((mechanism) => `<span class="cap-chip is-auth">${esc(mechanism)}</span>`).join('')}</div>`
          : `<p class="placeholder-note">${esc(t('No AUTH mechanism advertised'))}</p>`}
        ${extensions.length ? `<p class="hint">${esc(extensions.join(' · '))}</p>` : ''}
      </article>

      <article class="card span-6">
        <div class="card-top">
          <span class="card-kicker">${esc(t('TLS certificate'))}</span>
          ${report.secure ? badge('good', t('Encrypted')) : badge('bad', t('Not encrypted'))}
        </div>
        ${renderTls(report.tls, report.secure)}
      </article>

      <article class="card span-6">
        <div class="card-top"><span class="card-kicker">${esc(t('Notes'))}</span></div>
        ${warnings.length
          ? `<ul class="check-list">${warnings.map((warning) => `<li>${icon('alert')}<span>${esc(warning)}</span></li>`).join('')}</ul>`
          : `<div class="result-pill is-good">${icon('check')}<span>${esc(t('TLS is active for this session.'))}</span></div>`}
        <p class="hint" style="margin-top:12px">${esc(t('NetScope never sends AUTH credentials, email addresses or messages.'))}</p>
      </article>
    </div>
  `;
  translateDOM(container);
}

async function runSmtp() {
  if (smtpLoading) return;
  const hostInput = $('#smtp-host');
  const portInput = $('#smtp-port');
  const modeInput = $('#smtp-mode');
  const host = hostInput?.value.trim() || '';
  const port = Number(portInput?.value);
  const mode = modeInput?.value || 'auto';
  if (!host) {
    toast(t('Enter an SMTP hostname.'), 'bad');
    hostInput?.focus();
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    toast(t('Port must be an integer between 1 and 65535.'), 'bad');
    portInput?.focus();
    return;
  }

  smtpLoading = true;
  const button = $('#smtp-submit');
  const results = $('#smtp-results');
  setBusy(button, true, t('Testing…'));
  results?.setAttribute('aria-busy', 'true');
  if (results) results.innerHTML = skeleton();

  try {
    const report = await checkSMTP(host, port, mode);
    lastSmtp = report;
    renderSmtp(report);
    if (!report.reachable) toast(report.error || t('Connection failed'), 'bad');
    else toast(`${host}:${port} — ${t('Reachable')}`, 'good', 2200);
  } catch (error) {
    if (results) {
      results.innerHTML = errorCard(
        error.message || t('SMTP check failed.'),
        error.hint || (error.code === 'invalid_json' || error.code === 'network'
          ? t('The inspector API may be offline. Start the bundled server or configure the API base URL in Settings.')
          : ''),
      );
      translateDOM(results);
    }
    toast(error.message || t('SMTP check failed.'), 'bad');
  } finally {
    smtpLoading = false;
    setBusy(button, false, t('Test SMTP'));
    results?.setAttribute('aria-busy', 'false');
  }
}

/* ------------------------------------------------------------------ */
/* Email DNS                                                           */
/* ------------------------------------------------------------------ */

function statusFor(tone) {
  if (tone === 'good') return t('Good');
  if (tone === 'warn') return t('Recommended');
  if (tone === 'bad') return t('Missing');
  if (tone === 'neutral') return t('Optional');
  return t('Warning');
}

function buildEmailChecks(domain, mxResult, txtResult, dmarcResult, dkimResult, mtaResult, tlsRptResult, bimiResult) {
  const checks = [];

  const mx = (mxResult?.answers || [])
    .filter((answer) => answer.typeName === 'MX')
    .map((answer) => {
      const parts = String(answer.data).split(/\s+/);
      return { priority: Number(parts[0]), host: parts.slice(1).join(' ').replace(/\.$/, '') };
    })
    .sort((a, b) => a.priority - b.priority);
  const nullMx = mx.some((record) => record.host === '.' || record.host === '');
  checks.push({
    key: 'mx',
    name: 'MX records',
    tone: mx.length && !nullMx ? 'good' : 'bad',
    value: mx.length ? mx.map((record) => `${record.priority} ${record.host || '.'}`).join(' · ') : t('No MX record found'),
    note: mx.length && !nullMx ? t('The domain accepts email.') : t('The domain does not accept email.'),
  });

  const spf = findTxt(txtResult, 'v=spf1');
  let spfTone = 'bad';
  let spfNote = t('No SPF record');
  if (spf) {
    if (/\+all/i.test(spf)) {
      spfTone = 'bad';
      spfNote = t('SPF is neutral or permissive.');
    } else if (/-all/i.test(spf)) {
      spfTone = 'good';
      spfNote = t('SPF uses a strong all mechanism.');
    } else {
      spfTone = 'warn';
      spfNote = t('SPF uses a soft fail.');
    }
  }
  checks.push({ key: 'spf', name: 'SPF record', tone: spfTone, value: spf || '—', note: spfNote });

  const dmarc = findTxt(dmarcResult, 'v=dmarc1');
  const policy = (dmarc.match(/(?:^|;)\s*p=([a-z]+)/i)?.[1] || '').toLowerCase();
  let dmarcTone = 'bad';
  let dmarcNote = t('No DMARC record');
  if (dmarc) {
    if (policy === 'reject') {
      dmarcTone = 'good';
      dmarcNote = t('DMARC reject');
    } else if (policy === 'quarantine') {
      dmarcTone = 'warn';
      dmarcNote = t('DMARC quarantine');
    } else {
      dmarcTone = 'warn';
      dmarcNote = t('DMARC none');
    }
  }
  checks.push({ key: 'dmarc', name: 'DMARC policy', tone: dmarcTone, value: dmarc || '—', note: dmarcNote });

  const dkim = findTxt(dkimResult, 'v=dkim1') || (txtAnswers(dkimResult).find((answer) => /(?:^|;)\s*p=/.test(answer.text))?.text || '');
  const dkimTone = dkim && !/(?:^|;)\s*p=\s*(?:;|$)/i.test(dkim) ? 'good' : 'bad';
  checks.push({
    key: 'dkim',
    name: 'DKIM record',
    tone: dkimTone,
    value: dkim || '—',
    note: dkim
      ? (dkimTone === 'good' ? t('DKIM selector record found') : t('DKIM key is empty or revoked.'))
      : t('No DKIM record for selector'),
  });

  const mta = findTxt(mtaResult, 'v=stsv1');
  checks.push({
    key: 'mta',
    name: 'MTA-STS',
    tone: mta ? 'good' : 'warn',
    value: mta || '—',
    note: mta ? t('MTA-STS policy found') : t('No MTA-STS policy'),
  });

  const tlsRpt = findTxt(tlsRptResult, 'v=tlsrptv1');
  checks.push({
    key: 'tlsrpt',
    name: 'TLS-RPT',
    tone: tlsRpt ? 'good' : 'warn',
    value: tlsRpt || '—',
    note: tlsRpt ? t('TLS reporting enabled') : t('No TLS reporting record'),
  });

  const bimi = findTxt(bimiResult, 'v=bimi1');
  checks.push({
    key: 'bimi',
    name: 'BIMI',
    tone: bimi ? 'good' : 'neutral',
    value: bimi || '—',
    note: bimi ? t('BIMI record found') : t('No BIMI record'),
    optional: true,
  });

  const weights = { mx: 20, spf: 20, dmarc: 20, dkim: 20, mta: 10, tlsrpt: 10 };
  let earned = 0;
  let total = 0;
  for (const check of checks) {
    if (!weights[check.key]) continue;
    total += weights[check.key];
    if (check.tone === 'good') earned += weights[check.key];
    else if (check.tone === 'warn') earned += weights[check.key] / 2;
  }
  const score = Math.round((earned / total) * 100);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  return { checks, score, grade, mx, spf, dmarc, dmarcPolicy: policy, dkim, mta, tlsRpt, bimi };
}

function renderEmailDns(domain, selector, results, parsed, digText, raw) {
  const container = $('#email-dns-results');
  if (!container) return;
  const checksMarkup = parsed.checks.map((check) => `
    <div class="email-check">
      <div class="email-check-top">
        <span class="email-check-name">${esc(t(check.name))}</span>
        ${badge(check.optional ? 'neutral' : check.tone, statusFor(check.tone))}
      </div>
      <p class="email-check-value" data-i18n-ignore>${esc(check.value)}</p>
      <p class="email-check-note">${esc(check.note)}</p>
    </div>`).join('');

  container.innerHTML = `
    <article class="card result-hero email-hero">
      <div class="card-top">
        <span class="card-kicker">${esc(t('Email DNS report'))}</span>
        <div class="card-tools">
          ${badge(parsed.checks.find((check) => check.key === 'mx')?.tone || 'bad', 'MX')}
          ${badge(parsed.checks.find((check) => check.key === 'spf')?.tone || 'bad', 'SPF')}
          ${badge(parsed.checks.find((check) => check.key === 'dkim')?.tone || 'bad', 'DKIM')}
          ${badge(parsed.checks.find((check) => check.key === 'dmarc')?.tone || 'bad', 'DMARC')}
        </div>
      </div>
      <p class="result-title mono">${esc(domain)}</p>
      <p class="metric-sub">${esc(t('Email health score'))} · ${esc(t('DKIM selector'))}: ${esc(selector)}</p>
      <div class="score-wrap">
        <div class="score-ring" style="--score:${parsed.score};--ring-color:${scoreTone(parsed.score)}" role="img"
             aria-label="${esc(t('Email health score'))}: ${parsed.score}/100, ${esc(t('Grade {grade}', { grade: parsed.grade }))}">
          <span>${parsed.score}<small>/100</small></span>
        </div>
        <div>
          <p class="metric-value-sm">${esc(t('Grade {grade}', { grade: parsed.grade }))}</p>
          <p class="metric-sub">${esc(t('A verified email setup uses SPF, DKIM and DMARC together.'))}</p>
        </div>
      </div>
      <div class="result-actions">
        <button class="btn btn-small btn-ghost" type="button" data-email-dig aria-expanded="false">
          ${icon('terminal')}<span>${esc(t('Dig output'))}</span>
        </button>
        <button class="btn btn-small btn-ghost" type="button" data-email-copy>
          ${icon('copy')}<span>${esc(t('Copy report'))}</span>
        </button>
        <button class="btn btn-small btn-ghost" type="button" data-email-download>
          ${icon('download')}<span>${esc(t('Download report'))}</span>
        </button>
      </div>
      <div class="raw" id="email-dig" hidden>
        <pre class="code-panel" tabindex="0" aria-label="Email dig transcript">${esc(digText)}</pre>
      </div>
    </article>

    <div class="email-checks">${checksMarkup}</div>
  `;

  lastEmail = { domain, selector, parsed, digText, raw, checks: parsed.checks, score: parsed.score, grade: parsed.grade };
  translateDOM(container);
}

async function runEmailDns(domainOverride) {
  if (emailLoading) return;
  const domainInput = $('#email-domain');
  const selectorInput = $('#email-selector');
  let rawValue = String(domainOverride ?? domainInput?.value ?? '').trim();
  if (!rawValue) {
    toast(t('Enter an email domain.'), 'bad');
    domainInput?.focus();
    return;
  }
  if (rawValue.includes('@')) rawValue = rawValue.split('@').pop();
  let domain;
  try {
    domain = normalizeTarget(rawValue).value;
  } catch (error) {
    toast(error.message || t('Enter an email domain.'), 'bad');
    domainInput?.focus();
    return;
  }
  if (domainInput) {
    domainInput.value = domain;
    domainInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const selector = (selectorInput?.value.trim() || 'default').replace(/[^a-zA-Z0-9._-]/g, '');
  if (selectorInput) selectorInput.value = selector || 'default';

  emailLoading = true;
  const button = $('#email-dns-submit');
  const container = $('#email-dns-results');
  setBusy(button, true, t('Testing…'));
  container?.setAttribute('aria-busy', 'true');
  if (container) container.innerHTML = skeleton();

  const queries = [
    { key: 'mx', name: domain, type: 'MX' },
    { key: 'txt', name: domain, type: 'TXT' },
    { key: 'dmarc', name: `_dmarc.${domain}`, type: 'TXT' },
    { key: 'dkim', name: `${selector || 'default'}._domainkey.${domain}`, type: 'TXT' },
    { key: 'mta', name: `_mta-sts.${domain}`, type: 'TXT' },
    { key: 'tlsrpt', name: `_smtp._tls.${domain}`, type: 'TXT' },
    { key: 'bimi', name: `default._bimi.${domain}`, type: 'TXT' },
  ];

  try {
    const settled = await Promise.allSettled(queries.map((query) => dohQuery(query.name, query.type, 'cloudflare')));
    const results = {};
    const raw = {};
    const digParts = [];
    settled.forEach((outcome, index) => {
      const query = queries[index];
      const value = outcome.status === 'fulfilled' ? outcome.value : null;
      results[query.key] = value;
      raw[query.key] = value;
      digParts.push(formatDig(value, { name: query.name, type: query.type }));
    });
    const parsed = buildEmailChecks(
      domain,
      results.mx,
      results.txt,
      results.dmarc,
      results.dkim,
      results.mta,
      results.tlsrpt,
      results.bimi,
    );
    const digText = combineDigs(digParts);
    renderEmailDns(domain, selector || 'default', results, parsed, digText, raw);
    toast(`${domain} — ${parsed.score}/100`, parsed.score >= 75 ? 'good' : 'warn', 2400);
  } catch (error) {
    if (container) {
      container.innerHTML = errorCard(error.message || t('Email DNS checks failed.'), 'DNS-over-HTTPS');
      translateDOM(container);
    }
    toast(error.message || t('Email DNS checks failed.'), 'bad');
  } finally {
    emailLoading = false;
    setBusy(button, false, t('Check email DNS'));
    container?.setAttribute('aria-busy', 'false');
  }
}

/* ------------------------------------------------------------------ */
/* Wire-up                                                             */
/* ------------------------------------------------------------------ */

export function initEmail() {
  $('#smtp-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runSmtp();
  });
  $('#email-dns-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runEmailDns();
  });

  document.addEventListener('click', (event) => {
    const example = event.target.closest('[data-smtp-example]');
    if (example) {
      const host = example.dataset.smtpExample;
      const port = example.dataset.smtpPort || '587';
      if ($('#smtp-host')) $('#smtp-host').value = host;
      if ($('#smtp-port')) $('#smtp-port').value = port;
      if ($('#smtp-mode')) $('#smtp-mode').value = 'auto';
      runSmtp();
      return;
    }
    if (event.target.closest('[data-smtp-rerun]')) {
      runSmtp();
      return;
    }
    const digButton = event.target.closest('[data-email-dig]');
    if (digButton) {
      const panel = $('#email-dig');
      if (panel) {
        panel.hidden = !panel.hidden;
        digButton.setAttribute('aria-expanded', String(!panel.hidden));
      }
      return;
    }
    if (event.target.closest('[data-email-copy]') && lastEmail) {
      const text = JSON.stringify({
        domain: lastEmail.domain,
        dkimSelector: lastEmail.selector,
        score: lastEmail.score,
        grade: lastEmail.grade,
        checks: lastEmail.checks,
        dig: lastEmail.digText,
      }, null, 2);
      copyText(text).then((ok) => {
        if (ok) toast(t('Report copied'), 'good', 1600);
        else toast(t('Copy failed'), 'bad');
      });
      return;
    }
    if (event.target.closest('[data-email-download]') && lastEmail) {
      downloadFile(`email-${lastEmail.domain}.json`, JSON.stringify({
        generatedAt: new Date().toISOString(),
        domain: lastEmail.domain,
        dkimSelector: lastEmail.selector,
        score: lastEmail.score,
        grade: lastEmail.grade,
        checks: lastEmail.checks,
        raw: lastEmail.raw,
        dig: lastEmail.digText,
      }, null, 2));
      toast(t('Report downloaded'), 'good');
    }
  });
}

export function showEmail() {
  /* no automatic network operation */
}

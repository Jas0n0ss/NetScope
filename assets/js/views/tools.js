/**
 * Tools — subnet calculator, IP converter, URL anatomy, latency, WebRTC, ports.
 */

import {
  $, esc, icon, setBusy, errorCard,
} from '../lib/core.js';
import { subnetInfo, ipConvert, parseUrlInfo, isIPv4, isIPv6 } from '../lib/tools.js';
import { checkPort } from '../lib/api.js';
import { t } from '../lib/i18n.js';

let latencyRunning = false;
let rtcRunning = false;

function rowsMarkup(rows) {
  return `<dl class="kv">${rows.map((row) => `
    <div${row.full ? ' class="span-all"' : ''}>
      <dt>${esc(row.label)}</dt>
      <dd${row.mono ? ' class="mono"' : ''}${row.small ? ' style="font-size:10px"' : ''}>${esc(row.value ?? '—')}</dd>
    </div>`).join('')}</dl>`;
}

function inlineError(message) {
  return `<div class="result-pill is-bad">${icon('alert')}<span>${esc(message)}</span></div>`;
}

/* ------------------------------------------------------------------ */
/* Subnet                                                              */
/* ------------------------------------------------------------------ */

function runSubnet() {
  const output = $('#subnet-output');
  const input = $('#subnet-input');
  if (!output || !input) return;
  const result = subnetInfo(input.value);
  if (result.error) {
    output.innerHTML = inlineError(result.error);
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  input.removeAttribute('aria-invalid');
  output.innerHTML = `
    <div class="result-pill is-good" style="margin-bottom:12px">
      ${icon('layers')}<span class="mono">${esc(result.summary)}</span>
      <span class="badge badge-${result.version === 4 ? 'info' : 'neutral'} badge-no-dot">IPv${result.version}</span>
    </div>
    ${rowsMarkup(result.rows)}
    <p class="hint" style="margin-top:12px">${esc(result.note)}</p>
  `;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    output.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------------ */
/* IP converter                                                        */
/* ------------------------------------------------------------------ */

function runConvert() {
  const output = $('#convert-output');
  const input = $('#convert-input');
  if (!output || !input) return;
  const result = ipConvert(input.value);
  if (result.error) {
    output.innerHTML = inlineError(result.error);
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  input.removeAttribute('aria-invalid');
  output.innerHTML = `
    <div class="result-pill is-good" style="margin-bottom:12px">
      ${icon('shuffle')}<span class="mono">${esc(result.title)}</span>
      <span class="badge badge-neutral badge-no-dot">IPv${result.version}</span>
    </div>
    ${rowsMarkup(result.rows)}
  `;
}

/* ------------------------------------------------------------------ */
/* URL anatomy                                                         */
/* ------------------------------------------------------------------ */

function runUrl() {
  const output = $('#url-output');
  const input = $('#url-input');
  if (!output || !input) return;
  const result = parseUrlInfo(input.value);
  if (result.error) {
    output.innerHTML = inlineError(result.error);
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  input.removeAttribute('aria-invalid');
  const params = result.params.length
    ? `<h4>${esc(t('Query parameters ({n})', { n: result.params.length }))}</h4>
       <div class="table-wrap" tabindex="0">
         <table class="data compact">
           <thead><tr><th scope="col">Key</th><th scope="col">Value</th></tr></thead>
           <tbody>${result.params.map((param) => `<tr>
             <td class="cell-type" data-i18n-ignore>${esc(param.key)}</td>
             <td class="cell-value" data-i18n-ignore>${esc(param.value)}</td>
           </tr>`).join('')}</tbody>
         </table>
       </div>`
    : '<p class="placeholder-note">No query parameters.</p>';
  output.innerHTML = `
    ${rowsMarkup(result.rows)}
    ${params}
    ${result.warnings.length ? `<h4>Observations</h4><ul class="check-list">
      ${result.warnings.map((warning) => `<li>${icon('info')}<span>${esc(warning)}</span></li>`).join('')}
    </ul>` : ''}
  `;
}

/* ------------------------------------------------------------------ */
/* Latency                                                             */
/* ------------------------------------------------------------------ */

const LATENCY_TARGETS = [
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/generate_204' },
  { id: 'github', name: 'GitHub', url: 'https://api.github.com/zen' },
  { id: 'origin', name: 'This server', url: () => new URL(`assets/favicon.svg?ping=${Date.now()}`, window.location.href).href, sameOrigin: true },
];

async function probe(url, { sameOrigin = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  const started = performance.now();
  try {
    await fetch(url, {
      mode: sameOrigin ? 'same-origin' : 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    return performance.now() - started;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runLatency() {
  if (latencyRunning) return;
  const output = $('#latency-output');
  const button = $('#latency-run');
  if (!output || !button) return;
  latencyRunning = true;
  setBusy(button, true, 'Probing');
  output.innerHTML = `<div class="latency-list">${LATENCY_TARGETS.map((target) => `
    <div class="latency-row"><span class="latency-name">${esc(target.name)}</span>
      <div class="latency-track"><span style="width:8%"></span></div>
      <span class="latency-ms mono">…</span>
    </div>`).join('')}</div>`;

  const results = await Promise.all(LATENCY_TARGETS.map(async (target) => {
    const samples = [];
    for (let index = 0; index < 3; index += 1) {
      const url = typeof target.url === 'function' ? target.url() : target.url;
      const value = await probe(url, { sameOrigin: target.sameOrigin });
      if (value !== null) samples.push(value);
    }
    const sorted = samples.sort((a, b) => a - b);
    return { ...target, samples, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null };
  }));

  const max = Math.max(60, ...results.map((result) => result.median || 0));
  output.innerHTML = `<div class="latency-list">
    ${results.map((result) => {
      const ms = result.median;
      const width = ms === null ? 2 : Math.max(4, (ms / max) * 100);
      const slow = ms !== null && ms > 300;
      return `<div class="latency-row${slow ? ' is-slow' : ''}">
        <span class="latency-name">${esc(result.name)}</span>
        <div class="latency-track"><span style="width:${width}%"></span></div>
        <span class="latency-ms mono">${ms === null ? 'blocked' : `${Math.round(ms)} ms`}</span>
      </div>`;
    }).join('')}
  </div>
  <p class="hint" style="margin-top:12px">Approximate round-trip time from this browser. Cross-origin probes use opaque requests, so numbers include connection setup.</p>`;

  latencyRunning = false;
  setBusy(button, false, 'Run probe');
}

/* ------------------------------------------------------------------ */
/* WebRTC leak                                                         */
/* ------------------------------------------------------------------ */

function classifyAddress(address) {
  if (!address) return 'Local';
  if (address.endsWith('.local')) return 'mDNS';
  if (isIPv4(address)) {
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(address)) return 'Local';
    if (/^127\./.test(address)) return 'Loopback';
    return 'Public';
  }
  if (isIPv6(address)) {
    if (/^fe80/i.test(address) || /^fc|^fd/i.test(address) || address === '::1') return 'Local';
    return 'Public';
  }
  return 'Local';
}

function gatherCandidates(timeout = 4000) {
  return new Promise((resolve, reject) => {
    if (!window.RTCPeerConnection) {
      reject(new Error('WebRTC is not available in this browser.'));
      return;
    }
    const found = new Map();
    let peer;
    try {
      peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    } catch (error) {
      reject(new Error('WebRTC could not be initialized.'));
      return;
    }

    const finish = () => {
      try {
        peer.close();
      } catch {
        /* ignore */
      }
      resolve(Array.from(found.values()));
    };

    const timer = setTimeout(finish, timeout);
    peer.addEventListener('icecandidate', (event) => {
      if (!event.candidate) {
        clearTimeout(timer);
        setTimeout(finish, 150);
        return;
      }
      const parts = event.candidate.candidate.split(' ');
      const address = parts[4];
      const port = parts[5];
      const protocol = parts[2];
      const type = parts[7];
      if (!address || address === '0.0.0.0' || address === '::') return;
      const key = `${address}:${port}`;
      if (!found.has(key)) {
        found.set(key, {
          address,
          port,
          protocol,
          type,
          classification: classifyAddress(address),
        });
      }
    });

    peer.createDataChannel('netscope');
    peer.createOffer()
      .then((offer) => peer.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timer);
        reject(new Error('WebRTC offer could not be created.'));
      });
  });
}

async function runRtc() {
  if (rtcRunning) return;
  const output = $('#rtc-output');
  const button = $('#rtc-run');
  if (!output || !button) return;
  rtcRunning = true;
  setBusy(button, true, 'Gathering');
  output.innerHTML = '<p class="placeholder-note">Gathering ICE candidates…</p>';
  try {
    const candidates = await gatherCandidates();
    if (!candidates.length) {
      output.innerHTML = `<p class="placeholder-note">No ICE candidates were exposed. Your browser, an extension or a firewall is preventing WebRTC discovery — a good default.</p>`;
    } else {
      const publicCount = candidates.filter((candidate) => candidate.classification === 'Public').length;
      output.innerHTML = `
        <div class="result-pill ${publicCount ? 'is-good' : ''}" style="margin-bottom:10px">
          ${icon(publicCount ? 'eye' : 'lock')}
          <span>${esc(t('{n} candidates exposed', { n: candidates.length }))}${publicCount ? esc(t(' · {n} public', { n: publicCount })) : esc(t(' · no public address'))}</span>
        </div>
        <ul class="rtc-list">
          ${candidates.map((candidate) => `<li>
            <span class="badge badge-${candidate.classification === 'Public' ? 'good' : 'neutral'} badge-no-dot">${esc(candidate.classification)}</span>
            <span class="mono">${esc(candidate.address)}${candidate.port ? `:${esc(candidate.port)}` : ''}</span>
            <span class="muted">${esc(candidate.protocol)} · ${esc(candidate.type)}</span>
          </li>`).join('')}
        </ul>
        <p class="hint">Public candidates reveal your IP to sites that use WebRTC. mDNS “.local” entries are privacy-protected and reveal nothing.</p>`;
    }
  } catch (error) {
    output.innerHTML = inlineError(error.message || 'WebRTC gathering failed.');
  } finally {
    rtcRunning = false;
    setBusy(button, false, 'Gather candidates');
  }
}

/* ------------------------------------------------------------------ */
/* Port reachability                                                   */
/* ------------------------------------------------------------------ */

async function runPort() {
  const output = $('#port-output');
  const host = $('#port-input')?.value.trim();
  const port = Number($('#port-number')?.value);
  const button = $('#port-form')?.querySelector('button[type="submit"]');
  if (!output) return;
  if (!host) {
    output.innerHTML = inlineError('Enter a hostname or public IP address.');
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    output.innerHTML = inlineError('Port must be an integer between 1 and 65535.');
    return;
  }
  setBusy(button, true, 'Checking');
  output.innerHTML = `<p class="placeholder-note">${esc(t('Opening a TCP connection…'))}</p>`;
  try {
    const result = await checkPort(host, port);
    if (result.open) {
      const address = result.address || host;
      const latency = result.latency_ms !== undefined ? Math.round(result.latency_ms) : '—';
      output.innerHTML = `<div class="result-pill is-good">${icon('check')}
        <span>${esc(t('Port {port} on {host} is open', { port, host: result.host || host }))}</span></div>
        <p class="metric-sub">${esc(t('Connected to {address} in {ms} ms.', { address, ms: latency }))}</p>`;
    } else {
      output.innerHTML = `<div class="result-pill is-bad">${icon('x')}
        <span>${esc(t('Port {port} on {host} did not accept a connection', { port, host: result.host || host }))}</span></div>
        <p class="metric-sub">${esc(result.error || t('The port may be closed, filtered, or the host unreachable.'))}</p>`;
    }
  } catch (error) {
    output.innerHTML = errorCard(
      error.message || 'Port check failed.',
      error.hint || 'Port checks require the NetScope API. Public hosts only.',
    );
  } finally {
    setBusy(button, false, 'Check');
  }
}

export function initTools() {
  $('#subnet-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runSubnet();
  });
  $('#convert-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runConvert();
  });
  $('#url-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runUrl();
  });
  $('#latency-run')?.addEventListener('click', runLatency);
  $('#rtc-run')?.addEventListener('click', runRtc);
  $('#port-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    runPort();
  });

  const urlInput = $('#url-input');
  if (urlInput && !urlInput.value) urlInput.value = window.location.href;
}

export function showTools() {
  /* no automatic network operations */
}

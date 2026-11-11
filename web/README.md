# NetScope — Network Toolbox

A single-page network diagnostic console built as a dark "instrument panel": public IP, geolocation, DoH + dig,
RDAP, email authentication, website/TLS inspection, subnet math and client signals. Static-first, no cookies,
no analytics, no server-side logging.

This is the Vite + React rewrite of the original vanilla/Flask front end. It lives in `web/` and leaves the
legacy app (`index.html`, `assets/`, `pyapp/`) untouched.

![Overview](docs/screenshots/overview.png)

## Stack

| Layer | Choice |
| --- | --- |
| Build | Vite 6 + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS 3 with a custom dark instrument theme |
| Icons | lucide-react |
| Fonts | self-hosted `@fontsource-variable` Inter + JetBrains Mono (no Google Fonts) |
| Hosting | Cloudflare Pages, static `dist/` |

Hash routing (`#/overview` … `#/browser`) keeps the build purely static, so no SSR and no rewrite rules are
needed at the edge. `public/_redirects` is included for safety if path routing is adopted later.

## Views

| # | Route | What it does |
| --- | --- | --- |
| 1 | `#/overview` | Dual-stack public IP, geolocation, origin latency sparkline, connection profile, local session log |
| 2 | `#/lookup` | Domain → A/AAAA → geolocation + RDAP registry data (registrar, status, DNSSEC, expiry) |
| 3 | `#/dns` | Eleven record types over DoH (Cloudflare → Google fallback), answer/authority tables, dig transcript |
| 4 | `#/email` | SPF / DKIM / DMARC / MTA-STS / TLS-RPT / BIMI matrix with weighted score and next actions |
| 5 | `#/website` | Header audit, redirect chain, TLS certificate and metadata — requires the inspector API |
| 6 | `#/tools` | Subnet/CIDR math, IP conversion, URL anatomy, latency probe, WebRTC ICE check, TCP port check |
| 7 | `#/browser` | UA parse, viewport/DPR, hardware, storage, WebGL/WebGPU, privacy flags, reported link |

![DNS](docs/screenshots/dns.png)
![Email audit](docs/screenshots/email.png)

## Languages & themes

Every view ships in English and Simplified Chinese, with a light and a dark theme — both switchable from the
top bar (`中` / `EN`, sun / moon) or from **Settings → Locale preferences**.

| Preference | Values | Storage key | Default |
| --- | --- | --- | --- |
| Language | `en` / `zh` | `netscope.v2.lang` | `navigator.language` starting with `zh`, else English |
| Theme | `dark` / `light` | `netscope.v2.theme` | `dark` |

- Copy is translated through a tiny store (`src/lib/i18n.ts`): the English sentence is the dictionary key, so a
  missing translation falls back to English instead of an empty string. `useT()` re-renders the whole tree on
  switch, and `document.documentElement.lang` follows (`zh-CN` / `en`).
- Colours are CSS variables in `src/index.css` exposed through Tailwind tokens (`bg-panel`, `text-ink`,
  `border-line`…). `html[data-theme="light"]` swaps the palette: paper-white surfaces with near-black accents,
  while semantic teal / amber / danger / sky are darkened for contrast. The theme is applied before first paint
  to avoid a flash, and `theme-color` is kept in sync.

![Overview in light theme, Chinese](docs/screenshots/overview-light-zh.png)
![DNS in light theme, Chinese](docs/screenshots/dns-light-zh.png)

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:5180
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/
```

Node 18+ recommended.

## Deploy to Cloudflare Pages

**Dashboard** — create a Pages project from this repository:

- Root directory: `web`
- Build command: `npm run build`
- Build output: `dist`

**CLI**

```bash
cd web
npm run build
npx wrangler pages deploy dist --project-name netscope
```

`wrangler.toml` already pins `pages_build_output_dir = "dist"`, and `public/_headers` sets immutable caching for
hashed assets plus `no-referrer` / `nosniff` / locked-down permissions.

## Optional inspector API

Website inspection, SMTP probing and TCP port checks need the bundled Flask backend (`../pyapp`). Without it the
UI stays fully usable and marks those panels as `REQUIRES API`.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r pyapp/requirements.txt
flask --app pyapp.app run -p 8080
```

Open **Settings** (or `⌘K` → Settings), set the API base to `http://localhost:8080`, and hit **Test**. The value
is stored in `localStorage`; health is cached for 15 s.

## Privacy model

- No cookies, no analytics, no third-party fonts or trackers.
- All lookups are client-side `fetch` calls with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.
- History lives in `localStorage` only (`netscope.v2.*`), capped at 8 entries, clearable from Settings.
- IP geolocation degrades `ipwho.is` → `ipinfo.io` → `api.ip.sb`; DoH uses Cloudflare then Google; RDAP via
  `rdap.org`.

## Keyboard

- `1`–`7` jump between views
- `⌘K` / `Ctrl+K` command palette
- `↑` `↓` `↵` `esc` inside the palette

## Structure

```
web/
├── public/            favicon, manifest, _redirects, _headers
├── src/
│   ├── components/    shell, palette, settings, toasts, UI primitives
│   ├── lib/           typed data layer (net, dns, dig, email, tools, store, format)
│   ├── views/         seven screens
│   └── index.css      design tokens: void/panel/line/acid + panel, ticked, terminal
├── tailwind.config.js
└── wrangler.toml
```

More screens: [lookup](docs/screenshots/lookup.png) · [website](docs/screenshots/website.png) ·
[tools](docs/screenshots/tools.png) · [mobile overview](docs/screenshots/overview-mobile.png) ·
[mobile tools](docs/screenshots/tools-mobile.png)

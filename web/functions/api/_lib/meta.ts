/**
 * Dependency-free HTML metadata extraction.
 *
 * This is a deliberately small tokenizer: it scans `<meta>`, `<link>`,
 * `<title>` and `<html>` tags with regular expressions instead of shipping an
 * HTML parser. Output fields mirror `extract_metadata` in pyapp/app.py.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '\u00b7',
  bull: '\u2022',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

export function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = new RegExp(ATTRIBUTE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1].toLowerCase();
    if (name in attributes) continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[name] = decodeEntities(raw);
  }
  return attributes;
}

function absoluteUrl(base: string, reference: string): string {
  const value = reference.trim();
  if (!value) return '';
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

export interface PageMetadata {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  viewport: string;
  generator: string;
  lang: string;
  favicon: string;
  og: {
    title: string;
    description: string;
    image: string;
    type: string;
    site_name: string;
  };
  twitter: {
    card: string;
    title: string;
    description: string;
    image: string;
  };
}

export function extractMetadata(html: string, baseUrl: string): PageMetadata {
  const meta: Record<string, string> = {};
  const openGraph: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  const icons: string[] = [];
  let canonical = '';
  let lang = '';
  let title = '';

  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) lang = (parseAttributes(htmlTag[0]).lang ?? '').trim();

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html) ?? /<title\b[^>]*>([\s\S]{0,400})/i.exec(html);
  if (titleMatch) {
    title = decodeEntities(titleMatch[1].replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const name = (attributes.name ?? '').trim().toLowerCase();
    const property = (attributes.property ?? '').trim().toLowerCase();
    const content = (attributes.content ?? '').trim();
    if (name) meta[name] = content;
    if (property.startsWith('og:')) openGraph[property.slice(3)] = content;
    if (name.startsWith('twitter:')) twitter[name.slice(8)] = content;
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const rel = (attributes.rel ?? '').toLowerCase();
    const href = (attributes.href ?? '').trim();
    if (!href) continue;
    if (rel.includes('canonical')) canonical = href;
    if (rel.includes('icon')) icons.push(href);
  }

  const description = (meta.description || openGraph.description || '').trim().slice(0, 1000);
  const image = openGraph.image || meta['twitter:image'] || '';
  const favicon = icons.length > 0 ? icons[0] : '/favicon.ico';
  const twitterImage = twitter.image ?? '';

  return {
    title,
    description,
    canonical: canonical ? absoluteUrl(baseUrl, canonical) : '',
    robots: meta.robots ?? '',
    viewport: meta.viewport ?? '',
    generator: meta.generator ?? '',
    lang,
    favicon: absoluteUrl(baseUrl, favicon),
    og: {
      title: openGraph.title ?? '',
      description: openGraph.description ?? '',
      image: image ? absoluteUrl(baseUrl, image) : '',
      type: openGraph.type ?? '',
      site_name: openGraph.site_name ?? '',
    },
    twitter: {
      card: twitter.card ?? '',
      title: twitter.title ?? '',
      description: twitter.description ?? '',
      image: twitterImage ? absoluteUrl(baseUrl, twitterImage) : '',
    },
  };
}

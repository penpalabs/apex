// Post-build: give every section its own indexable page. The app is a single-page app, so without this a search
// engine sees one URL for every topic. For each section this writes dist/<id>/index.html — the built index.html
// with that section's title, description, canonical URL and Open Graph tags, and its heading, summary, the specs its
// code cites and links to related sections as static HTML inside #root (createRoot replaces it when the app mounts,
// and the app reads the section back from the path), JSON-LD for search engines, and a link-preview image naming the section (og/<id>.png).
// Also writes sitemap.xml and robots.txt. Run after `vite build` (see package.json).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SECTIONS } from '../src/web/sections/registry';
import { GROUPS, SECTION_META, metaById, groupOf, pageTitle, HOME_TITLE } from '../src/web/sections';
import { BEACON_ORIGINS } from '../src/web/analytics';
import { ogImage } from './og-image';
import { specRefs } from './spec-refs';

// Canonical origin: GitHub Pages and Cloudflare serve the same build, and every copy points search engines here.
const SITE = new URL(JSON.parse(readFileSync('package.json', 'utf8')).homepage).origin;
const DIST = 'dist';

const html = (n: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, n));
// React escapes '<' in text, so every '<' opens a tag: keep what follows each '>'. Splitting (not a tag regex) means
// no '<' survives even from nested markup. Entities stay escaped.
const stripTags = (h: string) =>
  h.split('<').map((p, i) => (i ? p.slice(p.indexOf('>') + 1) : p)).join('').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clip to a search-snippet length on a word boundary (entities contain no spaces, so none is split). */
function clip(s: string, max = 155): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '') + '…';
}

// The page may load from and send to only itself and the analytics beacons, so a loaded capture or anything typed has
// nowhere else to go. 'unsafe-eval' is for the Playground, which evals the user's code in a blob: worker (a blob
// worker inherits this policy, so its fetches are confined too). Goes right after <meta charset> so it governs the
// module script that follows it.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-eval' ${BEACON_ORIGINS.script.join(' ')}`,
  "worker-src 'self' blob:",
  `connect-src 'self' ${BEACON_ORIGINS.connect.join(' ')}`,
  `img-src 'self' data: blob: ${BEACON_ORIGINS.img.join(' ')}`,
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const template = readFileSync(`${DIST}/index.html`, 'utf8');
// The home page keeps index.html's own description (already HTML-escaped there), so the text lives in one place.
const HOME_DESC = template.match(/<meta name="description" content="([^"]*)"/)![1];

// Structured data in a non-executing <script> (the CSP governs only executable scripts). '<' is escaped so no text
// can close the element early.
const jsonLd = (o: object) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o }).replace(/</g, '\\u003c')}</script>`;

type Image = { url: string; width: number; height: number };

function page(o: { title: string; desc: string; url: string; body: string; image: Image; ld: object }): string {
  const head =
    `<link rel="canonical" href="${o.url}" />\n` +
    `    <meta property="og:url" content="${o.url}" />\n` +
    `    <meta property="og:site_name" content="Apex" />\n` +
    `    <meta property="og:image" content="${o.image.url}" />\n` +
    `    <meta property="og:image:width" content="${o.image.width}" />\n` +
    `    <meta property="og:image:height" content="${o.image.height}" />\n` +
    `    <meta name="twitter:card" content="summary_large_image" />\n` +
    `    ${jsonLd(o.ld)}\n  </head>`;
  const out = template
    // function replacers: section text can contain '$', which a replacement string would treat as a pattern
    .replace('<meta charset="UTF-8" />', (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    .replace(/<title>.*?<\/title>/, () => `<title>${esc(o.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, a) => a + o.desc)
    .replace(/(<meta property="og:title" content=")[^"]*/, (_, a) => a + esc(o.title))
    .replace(/(<meta property="og:description" content=")[^"]*/, (_, a) => a + o.desc)
    .replace('</head>', () => head)
    .replace('<div id="root"></div>', () => `<div id="root">${o.body}</div>`);
  for (const must of [o.url, o.body, CSP]) if (!out.includes(must)) throw new Error(`template did not take ${o.url}`);
  return out;
}

const links = (ids: string[], prefix: string) =>
  `<ul>${ids.map((id) => `<li><a href="${prefix}${id}/">${esc(metaById[id].label)}</a></li>`).join('')}</ul>`;

const urls = [`${SITE}/`];
const titles = new Set<string>();
const noscript = '<noscript><p>The simulations need JavaScript.</p></noscript>';
const HOST = new URL(SITE).host;
const SPECS = specRefs();
// Same list SectionHost renders, so the page a crawler reads matches the one the app shows.
const specList = (id: string) => SPECS[id] ? `<h2>Specs cited in this section's code</h2><ul>${SPECS[id].map((r) => `<li><a href="${r.url}">${esc(r.name)}</a></li>`).join('')}</ul>` : '';
mkdirSync(`${DIST}/og`, { recursive: true });

for (const { id, label } of SECTION_META) {
  const e = SECTIONS[id];
  const group = groupOf(id)!;
  const titleHtml = e ? html(e.title) : esc(label);
  const subHtml = e ? html(e.sub) : `${esc(label)}, simulated in your browser.`;
  const url = `${SITE}/${id}/`;
  const siblings = GROUPS.find((g) => g.label === group)!.ids.filter((x) => x !== id);
  const body =
    `<main><p><a href="../">Apex</a> › ${esc(group)}</p><h1>${titleHtml}</h1><p class="sub">${subHtml}</p>${noscript}` +
    `${specList(id)}<h2>More in ${esc(group)}</h2>${links(siblings, '../')}</main>`;
  mkdirSync(`${DIST}/${id}`, { recursive: true });
  const image = { url: `${SITE}/og/${id}.png`, width: 1200, height: 630 };
  const ld = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Apex', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: label, item: url },
    ],
  };
  writeFileSync(`${DIST}/${id}/index.html`, page({ title: pageTitle(id), desc: clip(stripTags(subHtml)), url, body, image, ld }));
  titles.add(pageTitle(id));
  urls.push(url);
}

const catalog = GROUPS.map((g) => `<h2>${esc(g.label)}</h2>${links(g.ids, '')}`).join('');
writeFileSync(
  `${DIST}/index.html`,
  page({
    title: HOME_TITLE, desc: HOME_DESC, url: `${SITE}/`,
    body: `<main><h1>Apex</h1><p class="sub">${HOME_DESC}</p>${noscript}${catalog}</main>`,
    image: { url: `${SITE}/og.png`, width: 2400, height: 1260 },
    ld: { '@type': 'WebSite', name: 'Apex', url: `${SITE}/` }, // the site name Google shows in results
  }),
);

writeFileSync(
  `${DIST}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`,
);
// Rendered in parallel: the rasterizing runs on libuv's thread pool (see og-image.ts).
await Promise.all(SECTION_META.map(async ({ id, label }) => writeFileSync(`${DIST}/og/${id}.png`, await ogImage(label, groupOf(id)!, HOST))));

writeFileSync(`${DIST}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

if (titles.size !== SECTION_META.length) throw new Error(`duplicate page titles: ${SECTION_META.length - titles.size}`);
console.log(`prerender: ${SECTION_META.length} section pages + preview images + home, sitemap.xml (${urls.length} URLs), robots.txt → ${SITE}`);

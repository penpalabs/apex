// Post-build: give every section its own indexable page. The app is a single-page app, so without this a search
// engine sees one URL for every topic. For each section this writes dist/<id>/index.html — the built index.html
// with that section's title, description, canonical URL and Open Graph tags, and its heading, summary and links to
// related sections as static HTML inside #root (createRoot replaces it when the app mounts, and the app reads the
// section back from the path). Also writes sitemap.xml and robots.txt. Run after `vite build` (see package.json).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SECTIONS } from '../src/web/sections/registry';
import { GROUPS, SECTION_META, metaById, groupOf, pageTitle, HOME_TITLE } from '../src/web/sections';

// Canonical origin: GitHub Pages and Cloudflare serve the same build, and every copy points search engines here.
const SITE = new URL(JSON.parse(readFileSync('package.json', 'utf8')).homepage).origin;
const DIST = 'dist';
const HOME_DESC =
  'Interactive, in-browser visualizations of how computers work — networking, cryptography, transport and the web, ' +
  'distributed systems, databases, algorithms, hardware and OS internals. Build it, break it, watch it run.';

const html = (n: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, n));
const stripTags = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); // entities stay escaped
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clip to a search-snippet length on a word boundary (entities contain no spaces, so none is split). */
function clip(s: string, max = 155): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '') + '…';
}

const template = readFileSync(`${DIST}/index.html`, 'utf8');

function page(o: { title: string; desc: string; url: string; body: string }): string {
  const head =
    `<link rel="canonical" href="${o.url}" />\n` +
    `    <meta property="og:url" content="${o.url}" />\n` +
    `    <meta property="og:site_name" content="Apex" />\n` +
    `    <meta property="og:image" content="${SITE}/og.png" />\n` +
    `    <meta property="og:image:width" content="2400" />\n` +
    `    <meta property="og:image:height" content="1260" />\n` +
    `    <meta name="twitter:card" content="summary_large_image" />\n  </head>`;
  const out = template
    // function replacers: section text can contain '$', which a replacement string would treat as a pattern
    .replace(/<title>.*?<\/title>/, () => `<title>${esc(o.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, a) => a + o.desc)
    .replace(/(<meta property="og:title" content=")[^"]*/, (_, a) => a + esc(o.title))
    .replace(/(<meta property="og:description" content=")[^"]*/, (_, a) => a + o.desc)
    .replace('</head>', () => head)
    .replace('<div id="root"></div>', () => `<div id="root">${o.body}</div>`);
  for (const must of [o.url, o.body]) if (!out.includes(must)) throw new Error(`template did not take ${o.url}`);
  return out;
}

const links = (ids: string[], prefix: string) =>
  `<ul>${ids.map((id) => `<li><a href="${prefix}${id}/">${esc(metaById[id].label)}</a></li>`).join('')}</ul>`;

const urls = [`${SITE}/`];
const titles = new Set<string>();
const noscript = '<noscript><p>The simulations need JavaScript.</p></noscript>';

for (const { id, label } of SECTION_META) {
  const e = SECTIONS[id];
  const group = groupOf(id)!;
  const titleHtml = e ? html(e.title) : esc(label);
  const subHtml = e ? html(e.sub) : `${esc(label)}, simulated in your browser.`;
  const url = `${SITE}/${id}/`;
  const siblings = GROUPS.find((g) => g.label === group)!.ids.filter((x) => x !== id);
  const body =
    `<main><p><a href="../">Apex</a> › ${esc(group)}</p><h1>${titleHtml}</h1><p class="sub">${subHtml}</p>${noscript}` +
    `<h2>More in ${esc(group)}</h2>${links(siblings, '../')}</main>`;
  mkdirSync(`${DIST}/${id}`, { recursive: true });
  writeFileSync(`${DIST}/${id}/index.html`, page({ title: pageTitle(id), desc: clip(stripTags(subHtml)), url, body }));
  titles.add(pageTitle(id));
  urls.push(url);
}

const catalog = GROUPS.map((g) => `<h2>${esc(g.label)}</h2>${links(g.ids, '')}`).join('');
writeFileSync(
  `${DIST}/index.html`,
  page({ title: HOME_TITLE, desc: esc(HOME_DESC), url: `${SITE}/`, body: `<main><h1>Apex</h1><p class="sub">${esc(HOME_DESC)}</p>${noscript}${catalog}</main>` }),
);

writeFileSync(
  `${DIST}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`,
);
writeFileSync(`${DIST}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

if (titles.size !== SECTION_META.length) throw new Error(`duplicate page titles: ${SECTION_META.length - titles.size}`);
console.log(`prerender: ${SECTION_META.length} section pages + home, sitemap.xml (${urls.length} URLs), robots.txt → ${SITE}`);

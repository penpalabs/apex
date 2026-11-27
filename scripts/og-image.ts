// A 1200×630 link-preview image per section (the size Open Graph and X cards expect): the section's title over the
// site's dark background, so a shared link names its topic instead of showing the same picture for every page.
// satori lays the text out (wrapping included) as SVG paths, resvg rasterizes it; both run in plain Node at build.
// Rasterizing is nearly all of the cost; renderAsync runs it on libuv's thread pool, so callers can run images in parallel.
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import satori from 'satori';
import { renderAsync } from '@resvg/resvg-js';

const font = (pkg: string, file: string) => readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`);
// One name per file: satori picks among a family list per glyph, but ignores a second file under the same name.
// Latin + Greek + math covers every title today (π, γ, δ, φ and → appear); a glyph none of them has fails the build
// (see loadAdditionalAsset below) rather than shipping a "no glyph" box.
const FONTS = [
  { name: 'Serif', weight: 600 as const, data: font('source-serif-4', 'source-serif-4-latin-600-normal.woff') },
  { name: 'SerifGreek', weight: 600 as const, data: font('source-serif-4', 'source-serif-4-greek-600-normal.woff') },
  { name: 'Sans', weight: 500 as const, data: font('inter', 'inter-latin-500-normal.woff') },
  { name: 'SansGreek', weight: 500 as const, data: font('inter', 'inter-greek-500-normal.woff') },
  { name: 'Math', weight: 400 as const, data: font('noto-sans-math', 'noto-sans-math-latin-400-normal.woff') },
];

const BG = '#1b2330'; // index.html theme-color
const CYAN = '#26c7d9'; // the header's ◆ (hsl(186 70% 50%))

export async function ogImage(title: string, group: string, host: string): Promise<Buffer> {
  const size = title.length <= 28 ? 84 : title.length <= 44 ? 72 : 60;
  const svg = await satori(
    h('div', { style: { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 84px', background: BG, fontFamily: 'Sans, SansGreek, Math' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 22 } },
        h('div', { style: { width: 26, height: 26, background: CYAN, transform: 'rotate(45deg)' } }),
        h('div', { style: { fontSize: 34, color: '#e8edf3' } }, 'Apex'),
        h('div', { style: { fontSize: 26, color: CYAN, marginLeft: 12, letterSpacing: 2, textTransform: 'uppercase' } }, group)),
      h('div', { style: { fontFamily: 'Serif, SerifGreek, Math', fontSize: size, lineHeight: 1.12, color: '#f2f5f8' } }, title),
      h('div', { style: { fontSize: 26, color: '#8a97a8' } }, `Interactive visualization · ${host}`)),
    {
      width: 1200, height: 630, fonts: FONTS,
      loadAdditionalAsset: async (_lang, text) => { throw new Error(`og image for "${title}": no font has "${text}"; add one to FONTS`); },
    },
  );
  return (await renderAsync(svg)).asPng();
}

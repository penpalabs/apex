// The standards each section's code cites (RFC, FIPS, NIST SP), read from the section's view, the models it imports,
// and those models' tests, so a section page can link the specs it follows. Read from the source rather than
// listed by hand, so the list changes with the code. Runs at build time only (vite.config.ts, prerender.ts).
import { readFileSync, readdirSync, existsSync } from 'node:fs';

export interface SpecRef { name: string; url: string }

// NIST and FIPS URLs carry revision and part segments a number can't predict; a citation not listed here fails the
// build (specUrl) instead of shipping a broken link.
const NIST: Record<string, string> = {
  'FIPS 180-4': 'https://csrc.nist.gov/pubs/fips/180-4/upd1/final',
  'FIPS 203': 'https://csrc.nist.gov/pubs/fips/203/final',
  'FIPS 205': 'https://csrc.nist.gov/pubs/fips/205/final',
  'NIST SP 800-38A': 'https://csrc.nist.gov/pubs/sp/800/38/a/final',
  'NIST SP 800-38D': 'https://csrc.nist.gov/pubs/sp/800/38/d/final',
  'NIST SP 800-57': 'https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final',
  'NIST SP 800-208': 'https://csrc.nist.gov/pubs/sp/800/208/final',
};

const CITE = /\b(RFC ?\d{3,5}|FIPS ?\d{2,3}(?:-\d)?|NIST SP ?800-\d+[A-Z]?)\b/g;

export function specUrl(name: string): string {
  const rfc = name.match(/^RFC (\d+)$/);
  if (rfc) return `https://www.rfc-editor.org/rfc/rfc${rfc[1]}.html`;
  const url = NIST[name];
  if (!url) throw new Error(`no URL for "${name}"; add it to NIST in scripts/spec-refs.ts`);
  return url;
}

const cites = (path: string) =>
  existsSync(path) ? [...readFileSync(path, 'utf8').matchAll(CITE)].map((m) => m[1].replace(/ ?(\d)/, ' $1')) : [];

// RFCs by number, then FIPS, then NIST SP.
const rank = (n: string) => [n.startsWith('RFC') ? 0 : n.startsWith('FIPS') ? 1 : 2, Number(n.match(/\d+/)![0])];
const order = (a: string, b: string) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b); };

/** Section id -> the specs its code cites, for every section that cites at least one. */
export function specRefs(web = 'src/web', tests = 'tests'): Record<string, SpecRef[]> {
  const out: Record<string, SpecRef[]> = {};
  for (const f of readdirSync(`${web}/sections`).filter((f) => /^chunk\d+\.tsx$/.test(f))) {
    const src = readFileSync(`${web}/sections/${f}`, 'utf8');
    const file = Object.fromEntries([...src.matchAll(/const (\w+) = lazySection\(\(\) => import\('\.\.\/([\w/]+)'\)/g)].map((m) => [m[1], m[2]]));
    for (const [, id, comp] of src.matchAll(/^\s*"([\w-]+)": \{ Component: (\w+)/gm)) {
      if (!file[comp]) throw new Error(`${f}: no lazySection import for ${comp} (section "${id}")`);
      const view = `${web}/${file[comp]}.tsx`;
      const models = [...readFileSync(view, 'utf8').matchAll(/from '\.\/([\w-]+)'/g)].map((m) => m[1]).filter((m) => existsSync(`${web}/${m}.ts`));
      const names = new Set([view, ...models.flatMap((m) => [`${web}/${m}.ts`, `${tests}/${m}.test.ts`])].flatMap(cites));
      if (names.size) out[id] = [...names].sort(order).map((name) => ({ name, url: specUrl(name) }));
    }
  }
  return out;
}

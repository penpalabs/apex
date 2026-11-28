// Renders any registry section: its header (title + sub) at once, then its component once its chunk has loaded, then
// the specs its code cites.
import { Suspense } from 'react';
import { SECTIONS } from './registry';
import type { SpecRef } from '../../../scripts/spec-refs';

declare const __SPEC_REFS__: Record<string, SpecRef[]>; // vite.config.ts `define`

export function SectionHost({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const e = SECTIONS[id];
  if (!e) return null;
  const { Component } = e;
  const refs = __SPEC_REFS__[id];
  return (
    <>
      <header>
        <h1>{e.title}</h1>
        <p className="sub">{e.sub}</p>
      </header>
      <Suspense fallback={<p className="sub">Loading…</p>}>
        <Component onOpen={onOpen} />
      </Suspense>
      {refs && (
        <aside className="spec-refs">
          <h2>Specs cited in this section's code</h2>
          <ul>{refs.map((r) => <li key={r.name}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a></li>)}</ul>
        </aside>
      )}
    </>
  );
}

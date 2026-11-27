// Renders any registry section: its header (title + sub) at once, then its component once its chunk has loaded.
import { Suspense } from 'react';
import { SECTIONS } from './registry';

export function SectionHost({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const e = SECTIONS[id];
  if (!e) return null;
  const { Component } = e;
  return (
    <>
      <header>
        <h1>{e.title}</h1>
        <p className="sub">{e.sub}</p>
      </header>
      <Suspense fallback={<p className="sub">Loading…</p>}>
        <Component onOpen={onOpen} />
      </Suspense>
    </>
  );
}

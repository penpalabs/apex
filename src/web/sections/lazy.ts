// Each section component loads as its own chunk on first open, so a visitor downloads the section they opened, not
// all of them. `name` is checked against the module's exports, so a typo is a type error rather than a blank section.
import { lazy, type ComponentType } from 'react';

export type SectionProps = { onOpen?: (id: string) => void };

export function lazySection<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType<SectionProps> }));
}

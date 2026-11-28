import { describe, it, expect } from 'vitest';
import { specRefs, specUrl } from '../scripts/spec-refs';
import { metaById } from '../src/web/sections';

const refs = specRefs();
const names = (id: string) => refs[id]?.map((r) => r.name) ?? [];

describe('spec references read from section code', () => {
  it('finds the spec a section is built on (expected values are the published spec numbers)', () => {
    expect(names('chacha')).toContain('RFC 8439'); // ChaCha20 and Poly1305 for IETF Protocols
    expect(names('tcphand')).toContain('RFC 9293'); // Transmission Control Protocol
    expect(names('ecdsa')).toContain('RFC 6979'); // deterministic ECDSA nonces
    expect(names('aead')).toContain('NIST SP 800-38D'); // GCM
  });

  it('keys are real section ids, each list is non-empty, unique and links to the publisher', () => {
    for (const [id, list] of Object.entries(refs)) {
      expect(metaById[id], id).toBeDefined();
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((r) => r.name)).size).toBe(list.length);
      for (const r of list) expect(r.url).toMatch(/^https:\/\/(www\.rfc-editor\.org|csrc\.nist\.gov)\//);
    }
  });

  it('fails loudly on a NIST citation with no known URL rather than guessing one', () => {
    expect(() => specUrl('NIST SP 800-999')).toThrow(/add it to NIST/);
  });
});

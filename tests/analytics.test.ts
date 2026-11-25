import { describe, expect, it } from 'vitest';
import { dwellBucket, goatcounterEventPath, isTrackedHost } from '../src/web/analytics';

describe('isTrackedHost', () => {
  const hosts = ['pen-pal.github.io', 'apex.example.com'];
  it('accepts only exact configured hostnames, case-insensitively', () => {
    expect(isTrackedHost('pen-pal.github.io', hosts)).toBe(true);
    expect(isTrackedHost('APEX.example.com', hosts)).toBe(true);
  });
  it('rejects dev servers, forks and look-alike suffixes', () => {
    for (const h of ['localhost', '127.0.0.1', 'someone.github.io', 'evil-pen-pal.github.io', 'example.com', ''])
      expect(isTrackedHost(h, hosts)).toBe(false);
  });
});

describe('dwellBucket', () => {
  it('maps each boundary to the bucket that starts there', () => {
    expect(dwellBucket(4.999)).toBe('<5s');
    expect(dwellBucket(5)).toBe('5-15s');
    expect(dwellBucket(15)).toBe('15-60s');
    expect(dwellBucket(60)).toBe('1-5m');
    expect(dwellBucket(300)).toBe('5m+');
  });
  it('is monotone: a longer visit never lands in an earlier bucket', () => {
    const order = ['<5s', '5-15s', '15-60s', '1-5m', '5m+'];
    let prev = 0;
    for (let s = 0; s <= 1000; s += 0.5) {
      const i = order.indexOf(dwellBucket(s));
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
});

describe('goatcounterEventPath', () => {
  it('keeps the section and bucket so events stay distinguishable per section', () => {
    expect(goatcounterEventPath('dwell', { section: 'tcp', bucket: '<5s', seconds: 3 })).toBe('event/dwell/tcp/%3C5s');
    expect(goatcounterEventPath('engaged', { section: 'dns' })).toBe('event/engaged/dns');
  });
  it('distinct sections never share a path', () => {
    expect(goatcounterEventPath('engaged', { section: 'a/b' })).not.toBe(goatcounterEventPath('engaged', { section: 'a' }));
  });
});

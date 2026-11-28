import { describe, it, expect } from 'vitest';
import { parityDisk, locate, build, rebuild, read, writeChunk, writeStripe, writeLoad, type Disks, type Level } from '../src/web/raid5';
import { mulberry32 } from '../src/web/reservoir';

// Rows are stripes, columns are disks; 'P' is parity, a number is the logical data chunk stored there. Worked by hand
// from Linux drivers/md/raid5.c raid5_compute_sector(): level 5 ALGORITHM_LEFT_SYMMETRIC sets
// pd_idx = data_disks - stripe % raid_disks and dd_idx = (pd_idx + 1 + dd_idx) % raid_disks; level 4 sets
// pd_idx = data_disks with dd_idx unchanged.
const LEFT_SYMMETRIC: Record<number, (string | number)[][]> = {
  3: [[0, 1, 'P'], [3, 'P', 2], ['P', 4, 5], [6, 7, 'P']],
  4: [[0, 1, 2, 'P'], [4, 5, 'P', 3], [8, 'P', 6, 7], ['P', 9, 10, 11], [12, 13, 14, 'P']],
  5: [[0, 1, 2, 3, 'P'], [5, 6, 7, 'P', 4], [10, 11, 'P', 8, 9], [15, 'P', 12, 13, 14], ['P', 16, 17, 18, 19], [20, 21, 22, 23, 'P']],
};
const RAID4_4DISKS = [[0, 1, 2, 'P'], [3, 4, 5, 'P'], [6, 7, 8, 'P']];

function grid(disks: number, stripes: number, level: Level): (string | number)[][] {
  const g = Array.from({ length: stripes }, (_, s) => Array.from({ length: disks }, (_, d) => (d === parityDisk(s, disks, level) ? 'P' : -1) as string | number));
  for (let c = 0; c < stripes * (disks - 1); c++) {
    const { stripe, disk } = locate(c, disks, level);
    g[stripe][disk] = c;
  }
  return g;
}

const randomBytes = (rand: () => number, n: number) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
const stripeXorIsZero = (cells: Disks) => cells[0].every((_, s) => cells[0][s].every((_, i) => cells.reduce((x, d) => x ^ d[s][i], 0) === 0));

describe('layout matches md', () => {
  for (const [n, table] of Object.entries(LEFT_SYMMETRIC)) {
    it(`left-symmetric, ${n} disks`, () => expect(grid(+n, table.length, 5)).toEqual(table));
  }
  it('RAID 4, 4 disks: parity fixed on the last disk', () => expect(grid(4, 3, 4)).toEqual(RAID4_4DISKS));
  it('left-symmetric is "data continuation": chunk c lands on disk c mod n', () => {
    for (let n = 3; n <= 8; n++) for (let c = 0; c < 5 * n * n; c++) expect(locate(c, n, 5).disk).toBe(c % n);
  });
});

describe('reconstruction', () => {
  const rand = mulberry32(5);
  for (let n = 3; n <= 8; n++) {
    it(`${n} disks: parity XORs to zero, any one disk rebuilds, any two lose data`, () => {
      for (const level of [4, 5] as Level[]) {
        const chunk = 1 + Math.floor(rand() * 4);
        const data = randomBytes(rand, 1 + Math.floor(rand() * 60));
        const cells = build(data, n, chunk, level);
        expect(stripeXorIsZero(cells)).toBe(true);
        expect(read(cells, [], level, data.length)).toEqual(data);
        for (let f = 0; f < n; f++) {
          const wiped = cells.map((d, i) => (i === f ? d.map((b) => new Uint8Array(b.length).fill(0xee)) : d)); // the dead disk's contents must not be used
          expect(rebuild(wiped, [f])).toEqual(cells);
          expect(read(wiped, [f], level, data.length)).toEqual(data);
          for (let g = f + 1; g < n; g++) expect(read(cells, [f, g], level, data.length)).toBeNull();
        }
      }
    });
  }
});

describe('write cost', () => {
  const rand = mulberry32(9);
  it('a one-chunk write is 2 reads + 2 writes and leaves parity consistent', () => {
    for (let n = 3; n <= 8; n++) {
      for (const level of [4, 5] as Level[]) {
        const data = randomBytes(rand, 2 * n * 3);
        const cells = build(data, n, 2, level);
        const c = Math.floor(rand() * (data.length / 2));
        const block = randomBytes(rand, 2);
        const w = writeChunk(cells, c, block, level);
        expect(w.ios.filter((io) => io.op === 'read')).toHaveLength(2);
        expect(w.ios.filter((io) => io.op === 'write')).toHaveLength(2);
        const expected = data.slice(); expected.set(block, c * 2);
        expect(read(w.cells, [], level, data.length)).toEqual(expected);
        expect(stripeXorIsZero(w.cells)).toBe(true);
        const touched = w.cells.map((d, i) => d.some((b, s) => b.some((x, j) => x !== cells[i][s][j]))).filter(Boolean).length;
        expect(touched).toBeLessThanOrEqual(2);
      }
    }
  });
  it('a full-stripe write reads nothing and writes every disk once', () => {
    for (let n = 3; n <= 8; n++) {
      const cells = build(randomBytes(rand, 3 * (n - 1) * 3), n, 3, 5);
      const blocks = Array.from({ length: n - 1 }, () => randomBytes(rand, 3));
      const w = writeStripe(cells, 1, blocks, 5);
      expect(w.ios.some((io) => io.op === 'read')).toBe(false);
      expect(new Set(w.ios.map((io) => io.disk)).size).toBe(n);
      expect(w.ios).toHaveLength(n);
      expect(stripeXorIsZero(w.cells)).toBe(true);
    }
  });
});

describe('parity hotspot', () => {
  it('RAID 4 sends every small write to the parity disk; RAID 5 spreads a full rotation evenly', () => {
    for (let n = 3; n <= 8; n++) {
      const chunks = Array.from({ length: n * (n - 1) }, (_, i) => i); // one write to each chunk of n stripes
      const r4 = writeLoad(chunks, n, 4);
      expect(r4[n - 1]).toBe(chunks.length);
      const r5 = writeLoad(chunks, n, 5);
      expect(new Set(r5).size).toBe(1);
      expect(r5.reduce((a, b) => a + b, 0)).toBe(2 * chunks.length);
    }
  });
});

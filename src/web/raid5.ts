// RAID 5: data is cut into chunks and striped across N disks; each stripe holds N-1 data chunks plus one parity
// chunk, the XOR of those data chunks. XOR of all N chunks in a stripe is therefore zero, so any one missing chunk
// (data or parity) is the XOR of the other N-1. Lose two disks and a stripe has two unknowns: the data is gone.
//
// Layout follows Linux md, raid5_compute_sector() in drivers/md/raid5.c (github.com/torvalds/linux), case
// ALGORITHM_LEFT_SYMMETRIC, which mdadm(8) documents as the default RAID 5 --layout:
//   pd_idx = data_disks - stripe % raid_disks;   dd_idx = (pd_idx + 1 + dd_idx) % raid_disks
// Parity starts on the last disk and moves one disk left per stripe; data resumes on the disk after parity. md's
// level-4 case (pd_idx = data_disks) is RAID 4: parity always on the last disk, data in disk order.
//
// A small write uses read-modify-write: new parity = old parity ^ old data ^ new data, so it reads the old data and
// the old parity and writes both back. md also counts the reads a reconstruct-write would need (the other data
// chunks of the stripe) and uses whichever needs fewer; this model shows read-modify-write only.
import { xorBytes } from './bytes';

export type Level = 4 | 5;

/** cells[disk][stripe] is one chunk. */
export type Disks = Uint8Array[][];

/** The disk holding a stripe's parity. */
export function parityDisk(stripe: number, disks: number, level: Level): number {
  return level === 4 ? disks - 1 : disks - 1 - (stripe % disks);
}

/** Where logical data chunk `chunk` lives. */
export function locate(chunk: number, disks: number, level: Level): { stripe: number; disk: number } {
  const stripe = Math.floor(chunk / (disks - 1));
  const idx = chunk % (disks - 1);
  return { stripe, disk: level === 4 ? idx : (parityDisk(stripe, disks, level) + 1 + idx) % disks };
}

/** XOR of a stripe's chunks on every disk except `skip`. */
function xorStripe(cells: Disks, stripe: number, skip: number): Uint8Array {
  return cells.filter((_, d) => d !== skip).map((disk) => disk[stripe]).reduce(xorBytes);
}

/** Stripe `data` across `disks` disks in `chunk`-byte chunks, zero-padding the last stripe, then fill in parity. */
export function build(data: Uint8Array, disks: number, chunk: number, level: Level): Disks {
  const stripes = Math.max(1, Math.ceil(data.length / (chunk * (disks - 1))));
  const cells: Disks = Array.from({ length: disks }, () => Array.from({ length: stripes }, () => new Uint8Array(chunk)));
  for (let c = 0; c * chunk < data.length; c++) {
    const { stripe, disk } = locate(c, disks, level);
    cells[disk][stripe].set(data.subarray(c * chunk, (c + 1) * chunk));
  }
  for (let s = 0; s < stripes; s++) {
    const p = parityDisk(s, disks, level);
    cells[p][s] = xorStripe(cells, s, p);
  }
  return cells;
}

/** Every disk's contents with the failed one recomputed from the survivors; null when two or more have failed. */
export function rebuild(cells: Disks, failed: number[]): Disks | null {
  if (failed.length > 1) return null;
  if (failed.length === 0) return cells;
  const f = failed[0];
  return cells.map((disk, d) => (d === f ? disk.map((_, s) => xorStripe(cells, s, f)) : disk));
}

/** Read the first `length` bytes of logical data back, rebuilding a failed disk if needed; null if data is lost. */
export function read(cells: Disks, failed: number[], level: Level, length: number): Uint8Array | null {
  const live = rebuild(cells, failed);
  if (!live) return null;
  const chunk = cells[0][0].length;
  const out = new Uint8Array(length);
  for (let c = 0; c * chunk < length; c++) {
    const { stripe, disk } = locate(c, cells.length, level);
    out.set(live[disk][stripe].subarray(0, length - c * chunk), c * chunk);
  }
  return out;
}

export interface Io { op: 'read' | 'write'; disk: number; what: 'data' | 'parity' }

/** The I/Os of a read-modify-write of one data chunk. */
export function smallWriteIos(chunk: number, disks: number, level: Level): Io[] {
  const { stripe, disk } = locate(chunk, disks, level);
  const p = parityDisk(stripe, disks, level);
  return [
    { op: 'read', disk, what: 'data' }, { op: 'read', disk: p, what: 'parity' },
    { op: 'write', disk, what: 'data' }, { op: 'write', disk: p, what: 'parity' },
  ];
}

/** Overwrite one data chunk by read-modify-write. */
export function writeChunk(cells: Disks, chunk: number, block: Uint8Array, level: Level): { cells: Disks; ios: Io[]; oldData: Uint8Array; oldParity: Uint8Array; newParity: Uint8Array } {
  const { stripe, disk } = locate(chunk, cells.length, level);
  const p = parityDisk(stripe, cells.length, level);
  const oldData = cells[disk][stripe];
  const oldParity = cells[p][stripe];
  const newParity = xorBytes(xorBytes(oldParity, oldData), block);
  const next = cells.map((d) => d.slice());
  next[disk][stripe] = block;
  next[p][stripe] = newParity;
  return { cells: next, ios: smallWriteIos(chunk, cells.length, level), oldData, oldParity, newParity };
}

/** Overwrite a whole stripe: parity comes from the new data alone, so nothing is read. */
export function writeStripe(cells: Disks, stripe: number, blocks: Uint8Array[], level: Level): { cells: Disks; ios: Io[] } {
  const n = cells.length;
  const next = cells.map((d) => d.slice());
  blocks.forEach((b, i) => { next[locate(stripe * (n - 1) + i, n, level).disk][stripe] = b; });
  const p = parityDisk(stripe, n, level);
  next[p][stripe] = xorStripe(next, stripe, p);
  const ios: Io[] = next.map((_, disk) => ({ op: 'write', disk, what: disk === p ? 'parity' : 'data' }));
  return { cells: next, ios };
}

/** Writes landing on each disk for a stream of small writes to the given data chunks. */
export function writeLoad(chunks: number[], disks: number, level: Level): number[] {
  const load = new Array<number>(disks).fill(0);
  for (const c of chunks) for (const io of smallWriteIos(c, disks, level)) if (io.op === 'write') load[io.disk]++;
  return load;
}

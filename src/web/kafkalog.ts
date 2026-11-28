// A Kafka-style partitioned log with one consumer group. Models the client-side rules, not a broker:
//  - key → partition is Kafka's default for keyed records, BuiltInPartitioner.partitionForKey:
//    toPositive(murmur2(keyBytes)) % numPartitions, with murmur2 and toPositive ported from
//    org.apache.kafka.common.utils.Utils (apache/kafka, clients/.../common/utils/Utils.java).
//  - partitions are split among the group's members by RangeAssignor's per-topic rule
//    (apache/kafka, clients/.../clients/consumer/RangeAssignor.java): members sorted, each gets
//    floor(P/C) consecutive partitions and the first P % C get one extra.
// Each partition is an append-only array; a record's offset is its index. The group stores one committed
// offset per partition; the current owner reads from an in-memory position that starts at the committed
// offset after every rebalance. Rebalance rule of this model: members still in the group commit their
// position before giving partitions up, a crashed member cannot, so what it read but did not commit is
// delivered again to the next owner (at-least-once).
import { enc } from './bytes';

/** Kafka's murmur2 (Utils.murmur2): 32-bit MurmurHash2, seed 0x9747b28c, little-endian 4-byte blocks.
 *  Returns a signed 32-bit int, like Java's. */
export function murmur2(data: Uint8Array): number {
  const m = 0x5bd1e995, r = 24, length = data.length;
  let h = 0x9747b28c ^ length;
  const length4 = length >> 2;
  for (let i = 0; i < length4; i++) {
    const i4 = i << 2;
    let k = data[i4] | (data[i4 + 1] << 8) | (data[i4 + 2] << 16) | (data[i4 + 3] << 24);
    k = Math.imul(k, m);
    k ^= k >>> r;
    k = Math.imul(k, m);
    h = Math.imul(h, m);
    h ^= k;
  }
  const index = length4 << 2;
  const tail = length - index; // the Java version's fall-through switch on 3, 2, 1 leftover bytes
  if (tail === 3) h ^= data[index + 2] << 16;
  if (tail >= 2) h ^= data[index + 1] << 8;
  if (tail >= 1) { h ^= data[index]; h = Math.imul(h, m); }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h | 0;
}

/** Utils.toPositive: clear the sign bit (not Math.abs, which overflows on −2³¹). */
export const toPositive = (n: number): number => n & 0x7fffffff;

/** The partition a keyed record goes to (key serialized as UTF-8, as StringSerializer does). */
export const partitionForKey = (key: string, numPartitions: number): number =>
  toPositive(murmur2(enc(key))) % numPartitions;

/** RangeAssignor for one topic: member → its partitions. Members are ordered by id (Java String order,
 *  which for these ASCII ids is JS's default sort). A member past the P-th gets nothing. */
export function rangeAssign(members: string[], numPartitions: number): Map<string, number[]> {
  const sorted = [...members].sort();
  const out = new Map<string, number[]>();
  if (sorted.length === 0) return out;
  const per = Math.floor(numPartitions / sorted.length), extra = numPartitions % sorted.length;
  sorted.forEach((id, i) => {
    const start = i * per + Math.min(i, extra);
    const len = per + (i < extra ? 1 : 0);
    out.set(id, Array.from({ length: len }, (_, j) => start + j));
  });
  return out;
}

export interface Rec { key: string; value: string }
export interface Delivery { consumer: string; partition: number; offset: number; key: string; value: string; redelivered: boolean }

export interface Group {
  log: Rec[][];              // log[partition][offset]
  members: string[];         // live members, in join order
  owner: (string | null)[];  // owner[partition], null when the group is empty
  position: number[];        // next offset the owner reads, per partition
  committed: number[];       // group's committed offset per partition
  readUpTo: number[];        // 1 + highest offset ever delivered, to mark redeliveries
  generation: number;        // bumps on every rebalance
}

export function createGroup(numPartitions: number, members: string[] = []): Group {
  const zeros = () => Array<number>(numPartitions).fill(0);
  return rebalance({
    log: Array.from({ length: numPartitions }, () => []), members: [], owner: Array(numPartitions).fill(null),
    position: zeros(), committed: zeros(), readUpTo: zeros(), generation: 0,
  }, members);
}

export const assignmentOf = (g: Group, member: string): number[] =>
  g.owner.flatMap((o, p) => (o === member ? [p] : []));

function rebalance(g: Group, members: string[]): Group {
  const owner = Array<string | null>(g.log.length).fill(null);
  for (const [id, parts] of rangeAssign(members, g.log.length)) for (const p of parts) owner[p] = id;
  return { ...g, members, owner, position: [...g.committed], generation: g.generation + 1 };
}

/** Append a record to its key's partition; returns where it landed. */
export function produce(g: Group, key: string, value: string): { group: Group; partition: number; offset: number } {
  const partition = partitionForKey(key, g.log.length);
  const log = g.log.map((l, p) => (p === partition ? [...l, { key, value }] : l));
  return { group: { ...g, log }, partition, offset: g.log[partition].length };
}

/** Deliver every record from the member's position to the end of each partition it owns. */
export function poll(g: Group, member: string): { group: Group; delivered: Delivery[] } {
  const position = [...g.position], readUpTo = [...g.readUpTo], delivered: Delivery[] = [];
  for (const p of assignmentOf(g, member)) {
    for (let offset = position[p]; offset < g.log[p].length; offset++) {
      const { key, value } = g.log[p][offset];
      delivered.push({ consumer: member, partition: p, offset, key, value, redelivered: offset < readUpTo[p] });
    }
    position[p] = g.log[p].length;
    readUpTo[p] = Math.max(readUpTo[p], position[p]);
  }
  return { group: { ...g, position, readUpTo }, delivered };
}

/** Commit the member's current position for each partition it owns. */
export function commit(g: Group, member: string): Group {
  const mine = new Set(assignmentOf(g, member));
  return { ...g, committed: g.committed.map((c, p) => (mine.has(p) ? g.position[p] : c)) };
}

const commitAll = (g: Group, except?: string): Group =>
  g.members.filter((m) => m !== except).reduce(commit, g);

export const join = (g: Group, member: string): Group => rebalance(commitAll(g), [...g.members, member]);

/** Clean leave: everyone, the leaver included, commits first. */
export const leave = (g: Group, member: string): Group =>
  rebalance(commitAll(g), g.members.filter((m) => m !== member));

/** Crash: the member vanishes without committing; survivors commit, then the group rebalances. */
export const crash = (g: Group, member: string): Group =>
  rebalance(commitAll(g, member), g.members.filter((m) => m !== member));

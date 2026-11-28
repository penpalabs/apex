import { describe, it, expect } from 'vitest';
import {
  murmur2, toPositive, partitionForKey, rangeAssign, createGroup, produce, poll, commit, join, leave, crash,
  assignmentOf, type Group, type Delivery,
} from '../src/web/kafkalog';
import { enc } from '../src/web/bytes';

// Vectors copied from apache/kafka trunk, clients/src/test/java/org/apache/kafka/common/utils/UtilsTest.java
// (testMurmur2 and testMurmur2Checksum).
describe('murmur2 — Kafka UtilsTest vectors', () => {
  it('testMurmur2', () => {
    const cases: [Uint8Array, number][] = [
      [enc('21'), -973932308],
      [enc('foobar'), -790332482],
      [enc('a-little-bit-long-string'), -985981536],
      [enc('a-little-bit-longer-string'), -1486304829],
      [enc('lkjh234lh9fiuh90y23oiuhsafujhadof229phr9h19h89h8'), -58897971],
      [new Uint8Array([0x61, 0x62, 0x63]), 479470107],
    ];
    for (const [data, want] of cases) expect(murmur2(data)).toBe(want);
  });

  // testMurmur2Checksum: hash 100 random arrays of every length 0..1000 drawn from Java's
  // SplittableRandom(0).nextBytes, sum the hashes as unsigned ints. Covers every tail length (0–3 bytes).
  it('testMurmur2Checksum (SplittableRandom seed 0, lengths 0..1000)', () => {
    const MASK = (1n << 64n) - 1n;
    let seed = 0n;
    const nextLong = () => { // java.util.SplittableRandom: seed += GOLDEN_GAMMA; return mix64(seed)
      seed = (seed + 0x9e3779b97f4a7c15n) & MASK;
      let z = seed;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      return z ^ (z >> 31n);
    };
    const nextBytes = (d: Uint8Array) => { // little-endian bytes of successive longs
      let i = 0;
      for (let w = d.length >> 3; w-- > 0;) { let r = nextLong(); for (let n = 8; n-- > 0; r >>= 8n) d[i++] = Number(r & 0xffn); }
      if (i < d.length) for (let r = nextLong(); i < d.length; r >>= 8n) d[i++] = Number(r & 0xffn);
    };
    let checksum = 0;
    for (let len = 0; len <= 1000; len++) {
      const data = new Uint8Array(len);
      for (let t = 0; t < 100; t++) { nextBytes(data); checksum += murmur2(data) >>> 0; }
    }
    expect(checksum).toBe(0xc3b8cf7c99fc);
  });
});

describe('toPositive / partitionForKey', () => {
  it('clears the sign bit rather than taking |x| (Utils.toPositive javadoc)', () => {
    expect(toPositive(-2147483648)).toBe(0); // Math.abs would overflow back to negative in Java
    expect(toPositive(-1)).toBe(2147483647);
    expect(toPositive(12345)).toBe(12345);
  });
  it('maps every key into [0, n) and the same key always to the same partition', () => {
    for (let n = 1; n <= 8; n++) for (let i = 0; i < 200; i++) {
      const p = partitionForKey(`key-${i}`, n);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(n);
      expect(partitionForKey(`key-${i}`, n)).toBe(p);
    }
  });
});

// RangeAssignor is per-topic: a multi-topic example is the per-topic results concatenated.
const multi = (topics: [string, string[], number][]) => {
  const out: Record<string, string[]> = {};
  for (const [t, members, n] of topics) for (const [m, parts] of rangeAssign(members, n))
    (out[m] ??= []).push(...parts.map((p) => `${t}p${p}`));
  return out;
};

describe('rangeAssign — apache/kafka RangeAssignor javadoc and RangeAssignorTest', () => {
  it('javadoc: C0, C1 over t0, t1 with 3 partitions each', () => {
    expect(multi([['t0', ['C0', 'C1'], 3], ['t1', ['C0', 'C1'], 3]]))
      .toEqual({ C0: ['t0p0', 't0p1', 't1p0', 't1p1'], C1: ['t0p2', 't1p2'] });
  });
  it('testTwoConsumersOneTopicOnePartition: the second consumer gets nothing', () => {
    const a = rangeAssign(['consumer1', 'consumer2'], 1);
    expect(a.get('consumer1')).toEqual([0]);
    expect(a.get('consumer2')).toEqual([]);
  });
  it('testMultipleConsumersMixedTopics', () => {
    expect(multi([['topic1', ['consumer1', 'consumer2', 'consumer3'], 3], ['topic2', ['consumer2'], 2]]))
      .toEqual({ consumer1: ['topic1p0'], consumer2: ['topic1p1', 'topic2p0', 'topic2p1'], consumer3: ['topic1p2'] });
  });
  it('orders members by id, not by the order given', () => {
    expect(rangeAssign(['C1', 'C0'], 3).get('C0')).toEqual([0, 1]);
  });
  it('every partition has exactly one owner; counts differ by at most one; idle members = max(0, C − P)', () => {
    for (let c = 1; c <= 7; c++) for (let n = 1; n <= 7; n++) {
      const members = Array.from({ length: c }, (_, i) => `m${i}`);
      const a = rangeAssign(members, n);
      const all = [...a.values()].flat().sort((x, y) => x - y);
      expect(all).toEqual(Array.from({ length: n }, (_, i) => i));
      const sizes = [...a.values()].map((v) => v.length).sort((x, y) => x - y);
      expect(sizes[sizes.length - 1] - sizes[0]).toBeLessThanOrEqual(1);
      expect(sizes.filter((s) => s === 0).length).toBe(c > n ? c - n : 0);
    }
  });
});

// Two keys that land in different partitions of a 3-partition topic, found by search (not hard-coded).
const keysInDifferentPartitions = () => {
  const a = 'k0';
  for (let i = 1; ; i++) if (partitionForKey(`k${i}`, 3) !== partitionForKey(a, 3)) return [a, `k${i}`];
};

describe('consumer group', () => {
  it('a crash after poll but before commit redelivers exactly the uncommitted records', () => {
    let g = createGroup(1, ['c1', 'c2']); // one partition: c1 owns it, c2 is idle
    expect(assignmentOf(g, 'c1')).toEqual([0]);
    expect(assignmentOf(g, 'c2')).toEqual([]);
    for (const v of ['a', 'b']) g = produce(g, 'k', v).group;
    let r = poll(g, 'c1'); g = commit(r.group, 'c1');
    expect(r.delivered.map((d) => d.value)).toEqual(['a', 'b']);
    for (const v of ['c', 'd']) g = produce(g, 'k', v).group;
    r = poll(g, 'c1'); g = r.group;
    expect(r.delivered.map((d) => d.value)).toEqual(['c', 'd']);
    g = crash(g, 'c1');
    expect(assignmentOf(g, 'c2')).toEqual([0]);
    r = poll(g, 'c2');
    expect(r.delivered.map((d) => [d.offset, d.value, d.redelivered])).toEqual([[2, 'c', true], [3, 'd', true]]);
  });

  it('a clean leave commits first, so the next owner sees nothing twice', () => {
    let g = createGroup(1, ['c1', 'c2']);
    g = produce(g, 'k', 'a').group;
    g = poll(g, 'c1').group;
    g = leave(g, 'c1');
    expect(poll(g, 'c2').delivered).toEqual([]);
  });

  it('records in different partitions can be consumed in the opposite order they were produced', () => {
    const [ka, kb] = keysInDifferentPartitions();
    let g = createGroup(3, ['c1', 'c2', 'c3']);
    g = produce(g, ka, 'first').group;
    g = produce(g, kb, 'second').group;
    const ownerB = g.owner[partitionForKey(kb, 3)]!;
    const ownerA = g.owner[partitionForKey(ka, 3)]!;
    const rb = poll(g, ownerB); g = rb.group;
    const ra = poll(g, ownerA);
    expect([...rb.delivered, ...ra.delivered].map((d) => d.value)).toEqual(['second', 'first']);
  });

  // Random sequences of produce / poll / commit / join / leave / crash, checked against a separately kept
  // record of what was produced.
  it('invariants hold under random operation sequences', () => {
    let s = 0x2545f491;
    const rand = (n: number) => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) % n; };
    const KEYS = ['alice', 'bob', 'carol', 'dave', 'eve'];
    for (let run = 0; run < 50; run++) {
      const parts = 1 + rand(5);
      let g: Group = createGroup(parts, ['c0']);
      let next = 1;
      const produced: Record<string, string[]> = {};
      const delivered: Delivery[] = [];
      for (let step = 0; step < 120; step++) {
        const op = rand(10);
        const member = g.members.length ? g.members[rand(g.members.length)] : null;
        if (op < 4) {
          const key = KEYS[rand(KEYS.length)], value = `${key}#${(produced[key] ??= []).length}`;
          produced[key].push(value);
          g = produce(g, key, value).group;
        } else if (op < 6 && member) { const r = poll(g, member); g = r.group; delivered.push(...r.delivered); }
        else if (op < 7 && member) g = commit(g, member);
        else if (op < 8 && g.members.length < 6) g = join(g, `c${next++}`);
        else if (op < 9 && member) g = leave(g, member);
        else if (member) g = crash(g, member);

        // ownership: each partition owned by exactly one live member, or by nobody when the group is empty
        for (const o of g.owner) {
          if (g.members.length) expect(g.members).toContain(o);
          else expect(o).toBeNull();
        }
        const idle = g.members.filter((m) => assignmentOf(g, m).length === 0).length;
        expect(idle).toBe(g.members.length > parts ? g.members.length - parts : 0);
        for (let p = 0; p < parts; p++) {
          expect(g.committed[p]).toBeLessThanOrEqual(g.position[p]);
          expect(g.position[p]).toBeLessThanOrEqual(g.log[p].length);
          expect(g.log[p].every((rec) => partitionForKey(rec.key, parts) === p)).toBe(true);
        }
      }
      // drain everything so the at-least-once check covers every record
      if (!g.members.length) g = join(g, `c${next++}`);
      for (const m of g.members) { const r = poll(g, m); g = r.group; delivered.push(...r.delivered); }

      for (const key of Object.keys(produced)) {
        const seen = delivered.filter((d) => d.key === key);
        // nothing lost: every produced value was delivered at least once
        expect(new Set(seen.map((d) => d.value))).toEqual(new Set(produced[key]));
        // per-key order: first deliveries arrive in production order
        expect(seen.filter((d) => !d.redelivered).map((d) => d.value)).toEqual(produced[key]);
        // a redelivery repeats an earlier delivery, never a new record
        const firsts = new Set(seen.filter((d) => !d.redelivered).map((d) => `${d.partition}:${d.offset}`));
        for (const d of seen.filter((x) => x.redelivered)) expect(firsts.has(`${d.partition}:${d.offset}`)).toBe(true);
      }
    }
  });
});

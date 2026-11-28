// Kafka-style partitioned log. Produce keyed records and watch each key hash to one partition; a consumer group
// splits the partitions with the range assignor. Poll, commit, add or remove consumers, or crash one after it
// polled but before it committed and watch the next owner get those records again. Model + tests in kafkalog.ts.
import { useState, type FormEvent } from 'react';
import {
  createGroup, produce, poll, commit, join, leave, crash, assignmentOf, partitionForKey, murmur2, toPositive,
  type Group, type Delivery,
} from './kafkalog';
import { enc } from './bytes';

const PARTITIONS = 3;
const MAX_CONSUMERS = 5;
const PRESET_KEYS = ['alice', 'bob', 'carol', 'dave'];
const SHOWN_DELIVERIES = 6;

const hue = (key: string) => toPositive(murmur2(enc(key))) % 360;
const chipStyle = (key: string) => ({ borderColor: `hsl(${hue(key)} 55% 50%)`, background: `hsl(${hue(key)} 60% 50% / .14)` });

interface State { group: Group; nextId: number; seq: Record<string, number>; inbox: Record<string, Delivery[]>; status: string }

const list = (ps: number[]) => (ps.length ? ps.map((p) => `P${p}`).join(', ') : 'nothing');
const owners = (g: Group) => g.members.map((m) => `${m} → ${list(assignmentOf(g, m))}`).join('; ');

const initial = (): State => {
  const group = createGroup(PARTITIONS, ['c1', 'c2']);
  return { group, nextId: 3, seq: {}, inbox: {}, status: `Range assignment: ${owners(group)}. Produce a few records to start.` };
};

export function KafkaLogSection() {
  const [s, setS] = useState<State>(initial);
  const [key, setKey] = useState('alice');
  const g = s.group;

  const onProduce = (e?: FormEvent) => {
    e?.preventDefault();
    const k = key.trim();
    if (!k) return;
    const n = (s.seq[k] ?? 0) + 1;
    const r = produce(g, k, `${k}-${n}`);
    setS({ ...s, group: r.group, seq: { ...s.seq, [k]: n },
      status: `${k}-${n} → partition ${r.partition}, offset ${r.offset}. Every record with key “${k}” lands in P${r.partition}.` });
  };

  const onPoll = (m: string) => {
    const r = poll(g, m);
    const again = r.delivered.filter((d) => d.redelivered).length;
    setS({ ...s, group: r.group, inbox: { ...s.inbox, [m]: [...(s.inbox[m] ?? []), ...r.delivered] },
      status: assignmentOf(g, m).length === 0 ? `${m} owns no partition, so it has nothing to read.`
        : r.delivered.length === 0 ? `${m} is caught up on ${list(assignmentOf(g, m))}.`
          : `${m} read ${r.delivered.length} record${r.delivered.length > 1 ? 's' : ''}${again ? `, ${again} of them a second time` : ''}. Not committed yet.` });
  };

  const onCommit = (m: string) => setS({ ...s, group: commit(g, m),
    status: `${m} committed: ${assignmentOf(g, m).map((p) => `P${p}@${g.position[p]}`).join(', ') || 'no partitions'}. A new owner would start there.` });

  const rebalanced = (next: Group, what: string): string =>
    `${what} Rebalance to generation ${next.generation}: ${owners(next) || 'no consumers, no one reads'}.`;

  const onJoin = () => {
    const id = `c${s.nextId}`;
    const next = join(g, id);
    setS({ ...s, group: next, nextId: s.nextId + 1, status: rebalanced(next, `${id} joined.`) });
  };
  const onLeave = (m: string) => {
    const next = leave(g, m);
    setS({ ...s, group: next, status: rebalanced(next, `${m} committed and left.`) });
  };
  const onCrash = (m: string) => {
    const lost = assignmentOf(g, m).reduce((n, p) => n + g.position[p] - g.committed[p], 0);
    const next = crash(g, m);
    setS({ ...s, group: next, status: rebalanced(next,
      `${m} crashed with ${lost} read-but-uncommitted record${lost === 1 ? '' : 's'}; ${lost ? 'the next owner reads them again.' : 'nothing to redo.'}`) });
  };

  return (
    <div className="kfk">
      <form className="kfk-row" onSubmit={onProduce}>
        <span className="kfk-label">key</span>
        {PRESET_KEYS.map((k) => (
          <button key={k} type="button" className="ghost small kfk-key" style={chipStyle(k)} aria-pressed={key === k} onClick={() => setKey(k)}>
            {k} <span className="kfk-dim">→ P{partitionForKey(k, PARTITIONS)}</span>
          </button>
        ))}
        <input className="kfk-input" value={key} onChange={(e) => setKey(e.target.value)} aria-label="record key" spellCheck={false} maxLength={24} />
        <span className="kfk-dim">→ P{partitionForKey(key.trim(), PARTITIONS)}</span>
        <button type="submit" className="ghost" disabled={!key.trim()}>produce</button>
      </form>

      <div className="kfk-grid">
        <div className="kfk-parts">
          {g.log.map((recs, p) => (
            <div key={p} className="kfk-part">
              <div className="kfk-head"><b>P{p}</b><span className="kfk-dim">owner {g.owner[p] ?? 'none'} · committed {g.committed[p]}</span></div>
              <ol className="kfk-log" aria-label={`partition ${p}`}>
                {recs.length === 0 && <li className="kfk-dim">empty</li>}
                {recs.map((r, off) => {
                  const state = off < g.committed[p] ? 'done' : off < g.position[p] ? 'read' : 'new';
                  return (
                    <li key={off} className={`kfk-rec kfk-${state}`} style={chipStyle(r.key)}>
                      <span className="kfk-off">{off}</span>{r.value}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>

        <div className="kfk-consumers">
          <div className="kfk-head"><b>group</b><button type="button" className="ghost small" onClick={onJoin} disabled={g.members.length >= MAX_CONSUMERS}>+ add consumer</button></div>
          {g.members.length === 0 && <p className="kfk-dim">No consumers. Records wait in the log.</p>}
          {g.members.map((m) => {
            const mine = assignmentOf(g, m);
            const inbox = s.inbox[m] ?? [];
            return (
              <div key={m} className={`kfk-consumer${mine.length ? '' : ' kfk-idle'}`}>
                <div className="kfk-head"><b>{m}</b><span className="kfk-dim">{mine.length ? list(mine) : 'idle: more consumers than partitions'}</span></div>
                <div className="kfk-btns">
                  <button type="button" className="ghost small" onClick={() => onPoll(m)}>poll</button>
                  <button type="button" className="ghost small" onClick={() => onCommit(m)}>commit</button>
                  <button type="button" className="ghost small" onClick={() => onLeave(m)}>leave</button>
                  <button type="button" className="ghost small kfk-crash" onClick={() => onCrash(m)}>crash</button>
                </div>
                {inbox.length > 0 && (
                  <ol className="kfk-inbox" aria-label={`${m} received`}>
                    {inbox.slice(-SHOWN_DELIVERIES).map((d, i) => (
                      <li key={i} className="kfk-rec" style={chipStyle(d.key)}>
                        P{d.partition}@{d.offset} {d.value}{d.redelivered && <span className="kfk-again"> again</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="kfk-legend kfk-dim">
        <span><i className="kfk-sw kfk-done" /> committed</span>
        <span><i className="kfk-sw kfk-read" /> read, not committed</span>
        <span><i className="kfk-sw kfk-new" /> not read yet</span>
        <button type="button" className="ghost small" onClick={() => { setS(initial()); setKey('alice'); }}>reset</button>
      </div>
      <div className="kfk-status" role="status" aria-live="polite">{s.status}</div>

      <p className="enc-note">
        The producer hashes the key bytes with murmur2, clears the sign bit, and takes the result mod the partition count, so a key
        always goes to the same partition and its records keep their order there. Records with different keys in different partitions
        have no order relative to each other: whichever consumer polls first sees its records first. The range assignor gives each
        consumer a contiguous run of partitions; a partition never has two owners in a group, so consumers beyond the partition count
        sit idle. Commits are per partition. In this model a consumer that leaves, or is rebalanced, commits first; one that crashes
        cannot, so everything it read since its last commit is read again by the next owner. That is at-least-once delivery: the
        consumer must tolerate duplicates. This page models the client-side partitioner and assignor (Apache Kafka&apos;s
        Utils.murmur2 and RangeAssignor), not a broker, replication, or the cooperative rebalance protocol.
      </p>
    </div>
  );
}

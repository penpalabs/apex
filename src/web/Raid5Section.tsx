// RAID 5, made visible: type text and watch it striped across the disks with a rotating XOR parity chunk, click a
// disk to fail it and see its chunks recomputed from the survivors, fail a second and lose data. A small write shows
// its read-modify-write I/Os, and a stream of random small writes shows RAID 4's parity disk taking every parity
// write. Model in raid5.ts.
import { useMemo, useState } from 'react';
import { build, rebuild, read, locate, parityDisk, writeChunk, writeStripe, writeLoad, type Level } from './raid5';
import { enc, hex } from './bytes';
import { mulberry32 } from './reservoir';

const CHUNK = 1; // bytes per chunk, so one cell is one character; mdadm's default chunk is 512 KiB
const MAX_LEN = 30;
const STREAM = 600; // random small writes in the load comparison
const SPAN = 1000; // stripes those writes are spread over

const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '').slice(0, MAX_LEN);
const show = (b: number) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·');

type LastWrite = ReturnType<typeof writeChunk> & { chunk: number; block: Uint8Array };

export function Raid5Section() {
  const [n, setN] = useState(4);
  const [level, setLevel] = useState<Level>(5);
  const [text, setText] = useState('STRIPED WITH PARITY');
  const [failed, setFailed] = useState<number[]>([]);
  const [target, setTarget] = useState(0);
  const [ch, setCh] = useState('x');
  const [last, setLast] = useState<LastWrite | null>(null);

  const data = useMemo(() => enc(text), [text]);
  const cells = useMemo(() => build(data, n, CHUNK, level), [data, n, level]);
  const live = rebuild(cells, failed);
  const back = read(cells, failed, level, data.length);
  const stripes = cells[0].length;

  // label[disk][stripe]: 'P' or the logical chunk index stored there
  const label = useMemo(() => {
    const l: string[][] = cells.map((d, disk) => d.map((_, s) => (disk === parityDisk(s, n, level) ? 'P' : '')));
    for (let c = 0; c < stripes * (n - 1); c++) { const p = locate(c, n, level); l[p.disk][p.stripe] = `D${c}`; }
    return l;
  }, [cells, n, level, stripes]);

  const loads = useMemo(() => {
    const rand = mulberry32(1);
    const chunks = Array.from({ length: STREAM }, () => Math.floor(rand() * SPAN * (n - 1)));
    return { 4: writeLoad(chunks, n, 4), 5: writeLoad(chunks, n, 5) };
  }, [n]);
  const fullStripe = writeStripe(cells, 0, Array.from({ length: n - 1 }, (_, i) => cells[locate(i, n, level).disk][0]), level).ios;

  const reset = () => { setFailed([]); setLast(null); };
  const toggle = (d: number) => setFailed((f) => (f.includes(d) ? f.filter((x) => x !== d) : [...f, d]));
  const doWrite = () => {
    const c = Math.min(target, data.length - 1);
    const block = Uint8Array.of(ch.charCodeAt(0));
    setLast({ ...writeChunk(cells, c, block, level), chunk: c, block });
    setText(text.slice(0, c) + ch + text.slice(c + 1));
  };

  const partial = Array.from(data, (b, c) => (failed.includes(locate(c, n, level).disk) ? '?' : show(b))).join('');
  const lostChunks = partial.split('').filter((x) => x === '?').length;
  const ioValue = (io: LastWrite['ios'][number], w: LastWrite) =>
    io.what === 'data' ? (io.op === 'read' ? w.oldData : w.block) : (io.op === 'read' ? w.oldParity : w.newParity);

  return (
    <div className="journey">
      <section className="jsec">
        <div className="jsec-head"><h2>Striping and parity</h2></div>
        <p className="jsec-sub">
          The text is cut into {CHUNK}-byte chunks and laid across <strong>{n}</strong> disks: each stripe (row) holds{' '}
          <strong>{n - 1}</strong> data chunks and one parity chunk, the XOR of the data. {level === 5
            ? <>Parity moves one disk to the left on each stripe (Linux md&apos;s default left-symmetric layout).</>
            : <>RAID 4 keeps parity on the last disk.</>} Click a disk header to fail it.
        </p>

        <div className="r5-controls">
          <label>disks <input type="range" min={3} max={6} value={n} onChange={(e) => { setN(+e.target.value); reset(); }} /><b>{n}</b></label>
          <div className="seg" role="group" aria-label="parity layout">
            <button type="button" aria-pressed={level === 5} className={level === 5 ? 'on' : ''} onClick={() => { setLevel(5); setLast(null); }}>RAID 5 (rotating)</button>
            <button type="button" aria-pressed={level === 4} className={level === 4 ? 'on' : ''} onClick={() => { setLevel(4); setLast(null); }}>RAID 4 (fixed)</button>
          </div>
          <label className="r5-text">data <input value={text} maxLength={MAX_LEN} spellCheck={false} onChange={(e) => { setText(ascii(e.target.value)); setLast(null); }} /></label>
        </div>

        <div className="r5-scroll">
          <table className="r5-grid">
            <thead>
              <tr>
                <th scope="col">stripe</th>
                {cells.map((_, d) => (
                  <th key={d} scope="col">
                    <button type="button" className={`r5-disk ${failed.includes(d) ? 'down' : ''}`} aria-pressed={failed.includes(d)} onClick={() => toggle(d)}>
                      disk {d}<span>{failed.includes(d) ? 'failed' : 'online'}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: stripes }, (_, s) => (
                <tr key={s}>
                  <th scope="row">{s}</th>
                  {cells.map((disk, d) => {
                    const down = failed.includes(d);
                    const v = down ? live?.[d][s] : disk[s];
                    const kind = label[d][s] === 'P' ? 'parity' : 'data';
                    return (
                      <td key={d} className={`r5-cell ${kind} ${down ? (v ? 'rebuilt' : 'lost') : ''}`}>
                        <span className="r5-val">{v ? hex(v) : '??'}</span>
                        <span className="r5-tag">{label[d][s]}{kind === 'data' && v && ` ${show(v[0])}`}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rs-legend"><span><i className="rs-sym data" /> data</span><span><i className="rs-sym parity" /> parity</span><span><i className="r5-key rebuilt" /> rebuilt from survivors</span><span><i className="rs-sym erased" /> lost</span></div>

        {failed.length === 1 && (
          <div className="r5-eqs">
            {Array.from({ length: stripes }, (_, s) => (
              <div key={s}>stripe {s}: {cells.filter((_, d) => d !== failed[0]).map((disk) => hex(disk[s])).join(' ⊕ ')} = <b>{hex(live![failed[0]][s])}</b> ({label[failed[0]][s]})</div>
            ))}
          </div>
        )}

        <div className={`rs-recover ${back ? 'ok' : 'bad'}`}>
          {back
            ? <>Read back: <code>{Array.from(back, show).join('')}</code>{failed.length === 1 && <span className="rs-note"> — disk {failed[0]} is gone; each of its chunks is the XOR of the other {n - 1} disks in that stripe, data or parity alike.</span>}</>
            : <>Data lost: <code>{partial}</code> — {failed.length} disks failed, so every stripe is missing at least two chunks and one XOR equation cannot recover two unknowns. {lostChunks} of {data.length} data chunks are gone.</>}
        </div>
      </section>

      <section className="jsec">
        <div className="jsec-head"><h2>The small-write penalty</h2></div>
        <p className="jsec-sub">
          Overwriting one chunk must keep its stripe&apos;s parity correct without reading the whole stripe: read the old data
          and old parity, then write new data and new parity = old parity ⊕ old data ⊕ new data.
        </p>
        <div className="r5-controls">
          <label>chunk <select value={Math.min(target, data.length - 1)} onChange={(e) => setTarget(+e.target.value)} disabled={!data.length}>
            {Array.from(data, (b, c) => <option key={c} value={c}>D{c} ({show(b)})</option>)}
          </select></label>
          <label>new byte <input className="r5-ch" value={ch} maxLength={1} onChange={(e) => setCh(ascii(e.target.value).slice(-1) || ch)} /></label>
          <button type="button" className="ghost small" onClick={doWrite} disabled={!data.length || failed.length > 0}>write</button>
          {failed.length > 0 && <span className="rs-note">restore the failed disks first</span>}
        </div>
        {last && (
          <ol className="r5-ios">
            {last.ios.map((io, i) => (
              <li key={i} className={io.op}>
                {io.op} {io.what === 'data' ? `D${last.chunk}` : 'parity'} {io.op === 'read' ? 'from' : 'to'} disk {io.disk}: <b>{hex(ioValue(io, last))}</b>
                {io.op === 'write' && io.what === 'parity' && <> = {hex(last.oldParity)} ⊕ {hex(last.oldData)} ⊕ {hex(last.block)}</>}
              </li>
            ))}
          </ol>
        )}
        <p className="rs-foot">
          {last
            ? <>That write cost {last.ios.filter((io) => io.op === 'read').length} reads + {last.ios.filter((io) => io.op === 'write').length} writes for one chunk.</>
            : <>Pick a chunk and write.</>}{' '}
          Rewriting a whole stripe costs {fullStripe.filter((io) => io.op === 'read').length} reads + {fullStripe.length} writes, since
          parity comes from the new data alone. md also prices a reconstruct-write (read the other {n - 2} data chunks of the
          stripe instead of old data and old parity) and uses whichever needs fewer reads.
        </p>
      </section>

      <section className="jsec">
        <div className="jsec-head"><h2>Why parity rotates</h2></div>
        <p className="jsec-sub">
          {STREAM} small writes to random chunks across {SPAN} stripes, {n} disks. Every small write writes its parity chunk, so
          wherever parity lives takes one write per small write.
        </p>
        <div className="r5-load">
          {loads[level].map((w, d) => (
            <div key={d} className="r5-bar-row">
              <span>disk {d}</span>
              <div className="r5-bar"><i style={{ width: `${(100 * w) / STREAM}%` }} /></div>
              <b>{w}</b>
            </div>
          ))}
        </div>
        <p className="rs-foot">
          Busiest disk: RAID 4 <b>{Math.max(...loads[4])}</b> writes, RAID 5 <b>{Math.max(...loads[5])}</b>. With fixed parity
          the parity disk is written on every small write and limits the array&apos;s write rate; rotating parity spreads those
          writes over all {n} disks.
        </p>
      </section>
    </div>
  );
}

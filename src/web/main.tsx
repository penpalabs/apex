// Apex UI. A multi-section visual playground for how the internet works:
//   • Network    — build/inspect real frames across 90+ protocols
//   • Cryptography — real hashing/encryption on sandbox values
//   • Encoding   — how data becomes bytes (UTF-8, bases, Base64, floats)
// Everything derives from real bytes; nothing is faked.
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { SectionHost } from './sections/SectionHost';
import { SECTIONS } from './sections/registry';
import { createRoot } from 'react-dom/client';
import { initAnalytics, trackSection, trackDwell, trackInteraction } from './analytics';
import { GROUPS, metaById, groupOf, pathOf, sectionFromPath, pageTitle } from './sections';
import { OverviewSection } from './OverviewSection';
import { JourneyBar } from './JourneyBar';
import { pathById } from './paths';
import { CodePanel } from './CodePanel';
import { CodeExamples } from './CodeExamples';
import './style.css';

const BASE = import.meta.env.BASE_URL; // '/' or '/apex/' (see vite.config.ts)

type Section = 'network' | 'crypto' | 'classical' | 'otpad' | 'aesround' | 'aead' | 'chacha' | 'hashint' | 'rsa' | 'ecc' | 'ecdsa' | 'schnorr' | 'dhmitm' | 'bb84' | 'ecbpenguin' | 'lamport' | 'quorum' | 'lz77' | 'cors' | 'tcphand' | 'dnssec' | 'paxos' | 'webinject' | 'dhkex' | 'crc32' | 'snowflake' | 'pmtud' | 'countmin' | 'sack' | 'bully' | 'csp' | 'eddsa' | 'hll' | 'ttlhop' | 'bdp' | 'webauthn' | 'anycast' | 'mailauth' | 'consistency' | 'reedsolomon' | 'cubic' | 'wpa' | 'bbr' | 'btree' | 'lsm' | 'mvcc' | 'wal' | 'skiplist' | 'pedersen' | 'locking' | 'trie' | 'pbft' | 'lzw' | 'hlc' | 'cuckoo' | 'geohash' | 'chord' | 'unionfind' | 'fenwick' | 'kmp' | 'rabinkarp' | 'hashtable' | 'editdist' | 'toposort' | 'astar' | 'heap' | 'sorting' | 'majority' | 'segtree' | 'avl' | 'reservoir' | 'dfa' | 'fencing' | 'hashchain' | 'happyeyeballs' | 'nagle' | 'chandy' | 'viterbi' | 'sctp' | 'pagereplace' | 'retry' | 'smuggle' | 'phiaccrual' | 'consttime' | 'conditional' | 'siteisolation' | 'vxlan' | 'sri' | 'antientropy' | 'vrrp' | 'truetime' | 'ecn' | 'dot1x' | 'ipsec' | 'causalbcast' | 'ecmp' | 'realtime' | 'x3dh' | 'tfo' | 'threshsig' | 'raftlog' | 'tlsdowngrade' | 'pwhash' | 'pqc' | 'shamir' | 'pow' | 'kerberos' | 'revocation' | 'ssh' | 'feistel' | 'poly1305' | 'hashbreak' | 'ratchet' | 'encoding' | 'huffman' | 'errors' | 'identity' | 'attacks' | 'routing' | 'dns' | 'subnet' | 'bgp' | 'congestion' | 'http2' | 'quic' | 'nat' | 'flow' | 'bufferbloat' | 'cookies' | 'certs' | 'traceroute' | 'dhcp' | 'switch' | 'stptree' | 'slaac' | 'linecode' | 'ratelimit' | 'chash' | 'lb' | 'bloom' | 'cdn' | 'qos' | 'merkle' | 'vclock' | 'crdt' | 'gossip' | 'raft' | 'cap' | 'replication' | 'twopc' | 'fragment' | 'bgphijack' | 'mpls' | 'natpunch' | 'ipcompare' | 'icmp' | 'arp' | 'csma' | 'multicast' | 'vlan' | 'ntp' | 'arq' | 'rto' | 'queueing' | 'distvec' | 'mdns' | 'encdns' | 'http3' | 'grpc' | 'websocket' | 'cpusched' | 'pagewalk' | 'mesi' | 'joins' | 'h2flow' | 'tso' | 'ospf' | 'maxflow' | 'ntt' | 'bwt' | 'taillatency' | 'mst' | 'cfs' | 'pipeline' | 'scc' | 'queryplan' | 'rum' | 'arith' | 'swim' | 'ahocorasick' | 'floyd' | 'leakybucket' | 'knapsack' | 'deployments' | 'healthcheck' | 'autoscale' | 'slo' | 'tracing' | 'featureflags' | 'gracefulshutdown' | 'idempotency' | 'loadshed' | 'chaos' | 'singleflight' | 'branchpredict' | 'boyermoore' | 'newton' | 'cow' | 'mtf' | 'tlb' | 'suffixarray' | 'fft' | 'ssrf' | 'saga' | 'blindsig' | 'clickjack' | 'bgprr' | 'vrf' | 'hsts' | 'numa' | 'ot' | 'bellmanford' | 'cdc' | 'watermark' | 'openredirect' | 'paillier' | 'manacher' | 'epoll' | 'varint' | 'hintedhandoff' | 'futex' | 'quicmig' | 'quickselect' | 'feldman' | 'chainrep' | 'iouring' | 'golombrice' | 'hashflood' | 'hdrhist' | 'aliasmethod' | 'bakery' | 'zerortt' | 'redos' | 'splaytree' | 'kaminsky' | 'threepc' | 'kdtree' | 'subdomain' | 'zalgo' | 'rcu' | 'lenext' | 'roaring' | 'priorityinv' | 'leases' | 'timewait' | 'paddingoracle' | 'bulkhead' | 'hamt' | 'shuffle' | 'optransform' | 'spectre' | 'jumphash' | 'cycledetect' | 'gorilla' | 'protopollute' | 'mptcp' | 'envelope' | 'falseshare' | 'intervaltree' | 'treap' | 'kadane' | 'readrepair' | 'dnsrebind' | 'cobs' | 'piecetable' | 'rendezvous' | 'buddyalloc' | 'timingwheel' | 'usl' | 'segrouting' | 'eliascode' | 'arpspoof' | 'sparsetable' | 'elgamal' | 'dnf' | 'sws' | 'ddsketch' | 'lamportsig' | 'minhash' | 'pid' | 'xxe' | 'aba' | 'bitmapindex' | 'rsync' | 'kademlia' | 'inode' | 'medianofmedians' | 'robinhood' | 'hmac' | 'routeflap' | 'seqlock' | 'cartesian' | 'jwt' | 'pairingheap' | 'base58' | 'lis' | 'gcra' | 'dram' | 'adder' | 'latch' | 'alu' | 'membus' | 'io' | 'ssd' | 'transistor' | 'gpu' | 'cpucache' | 'oooexec' | 'rope' | 'gapbuffer' | 'fastinvsqrt' | 'kahan' | 'karatsuba' | 'simanneal' | 'hamming' | 'bresenham' | 'convexhull' | 'marchsquares' | 'voronoi' | 'perlin' | 'poisson' | 'delaunay' | 'montgomery' | 'twosat' | 'playground' | 'overview';

function App() {
  // The URL names the section (`/tcphand/`); the bare base path is the overview map (journeys + filterable catalog).
  const [section, setSection] = useState<Section>(() => sectionFromPath(location.pathname, BASE) as Section);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [navQuery, setNavQuery] = useState('');
  const [journeyId, setJourneyId] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  useEffect(() => { initAnalytics(); }, []);                 // load configured provider beacons once
  useEffect(() => {
    // Keep the address bar and tab title on the open section. Normalizing the landing URL (e.g. a missing trailing
    // slash) replaces rather than pushes, and keeps ?query so campaign tags survive until the beacons read them.
    const p = pathOf(section, BASE);
    if (location.pathname !== p) {
      if (sectionFromPath(location.pathname, BASE) === section) history.replaceState(null, '', p + location.search);
      else history.pushState(null, '', p);
    }
    document.title = pageTitle(section);
  }, [section]);
  useEffect(() => {
    const onPop = () => setSection(sectionFromPath(location.pathname, BASE) as Section);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  // per-section pageview + dwell time (how long each section is read); flush on tab hide / unload
  const dwellRef = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    const prev = dwellRef.current;
    if (prev) trackDwell(prev.id, (Date.now() - prev.at) / 1000);
    dwellRef.current = { id: section, at: Date.now() };
    trackSection(section);
  }, [section]);
  useEffect(() => {
    // On hide: report the time read so far. On return: restart the clock, so time spent in another tab is not
    // counted as reading when the next section switch reports dwell.
    const flush = () => {
      const c = dwellRef.current;
      if (!c) return;
      if (document.visibilityState === 'hidden') trackDwell(c.id, (Date.now() - c.at) / 1000);
      c.at = Date.now();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); };
  }, []);
  // coarse "did the user interact with this section" signal (deduped to one event per section, no per-click spam)
  const secRef = useRef(section); secRef.current = section;
  useEffect(() => {
    const onInteract = () => trackInteraction(secRef.current);
    const main = document.querySelector('main');
    main?.addEventListener('click', onInteract);
    main?.addEventListener('input', onInteract);
    return () => { main?.removeEventListener('click', onInteract); main?.removeEventListener('input', onInteract); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const activeGroup = groupOf(section);
  const activePath = journeyId ? pathById[journeyId] ?? null : null;

  // Start a guided journey: remember it and jump to its first stop. The bar's position then
  // derives from `section`, so ordinary nav/search clicks keep it in sync with zero extra state.
  const startPath = (pathId: string) => {
    const p = pathById[pathId];
    if (!p) return;
    setJourneyId(pathId);
    setSection(p.steps[0].id as Section);
    setOpenMenu(null);
    setNavQuery('');
  };

  // flat, searchable index of every section (label + group, for the search box)
  const allSections = useMemo(
    () => GROUPS.flatMap((g) => g.ids.map((id) => ({ id, label: metaById[id].label, icon: metaById[id].icon, group: g.label }))),
    [],
  );
  const navMatches = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    if (!q) return [];
    return allSections.filter((s) => s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q)).slice(0, 10);
  }, [navQuery, allSections]);
  const gotoSection = (id: string) => { setSection(id as Section); setNavQuery(''); setOpenMenu(null); };

  return (
    <div className={`app ${activePath ? 'has-jbar' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className={`brand ${section === 'overview' ? 'home' : ''}`} onClick={() => setSection('overview')} title="Home / all sections"><span className="logo">◆</span> Apex</button>
          <button type="button" className="mobile-browse" onClick={() => setSection('overview')} aria-label="Browse all sections">☰ Browse</button>
          <nav className="topnav" aria-label="Section groups">
            {GROUPS.map((g) => {
              const isOpen = openMenu === g.label;
              const isActive = g.label === activeGroup;
              // Compact single-word tab labels keep all six on one line and stop
              // the wrap. Keyed on the full g.label so the state model
              // (openMenu / activeGroup / groupOf) is untouched; the full name
              // lives on as the title tooltip + the dropdown heading.
              const SHORT: Record<string, string> = {
                'Network basics': 'Network',
                'Routing & naming': 'Routing',
                'Transport & web': 'Transport',
                'Cryptography': 'Crypto',
                'Security & web': 'Security',
                'Data & encoding': 'Data',
                'Distributed systems': 'Systems',
                'Storage & databases': 'Storage',
                'Systems & OS': 'OS',
                'Operations & SRE': 'Ops',
              };
              const short = SHORT[g.label] ?? g.label.split(' ')[0];
              return (
                <div className="topgroup" key={g.label}>
                  <button
                    type="button"
                    className={`topgroup-h ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}`}
                    onClick={() => setOpenMenu(isOpen ? null : g.label)}
                    aria-expanded={isOpen}
                    aria-haspopup="menu"
                    title={g.label}
                  >
                    <span className="tg-icon" aria-hidden="true">{g.icon}</span>
                    <span className="tg-label" data-label={short}>{short}</span>
                    <span className="tg-caret" aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
                  </button>
                  {isOpen && (
                    <div className="topmenu" role="menu" aria-label={g.label}>
                      <div className="topmenu-head"><span className="tg-icon" aria-hidden="true">{g.icon}</span>{g.label}</div>
                      {g.ids.map((id) => {
                        const m = metaById[id];
                        return (
                          <button
                            key={id}
                            type="button"
                            role="menuitem"
                            className={section === id ? 'on' : ''}
                            onClick={() => { setSection(id as Section); setOpenMenu(null); }}
                          >
                            <span className="sec-icon" aria-hidden="true">{m.icon}</span> {m.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="navsearch">
            <input
              type="search"
              className="navsearch-input"
              placeholder="🔎 Search sections…"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && navMatches[0]) gotoSection(navMatches[0].id); if (e.key === 'Escape') setNavQuery(''); }}
              aria-label="Search sections"
            />
            {navMatches.length > 0 && (
              <div className="navsearch-results" role="listbox">
                {navMatches.map((s) => (
                  <button key={s.id} type="button" role="option" className={section === s.id ? 'on' : ''} onClick={() => gotoSection(s.id)}>
                    <span className="sec-icon" aria-hidden="true">{s.icon}</span>
                    <span className="navsearch-lbl">{s.label}</span>
                    <span className="navsearch-grp">{s.group}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <a className="topbar-ghlink" href="https://github.com/penpalabs/apex" target="_blank" rel="noopener noreferrer" title="Source on GitHub" aria-label="Source on GitHub">
              <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 012-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            </a>
            <button type="button" className="topbar-toggle" onClick={() => setDark((d) => !d)} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle dark mode">{dark ? '☀' : '☾'}</button>
          </div>
        </div>
      </header>
      {openMenu && <div className="topnav-backdrop" onClick={() => setOpenMenu(null)} />}
      {navQuery && <div className="topnav-backdrop" onClick={() => setNavQuery('')} />}

      <main className="content">
        {section === 'overview' && (
          <OverviewSection onPick={(id) => setSection(id as Section)} onStartPath={startPath} current={section} />
        )}

        {SECTIONS[section] && <SectionHost id={section} onOpen={(id) => setSection(id as Section)} />}

        {section !== 'overview' && <CodePanel id={section} />}
        {section !== 'overview' && <CodeExamples id={section} />}
      </main>
      {activePath && (
        <JourneyBar
          path={activePath}
          section={section}
          onGoto={(id) => { setSection(id as Section); setOpenMenu(null); setNavQuery(''); }}
          onExit={() => { setJourneyId(null); setSection('overview'); }}
        />
      )}
    </div>
  );
}

// A tab opened before a deploy still asks for the previous build's section chunks, which the deploy removed. Reloading
// fetches the new index; the URL already names the section, so the visitor lands where they were going. At most once
// per 10 s, so a chunk that is missing for another reason fails once instead of reloading forever.
window.addEventListener('vite:preloadError', () => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('apex-reload')) < 10_000) return;
    sessionStorage.setItem('apex-reload', String(Date.now()));
  } catch { /* storage blocked: reload anyway */ }
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Loop scanner + one-click loop trade.
// Finds routes like KOIN -> A -> B -> KOIN across all KoinDX pools that return more than you put in,
// re-checks every pool on-chain, and runs a loop as ONE transaction with a minimum-return guard.
(() => {
  const $ = id => document.getElementById(id);
  const K = () => window.KW;
  let state = { loops: [], scannedAt: 0, scanning: false, listed: new Set(['koin', 'vhp']), symbols: {}, pairCount: 0, err: null };
  let opts = { start: 'both', minProfit: 1, unlisted: false };
  try { Object.assign(opts, JSON.parse(localStorage.getItem('kc-loop-opts') || '{}')); } catch (e) {}
  const saveOpts = () => { try { localStorage.setItem('kc-loop-opts', JSON.stringify(opts)); } catch (e) {} };

  async function fetchPairs() {
    const all = [];
    for (let page = 1; page < 12; page++) {
      const r = await (await fetch(`https://api.koindx.com/v2/pairs?pageSize=100&page=${page}`)).json();
      if (!r.result || !r.result.length) break;
      all.push(...r.result);
      if (r.result.length < 100) break;
    }
    return all;
  }
  async function fetchListed() {
    try {
      const j = await (await fetch('https://tokens.koindx.com/mainnet.json')).json();
      return new Set((j.tokens || []).map(t => t.address));
    } catch (e) { return state.listed; }
  }

  const sym = id => id === 'koin' ? 'KOIN' : id === 'vhp' ? 'VHP' : (state.symbols[id] || id.slice(0, 6));

  async function scan() {
    if (state.scanning) return;
    state.scanning = true; state.err = null; render();
    try {
      const [raw, listed] = await Promise.all([fetchPairs(), fetchListed()]);
      state.listed = listed; state.pairCount = raw.length;
      const pairs = raw.map(p => {
        state.symbols[p.token0.id] = p.token0.id === 'koin' ? 'KOIN' : p.token0.id === 'vhp' ? 'VHP' : p.token0.symbol;
        state.symbols[p.token1.id] = p.token1.id === 'koin' ? 'KOIN' : p.token1.id === 'vhp' ? 'VHP' : p.token1.symbol;
        return { id: p.id, t0: p.token0.id, t1: p.token1.id, d0: +p.token0.decimals || 8, d1: +p.token1.decimals || 8, r0: +p.reserve0, r1: +p.reserve1, usd: +p.reserveUSD || 0 };
      });
      const starts = opts.start === 'both' ? ['koin', 'vhp'] : [opts.start];
      const cands = LoopCore.findLoops(pairs, starts, { maxHops: 4, minEdge: 1.003, minUsd: 1, allowToken: id => opts.unlisted || listed.has(id) });
      // rank by rough profit, then verify the best ones on-chain
      const ranked = cands.map(l => ({ l, est: LoopCore.estimate(l) })).filter(x => x.est.profit > 0n)
        .sort((x, y) => (y.est.profit > x.est.profit ? 1 : -1)).slice(0, 40);
      const poolIds = [...new Set(ranked.flatMap(x => x.l.edges.map(e => e.p.id)))];
      const live = {};
      for (let i = 0; i < poolIds.length; i += 8) {
        await Promise.all(poolIds.slice(i, i + 8).map(async id => { try { live[id] = await K().reserves(id); } catch (e) {} }));
      }
      const loops = [];
      for (const { l } of ranked) {
        const hops = [];
        let ok = true;
        for (const e of l.edges) {
          const r = live[e.p.id]; if (!r || !r.a || !r.b) { ok = false; break; }
          const fwd = e.from === e.p.t0;
          hops.push({ rin: fwd ? r.a : r.b, rout: fwd ? r.b : r.a });
        }
        if (!ok) continue;
        const best = LoopCore.bestSize(hops, hops[0].rin);
        if (best.profit <= 0n) continue;
        const path = [l.start, ...l.edges.map(e => e.to)];
        loops.push({
          start: l.start, path, pools: l.edges.map(e => e.p.id), hops, fwd: l.edges.map(e => e.from === e.p.t0),
          amountIn: best.amountIn, amountOut: best.amountOut, profit: best.profit,
          minUsd: Math.min(...l.edges.map(e => e.p.usd)),
          unlisted: path.some(t => !listed.has(t)),
        });
      }
      // Best first, then keep only loops that don't share a pool with a better one:
      // taking one loop moves its pools, which wipes out any loop that shares them.
      const used = new Set();
      let overlapping = 0;
      state.loops = loops.sort((a, b) => (b.profit > a.profit ? 1 : -1)).filter(x => {
        if (x.pools.some(id => used.has(id))) { overlapping++; return false; }
        x.pools.forEach(id => used.add(id)); return true;
      });
      state.overlapping = overlapping;
      state.scannedAt = Date.now();
    } catch (e) { console.error(e); state.err = 'Scan failed: ' + (e.message || e); }
    state.scanning = false; render();
  }

  function capFor(loop) {
    const k = K();
    if (!k.W.address) return null;
    const bal = loop.start === 'koin' ? k.spendableKoin() : k.W.vhp;
    return k.toRaw(Math.max(0, bal));
  }
  // size actually used: the best size, limited by what the wallet can spend
  function sized(loop) {
    const cap = capFor(loop);
    if (cap === null || cap >= loop.amountIn) return { amountIn: loop.amountIn, amountOut: loop.amountOut, profit: loop.profit, capped: false };
    const out = LoopCore.simulate(loop.hops, cap);
    return { amountIn: cap, amountOut: out, profit: out - cap, capped: true };
  }

  async function run(i) {
    const k = K(), loop = state.loops[i];
    if (!loop) return;
    if (!(await k.ensureConnected())) return;
    await k.refreshBalances();
    // re-check every pool right before trading (reserves and which side is which, straight from the contracts)
    const hops = [];
    for (let j = 0; j < loop.pools.length; j++) {
      const [r, fwd] = await Promise.all([k.reserves(loop.pools[j]), isToken0(loop.pools[j], loop.path[j])]);
      hops.push({ rin: fwd ? r.a : r.b, rout: fwd ? r.b : r.a });
    }
    const fresh = { ...loop, hops, ...LoopCore.bestSize(hops, hops[0].rin) };
    const s = sized(fresh);
    const minProfitRaw = k.toRaw(opts.minProfit);
    if (s.profit <= 0n || s.profit < minProfitRaw / 4n) throw new Error('This loop is no longer profitable (someone else probably took it). Rescanning…');
    if (s.amountIn <= 0n) throw new Error(`Not enough ${sym(loop.start)} in your wallet to run this loop.`);
    const keep = BigInt(Math.round(k.S.keepProfit * 100));
    let minOut = s.amountIn + s.profit * keep / 10000n;
    if (minOut <= s.amountIn) minOut = s.amountIn + 1n;
    const T = sym(loop.start);
    const ok = await k.review({
      title: 'Run loop trade',
      intro: 'All swaps run in one transaction. If you would get back less than the minimum below, the whole thing cancels and nothing is traded.',
      rows: [
        ['Route', loop.path.map(sym).join(' → ')],
        ['You put in', `${k.fmt(k.fromRaw(s.amountIn), 4)} ${T}`],
        ['You should get back', `${k.fmt(k.fromRaw(s.amountOut), 4)} ${T}`, 'up'],
        ['Expected profit', `+${k.fmt(k.fromRaw(s.profit), 4)} ${T}`, 'up'],
        ['Minimum you accept', `${k.fmt(k.fromRaw(minOut), 4)} ${T} (keeps ≥${k.S.keepProfit}% of the profit)`],
        ['Network cost', 'Some mana (recharges); no fee in KOIN'],
      ],
      warn: loop.unlisted ? 'This route uses a token that is not on KoinDX\'s official list. Its contract runs inside your signed transaction. Only continue if you trust it.' : (s.capped ? 'Sized down to what your wallet can spend right now.' : ''),
      confirm: 'Review and sign in Kondor',
    });
    if (!ok) return;
    const ops = [await k.approveOpIfNeeded(loop.start, s.amountIn), await k.swapOp(s.amountIn, minOut, loop.path)];
    const res = await k.send(ops, { kind: 'loop', start: loop.start, label: 'Loop ' + loop.path.map(sym).join('→') });
    if (res && res.delta) {
      const d = loop.start === 'koin' ? res.delta.koin : res.delta.vhp;
      k.toast(`Loop done: ${d >= 0 ? '+' : ''}${k.fmt(d, 4)} ${T}.`, d >= 0 ? 'ok' : 'err', 12000);
    }
    scan();
  }

  // token0 of a pair = first token in get_tokens (KoinDX orders pairs consistently with get_reserves)
  const t0Cache = {};
  async function isToken0(pair, tok) {
    if (!t0Cache[pair]) {
      const r = await K().provider.call('chain.read_contract', { contract_id: pair, entry_point: 0x7d5b5ed7, args: '' });
      const u = window.KC.b64(r.result);
      // field1 = token A address bytes (25 bytes)
      const len = u[1]; const bytes = u.slice(2, 2 + len);
      t0Cache[pair] = utils.encodeBase58(bytes);
    }
    const addr = tok === 'koin' ? K().KOIN : tok === 'vhp' ? K().VHP : tok;
    return t0Cache[pair] === addr;
  }

  function render() {
    const k = K(); if (!k) return;
    const el = $('loopList');
    $('loopScan').disabled = state.scanning;
    $('loopScan').textContent = state.scanning ? 'Scanning…' : 'Scan now';
    const minRaw = k.toRaw(opts.minProfit);
    const shown = state.loops.map((l, i) => ({ l, i, s: sized(l) })).filter(x => x.s.profit >= minRaw);
    $('loopStatus').textContent = state.err ? state.err : state.scannedAt
      ? `Checked ${state.pairCount} pools at ${new Date(state.scannedAt).toLocaleTimeString()} · ${shown.length} separate loop${shown.length === 1 ? '' : 's'} worth at least ${opts.minProfit} ${sym(opts.start === 'both' ? 'koin' : opts.start)}${opts.start === 'both' ? '/VHP' : ''}${state.overlapping ? ` (${state.overlapping} more share a pool with these and would vanish once one runs)` : ''} · pools re-checked on-chain`
      : 'Not scanned yet.';
    if (!shown.length) {
      const smaller = state.loops.map(l => sized(l)).filter(s => s.profit > 0n && s.profit < minRaw);
      const bestSmall = smaller.reduce((m, s) => s.profit > m ? s.profit : m, 0n);
      const tips = [];
      if (smaller.length) tips.push(`${smaller.length} smaller loop${smaller.length === 1 ? ' is' : 's are'} hidden (best +${k.fmt(k.fromRaw(bestSmall), 3)}). Lower "worth at least" to see ${smaller.length === 1 ? 'it' : 'them'}.`);
      if (!opts.unlisted) tips.push('Most loops run through smaller tokens that aren\'t on KoinDX\'s official list. Tick "Include tokens not on KoinDX\'s official list" to check those too.');
      el.innerHTML = `<div class="empty">${state.scanning ? 'Scanning all KoinDX pools…' : 'No loops worth your minimum right now. They appear after someone makes a big lopsided trade, and this rescans every 90 seconds.'}${tips.length && !state.scanning ? '<br><br>' + tips.map(k.esc).join('<br>') : ''}</div>`;
      return;
    }
    el.innerHTML = shown.map(({ l, i, s }) => {
      const T = sym(l.start);
      const pct = Number(s.profit) / Number(s.amountIn) * 100;
      const route = l.path.map((t, j) => `<span class="chip${(j > 0 && j < l.path.length - 1 && !state.listed.has(t)) ? ' warn' : ''}">${k.esc(sym(t))}</span>`).join('<span class="arrow">→</span>');
      return `<div class="loop">
        <div class="lRoute">${route}${l.unlisted ? '<span class="badge warn">unlisted token</span>' : ''}</div>
        <div class="lNums">
          <div><b>${k.fmt(k.fromRaw(s.amountIn), 2)} ${T}</b><span>Put in${s.capped ? ' (your max)' : ''}</span></div>
          <div><b>${k.fmt(k.fromRaw(s.amountOut), 2)} ${T}</b><span>Get back</span></div>
          <div><b class="up">+${k.fmt(k.fromRaw(s.profit), 3)} ${T}</b><span>Profit (${pct.toFixed(1)}%)</span></div>
          <div><b>$${k.fmt(l.minUsd, 0)}</b><span>Smallest pool</span></div>
        </div>
        <button class="btn primary" data-run="${i}" ${k.W.busy ? 'disabled' : ''}>${k.W.address ? 'Run loop' : 'Connect & run'}</button>
      </div>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const k = K();
    $('loopStart').value = opts.start; $('loopMin').value = opts.minProfit; $('loopUnlisted').checked = !!opts.unlisted;
    $('loopStart').addEventListener('change', e => { opts.start = e.target.value; saveOpts(); scan(); });
    $('loopMin').addEventListener('change', e => { const v = parseFloat(e.target.value); opts.minProfit = v >= 0 ? v : 1; e.target.value = opts.minProfit; saveOpts(); render(); });
    $('loopUnlisted').addEventListener('change', e => { opts.unlisted = e.target.checked; saveOpts(); scan(); });
    $('loopScan').addEventListener('click', scan);
    $('loopList').addEventListener('click', e => { const b = e.target.closest('button[data-run]'); if (b) k.guarded(() => run(+b.dataset.run)); });
    k.listeners.push(render);
    scan();
    setInterval(() => { if (!document.hidden) scan(); }, 90000);
  });
})();

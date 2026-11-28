// Shared loop-finding math. Runs in the browser (window.LoopCore) and in Node (globalThis.LoopCore).
// Amounts are integer "raw" units (token amount x 10^decimals) as BigInt, matching the contracts.
(function (g) {
  const FEE_N = 9975n, FEE_D = 10000n; // KoinDX: 0.25% fee per hop

  // Same formula the KoinDX pair contract uses (Uniswap v2 style, integer math)
  function amountOut(x, rin, rout) {
    if (x <= 0n || rin <= 0n || rout <= 0n) return 0n;
    const xi = x * FEE_N;
    return (xi * rout) / (rin * FEE_D + xi);
  }

  // Our own pools (contracts/pool): fee fixed per pool, rounded up, same math as the contract's _quote
  function amountOutOwn(x, rin, rout, feeBps) {
    if (x <= 0n || rin <= 0n || rout <= 0n) return 0n;
    const fee = (x * BigInt(feeBps) + 9999n) / 10000n;
    const xin = x - fee;
    if (xin <= 0n) return 0n;
    const out = (xin * rout) / (rin + xin);
    return out >= rout ? 0n : out;
  }

  // one hop: KoinDX pair by default, or one of our pools when h.venue === 'own'
  function hopOut(h, x) {
    return h.venue === 'own' ? amountOutOwn(x, h.rin, h.rout, h.feeBps) : amountOut(x, h.rin, h.rout);
  }

  // hops: [{rin, rout, venue?, feeBps?}] reserves as BigInt
  function simulate(hops, x) {
    for (const h of hops) x = hopOut(h, x);
    return x;
  }

  // Size that maximises (out - in). Profit is concave in size, so ternary search works.
  function bestSize(hops, cap) {
    let lo = 1n, hi = cap > 1n ? cap : 1n;
    const p = x => simulate(hops, x) - x;
    while (hi - lo > 8n) {
      const m1 = lo + (hi - lo) / 3n, m2 = hi - (hi - lo) / 3n;
      if (p(m1) < p(m2)) lo = m1; else hi = m2;
    }
    let best = lo, bp = p(lo);
    for (let x = lo; x <= hi; x++) { const v = p(x); if (v > bp) { bp = v; best = x; } }
    return { amountIn: best, amountOut: simulate(hops, best), profit: bp };
  }

  // pairs: [{id, t0, t1, d0, d1, r0, r1, usd}] with r0/r1 as floats in whole tokens (from the KoinDX API)
  // Returns candidate loops that start and end at one of `starts`, up to maxHops pools long.
  function findLoops(pairs, starts, opts = {}) {
    const maxHops = opts.maxHops || 4, minEdge = opts.minEdge || 1.002, minUsd = opts.minUsd ?? 0.5;
    const allow = opts.allowToken || (() => true);
    const adj = new Map();
    for (const p of pairs) {
      if (!(p.r0 > 0 && p.r1 > 0) || p.usd < minUsd) continue;
      if (!adj.has(p.t0)) adj.set(p.t0, []);
      if (!adj.has(p.t1)) adj.set(p.t1, []);
      adj.get(p.t0).push({ p, from: p.t0, to: p.t1, rate: p.r1 / p.r0 });
      adj.get(p.t1).push({ p, from: p.t1, to: p.t0, rate: p.r0 / p.r1 });
    }
    const out = [];
    for (const S of starts) {
      const walk = (tok, path, used, seen, rate) => {
        if (path.length >= maxHops) return;
        for (const e of adj.get(tok) || []) {
          if (used.has(e.p.id)) continue;
          const r = rate * e.rate * (1 - (e.p.feeBps ?? 25) / 10000);
          if (e.to === S) {
            if (path.length >= 1 && r > minEdge) out.push({ start: S, edges: [...path, e], edge: r });
            continue;
          }
          if (seen.has(e.to) || !allow(e.to)) continue;
          used.add(e.p.id); seen.add(e.to);
          walk(e.to, [...path, e], used, seen, r);
          used.delete(e.p.id); seen.delete(e.to);
        }
      };
      walk(S, [], new Set(), new Set([S]), 1);
    }
    return out;
  }

  // Rough float estimate of the best profit for ranking before on-chain verification
  function estimate(loop) {
    const hops = loop.edges.map(e => {
      const fwd = e.from === e.p.t0;
      const dIn = fwd ? e.p.d0 : e.p.d1, dOut = fwd ? e.p.d1 : e.p.d0;
      return {
        rin: BigInt(Math.floor((fwd ? e.p.r0 : e.p.r1) * 10 ** dIn)),
        rout: BigInt(Math.floor((fwd ? e.p.r1 : e.p.r0) * 10 ** dOut)),
        venue: e.p.venue, feeBps: e.p.feeBps,
      };
    });
    const cap = hops[0].rin;
    return bestSize(hops, cap);
  }

  g.LoopCore = { amountOut, amountOutOwn, hopOut, simulate, bestSize, findLoops, estimate };
})(typeof window !== 'undefined' ? window : globalThis);

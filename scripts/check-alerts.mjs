// Checks three opportunities and opens/closes one GitHub issue per type (GitHub emails new issues to the owner).
//  1. VHP buy edge  - buying VHP in the KoinDX pool beats burning by >= VHP_EDGE_PCT
//  2. Loop trade    - a KoinDX loop (listed tokens only) returns >= LOOP_MIN_KOIN extra KOIN
//  3. Cross-chain   - bridged KOIN price gap after pool fees >= XCHAIN_NET_PCT
// Anti-spam: one open issue per type, a cooldown per type after it closes, and a daily cap across all types.
import { appendFileSync } from 'node:fs';
await import('../js/loopcore.js');
const LoopCore = globalThis.LoopCore;

const env = (k, d) => parseFloat(process.env[k] || d);
const CFG = {
  vhp: { pct: env('VHP_EDGE_PCT', '5'), cooldownH: env('VHP_COOLDOWN_H', '1') },
  loop: { minKoin: env('LOOP_MIN_KOIN', '25'), cooldownH: env('LOOP_COOLDOWN_H', '6') },
  xchain: { netPct: env('XCHAIN_NET_PCT', '5'), cooldownH: env('XCHAIN_COOLDOWN_H', '12') },
  maxPerDay: env('MAX_ALERTS_PER_DAY', '6'),
  bot: { minKoin: env('BOT_LOW_KOIN', '150'), cooldownH: env('BOT_COOLDOWN_H', '24') },
};
const REPO = process.env.GITHUB_REPOSITORY || 'bawcejawn/Koin-chart';
const TOKEN = process.env.GH_TOKEN;
const NOTIFY = process.env.NOTIFY_USER || REPO.split('/')[0];
const PAGE = `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/`;
const VHP_PAIR = '1NqLghiFRwkXZR7NBFHHiCJkF5gLHyJap1';
const USDT_POOL = '1E8AjPZxKLJGFouXtNNkPcYxAgsTh4AUTN';
const f = (x, d = 2) => (+x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

async function retry(fn, n = 3) {
  for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); } }
}
const getJson = url => retry(async () => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); });
async function rpc(method, params) {
  return retry(async () => {
    const r = await fetch('https://api.koinos.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json(); if (j.error) throw new Error(j.error.data || j.error.message); return j.result;
  });
}
function pb(buf) {
  const o = {}; let i = 0;
  const vr = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 127) << s; s += 7n; } while (b & 128); return r; };
  while (i < buf.length) { const k = Number(vr()), fl = k >> 3, t = k & 7; if (t === 0) o[fl] = vr(); else if (t === 2) { const l = Number(vr()); i += l; } else break; }
  return o;
}
async function reserves(pair) {
  const r = await rpc('chain.read_contract', { contract_id: pair, entry_point: 0x6d0c5abf, args: '' });
  const d = pb(Buffer.from(r.result || '', 'base64url'));
  return { a: BigInt(d[2] || 0n), b: BigInt(d[3] || 0n) };
}

// ---------- 1. VHP edge ----------
async function checkVhp() {
  const r = await reserves(VHP_PAIR);
  const V = Number(r.a) / 1e8, K = Number(r.b) / 1e8, F = 0.9975;
  const edge = (F * V / K - 1) * 100;
  const best = Math.max(0, (Math.sqrt(K * V * F) - K) / F);
  const out = V * F * best / (K + F * best);
  return {
    open: edge >= CFG.vhp.pct, value: edge,
    title: `VHP buy edge +${edge.toFixed(2)}% vs burning`,
    body: [`Buying VHP in the pool beats burning by **${edge.toFixed(2)}%** (alert level ${CFG.vhp.pct}%).`,
      `Best amount: **${f(best)} KOIN** → about ${f(out)} VHP (**+${f(out - best)} VHP** vs burning).`,
      `Open the page and use **Buy best amount**: ${PAGE}#buy`].join('\n\n'),
    closeNote: `edge is back to ${edge.toFixed(2)}%`,
  };
}

// ---------- 4. Bot needs a top-up ----------
const BOT_ADDRESS = (process.env.BOT_ADDRESS || '').trim();
const KOIN = '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK';
function b58decode(str) {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n; for (const c of str) { const v = A.indexOf(c); if (v < 0) throw new Error('bad address'); n = n * 58n + BigInt(v); }
  const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of str) { if (c !== '1') break; bytes.unshift(0); }
  return Buffer.from(bytes);
}
async function checkBot() {
  const addr = b58decode(BOT_ADDRESS);
  const args = Buffer.concat([Buffer.from([0x0a, addr.length]), addr]).toString('base64url');
  const r = await rpc('chain.read_contract', { contract_id: KOIN, entry_point: 0x5c721497, args });
  const koin = Number(pb(Buffer.from(r.result || '', 'base64url'))[1] || 0n) / 1e8;
  return {
    open: koin < CFG.bot.minKoin, value: koin,
    title: `Bot needs KOIN: ${f(koin)} left`,
    body: [`The bot address \`${BOT_ADDRESS}\` has **${f(koin)} KOIN** (alert below ${CFG.bot.minKoin}). It always keeps 100 KOIN, so it can only trade above that.`,
      `Send KOIN to \`${BOT_ADDRESS}\` to keep it buying VHP and running loops.`].join('\n\n'),
    closeNote: `balance is back to ${f(koin)} KOIN`,
  };
}

// ---------- 2. Loops ----------
async function checkLoops() {
  const pairs = [];
  for (let page = 1; page < 12; page++) {
    const j = await getJson(`https://api.koindx.com/v2/pairs?pageSize=100&page=${page}`);
    if (!j.result || !j.result.length) break;
    pairs.push(...j.result.map(p => ({ id: p.id, t0: p.token0.id, t1: p.token1.id, s0: p.token0.symbol, s1: p.token1.symbol, d0: +p.token0.decimals || 8, d1: +p.token1.decimals || 8, r0: +p.reserve0, r1: +p.reserve1, usd: +p.reserveUSD || 0 })));
    if (j.result.length < 100) break;
  }
  let listed = new Set(['koin', 'vhp']);
  try { listed = new Set(((await getJson('https://tokens.koindx.com/mainnet.json')).tokens || []).map(t => t.address)); } catch {}
  const sym = {}; for (const p of pairs) { sym[p.t0] = p.t0 === 'koin' ? 'KOIN' : p.t0 === 'vhp' ? 'VHP' : p.s0; sym[p.t1] = p.t1 === 'koin' ? 'KOIN' : p.t1 === 'vhp' ? 'VHP' : p.s1; }
  const cands = LoopCore.findLoops(pairs, ['koin'], { maxHops: 4, minEdge: 1.003, minUsd: 1, allowToken: id => listed.has(id) })
    .map(l => ({ l, est: LoopCore.estimate(l) })).filter(x => x.est.profit > 0n)
    .sort((x, y) => (y.est.profit > x.est.profit ? 1 : -1)).slice(0, 10);
  let best = null;
  for (const { l } of cands) {
    const hops = [];
    for (const e of l.edges) { const r = await reserves(e.p.id); const fwd = e.from === e.p.t0; hops.push({ rin: fwd ? r.a : r.b, rout: fwd ? r.b : r.a }); }
    const b = LoopCore.bestSize(hops, hops[0].rin);
    if (!best || b.profit > best.profit) best = { ...b, path: [l.start, ...l.edges.map(e => e.to)].map(t => sym[t] || t) };
  }
  const profit = best ? Number(best.profit) / 1e8 : 0;
  return {
    open: profit >= CFG.loop.minKoin, value: profit,
    title: `Loop trade worth +${f(profit)} KOIN`,
    body: best ? [`A loop returns **+${f(profit)} KOIN** (alert level ${CFG.loop.minKoin} KOIN).`,
      `Route: **${best.path.join(' → ')}**, putting in ${f(Number(best.amountIn) / 1e8)} KOIN.`,
      `Run it from the Loops section: ${PAGE}#loops`].join('\n\n') : '',
    closeNote: `the best loop is now worth ${f(profit)} KOIN`,
  };
}

// ---------- 3. Cross-chain ----------
async function checkXchain() {
  const ur = await reserves(USDT_POOL);
  const native = Number(ur.b) / Number(ur.a);
  const pools = { eth: ['0xd833a3afa936ca389966a9ed3a3d9abf7ec45c11b0d575aaaf6ca4d354687da6', '0xe447e81e2d7e7ca63a25ac0ee9de835dc6aae79a', '0xf3fb8ddbfb8845eb5caf0c7951a7bfc31826f6569ed4408a4d249b4de01b4fb4'], base: ['0x67e2b4bf9917e1ab76bff55dbe125d27858c04bfe77da71b8721d526059859c3'], solana: ['2kbZSkxa3M7VAWMnZDqBNarkFFBYUyskeavXnq1oK3gT'] };
  const names = { eth: 'Ethereum', base: 'Base', solana: 'Solana' };
  let best = null;
  for (const [net, addrs] of Object.entries(pools)) {
    const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/multi/${addrs.join(',')}`);
    for (const d of j.data || []) {
      const a = d.attributes, liq = +a.reserve_in_usd || 0;
      if (liq < 1000) continue;
      const price = +(/^vKOIN/i.test(a.name) ? a.base_token_price_usd : a.quote_token_price_usd);
      const gap = (price / native - 1) * 100, netGap = Math.abs(gap) - 1 - 0.25;
      if (!best || netGap > best.netGap) best = { chain: names[net], name: a.name, gap, netGap, price };
    }
  }
  const v = best ? best.netGap : 0;
  return {
    open: v >= CFG.xchain.netPct, value: v,
    title: `Cross-chain KOIN gap ${f(v)}% after pool fees`,
    body: best ? [`Bridged KOIN on **${best.chain}** (${best.name}) is ${best.gap >= 0 ? 'above' : 'below'} native KOIN by **${f(Math.abs(best.gap))}%** (${f(best.netGap)}% after pool fees; alert level ${CFG.xchain.netPct}%).`,
      `Native KOIN $${native.toFixed(5)} vs vKOIN $${best.price.toFixed(5)}. Bridge fees and gas are not included.`,
      `Details: ${PAGE}#crosschain`].join('\n\n') : '',
    closeNote: `the gap after fees is now ${f(v)}%`,
  };
}

// ---------- GitHub issues ----------
async function gh(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 422) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const LABELS = { vhp: 'vhp-alert', loop: 'loop-alert', xchain: 'xchain-alert', bot: 'bot-topup' };

async function handle(type, res) {
  const label = LABELS[type];
  const open = (await gh('GET', `/issues?labels=${label}&state=open&per_page=5`)) || [];
  if (open.length) {
    if (!res.open) {
      for (const is of open) {
        const mins = Math.round((Date.now() - new Date(is.created_at)) / 60000);
        await gh('POST', `/issues/${is.number}/comments`, { body: `Window closed: ${res.closeNote}. It lasted about ${mins} minutes (checked every 10 minutes).` });
        await gh('PATCH', `/issues/${is.number}`, { state: 'closed' });
      }
      return 'closed';
    }
    return 'still open';
  }
  if (!res.open) return 'quiet';
  const closed = (await gh('GET', `/issues?labels=${label}&state=closed&sort=updated&direction=desc&per_page=1`)) || [];
  const cool = CFG[type].cooldownH * 3600e3;
  if (closed[0] && closed[0].closed_at && Date.now() - new Date(closed[0].closed_at) < cool) return 'cooldown';
  const since = new Date(Date.now() - 864e5).toISOString();
  let recent = 0;
  for (const l of Object.values(LABELS)) recent += ((await gh('GET', `/issues?labels=${l}&state=all&since=${since}&per_page=50`)) || []).filter(i => new Date(i.created_at) > new Date(since)).length;
  if (recent >= CFG.maxPerDay) return 'daily cap reached';
  await gh('POST', '/labels', { name: label, color: '26a69a', description: 'Koin-chart alert' });
  await gh('POST', '/issues', { title: res.title, labels: [label], assignees: [NOTIFY], body: `@${NOTIFY} ${res.body}\n\nThis issue closes automatically when the opportunity is gone.` });
  return 'opened';
}

const checks = { vhp: checkVhp, loop: checkLoops, xchain: checkXchain, ...(BOT_ADDRESS ? { bot: checkBot } : {}) };
const summary = [];
let failed = 0;
for (const [type, fn] of Object.entries(checks)) {
  try {
    const res = await fn();
    const action = TOKEN ? await handle(type, res) : 'dry run (no token)';
    summary.push(`${type}: value=${res.value.toFixed(3)} open=${res.open} -> ${action}`);
  } catch (e) { failed++; summary.push(`${type}: ERROR ${e.message}`); }
}
console.log(summary.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + summary.join('\n') + '\n```\n');
if (failed === Object.keys(checks).length) process.exit(1);

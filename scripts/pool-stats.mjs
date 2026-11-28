// Daily: snapshot our pools (for the public stats on pools.html) and KoinDX pair volumes (for the weekly scout).
// Weekly (SCOUT=1): email a short list of pairs worth opening a pool for.
// Writes to ./stats (a checkout of the `stats` branch). Needs only public data; posts the weekly issue with GITHUB_TOKEN.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.STATS_DIR || 'stats';
const RPC = 'https://api.koinos.io';
const REPO = process.env.GITHUB_REPOSITORY || 'bawcejawn/Koin-chart';
const NOTIFY_USER = process.env.NOTIFY_USER || 'bawcejawn';
fs.mkdirSync(DIR, { recursive: true });

// ---- config from the page's own settings file ----
const cfgText = fs.readFileSync('js/pools-config.js', 'utf8');
const CONTRACT = (cfgText.match(/contract:\s*'([^']*)'/) || [])[1] || '';
const TOKENS = [...cfgText.matchAll(/\{ sym: '([^']+)', id: '([^']+)'/g)].map(m => ({ sym: m[1], id: m[2] }));
const PAIRS = [...cfgText.matchAll(/\['(\w+)', '(\w+)'\]/g)].map(m => [m[1], m[2]]);

async function rpc(method, params) {
  for (const url of [RPC, 'https://api.koinosblocks.com']) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { /* next node */ }
  }
  throw new Error('no node answered');
}
const getJson = async u => (await fetch(u)).json();

// minimal protobuf for get_pool: args = token_a(1), token_b(2); result = pool_object
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58d(s) { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const b = []; while (n > 0n) { b.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; b.unshift(0); } return Buffer.from(b); }
function b58e(buf) { let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of buf) { if (x !== 0) break; s = '1' + s; } return s; }
function pb(buf) { const o = {}; let i = 0; const vr = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 127) << s; s += 7n; } while (b & 128); return r; }; while (i < buf.length) { const k = Number(vr()), f = k >> 3, t = k & 7; if (t === 0) o[f] = vr(); else if (t === 2) { const l = Number(vr()); o[f] = buf.subarray(i, i + l); i += l; } else break; } return o; }
const ABI = JSON.parse(fs.readFileSync('contracts/pool/build/pool-abi.json', 'utf8'));

async function snapshotPools() {
  if (!CONTRACT) return null;
  const ep = ABI.methods.get_pool.entry_point;
  const T = Object.fromEntries(TOKENS.map(t => [t.sym, t.id]));
  const out = [];
  for (const [a, b] of PAIRS) {
    const A = b58d(T[a]), B = b58d(T[b]);
    const args = Buffer.concat([Buffer.from([0x0a, A.length]), A, Buffer.from([0x12, B.length]), B]).toString('base64url');
    const r = await rpc('chain.read_contract', { contract_id: CONTRACT, entry_point: ep, args });
    const d = pb(Buffer.from(r.result || '', 'base64url'));
    if (!d[1]) continue;
    out.push({ a: b58e(d[2]), b: b58e(d[3]), ra: String(d[4] || 0n), rb: String(d[5] || 0n), fee: Number(d[6] || 0n), shares: String(d[8] || 0n), ofa: String(d[9] || 0n), ofb: String(d[10] || 0n) });
  }
  return out;
}

async function koindxPairs() {
  const all = [];
  for (let p = 1; p < 12; p++) { const j = await getJson(`https://api.koindx.com/v2/pairs?pageSize=100&page=${p}`); if (!j.result || !j.result.length) break; all.push(...j.result); if (j.result.length < 100) break; }
  return all.map(p => ({ id: p.id, t0: p.token0.id, s0: p.token0.symbol, t1: p.token1.id, s1: p.token1.symbol, usd: +p.reserveUSD || 0, vol: +p.volumeUSD || 0 }));
}

function appendLine(file, obj, keep = 400) {
  let lines = []; try { lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean); } catch (e) {}
  lines.push(JSON.stringify(obj));
  fs.writeFileSync(file, lines.slice(-keep).join('\n') + '\n');
}

async function scout(pairs) {
  // weekly volume = this snapshot's cumulative volumeUSD minus the one ~7 days ago
  let hist = []; try { hist = fs.readFileSync(path.join(DIR, 'koindx.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch (e) {}
  const weekAgo = hist.filter(h => Date.now() - new Date(h.at).getTime() >= 6.5 * 864e5).pop();
  const prev = weekAgo ? new Map(weekAgo.pairs.map(p => [p.id, p.vol])) : null;
  const listed = new Set(((await getJson('https://tokens.koindx.com/mainnet.json')).tokens || []).map(t => t.address).concat(['koin', 'vhp']));
  const rows = pairs.filter(p => p.usd >= 5 && listed.has(p.t0) && listed.has(p.t1)).map(p => {
    const wk = prev && prev.has(p.id) ? Math.max(0, p.vol - prev.get(p.id)) : null;
    return { ...p, wk, turnover: wk != null ? wk / p.usd : null, feesAt3: wk != null ? wk * 0.003 * 10 : null };
  });
  // 1) busy pairs: lots of weekly volume for their liquidity -> a deeper pool of ours could take part of that flow
  const busy = rows.filter(r => r.wk).sort((x, y) => y.turnover - x.turnover).slice(0, 5);
  // 2) missing pairs: two well-funded listed tokens with no direct KoinDX pair -> traders route through 2 hops today
  const depth = new Map();
  for (const p of rows) for (const [t, s] of [[p.t0, p.s0], [p.t1, p.s1]]) { const d = depth.get(t) || { s, usd: 0 }; d.usd += p.usd; depth.set(t, d); }
  const big = [...depth].filter(([, d]) => d.usd >= 50).sort((a, b) => b[1].usd - a[1].usd).slice(0, 12);
  const have = new Set(pairs.map(p => [p.t0, p.t1].sort().join('|')));
  const missing = [];
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const k = [big[i][0], big[j][0]].sort().join('|');
    if (!have.has(k)) missing.push({ pair: `${big[i][1].s}/${big[j][1].s}`, depth: Math.min(big[i][1].usd, big[j][1].usd) });
  }
  missing.sort((a, b) => b.depth - a.depth);
  const $ = x => '$' + (+x).toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 2 : 0 });
  const lines = [`@${NOTIFY_USER} Weekly pair scout (listed tokens only).`, ''];
  lines.push('**Busiest KoinDX pairs for their size** (weekly volume ÷ liquidity). A pool of yours on these pairs competes for real flow:');
  lines.push(busy.length ? busy.map(r => `- ${r.s0}/${r.s1}: ${$(r.wk)} volume on ${$(r.usd)} liquidity (${(r.turnover * 100).toFixed(0)}% turnover)`).join('\n') : '- Not enough history yet (needs a week of daily snapshots).');
  lines.push('', '**Well-funded tokens with no direct pair** (traders pay two fees today):');
  lines.push(missing.length ? missing.slice(0, 5).map(m => `- ${m.pair} (thinner side has ${$(m.depth)} of liquidity on KoinDX)`).join('\n') : '- None this week.');
  lines.push('', 'Opening a pool is your call: the fee is permanent once set. Reply here with the pair and fee if you want me to prepare it.');
  return lines.join('\n');
}

async function postIssue(title, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.log(body); return; }
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  await fetch(`https://api.github.com/repos/${REPO}/issues`, { method: 'POST', headers: h, body: JSON.stringify({ title, body, labels: ['pair-scout'] }) });
}

const at = new Date().toISOString();
const pools = await snapshotPools();
if (pools) appendLine(path.join(DIR, 'pools.jsonl'), { at, pools });
const kp = await koindxPairs();
appendLine(path.join(DIR, 'koindx.jsonl'), { at, pairs: kp.map(p => ({ id: p.id, vol: p.vol, usd: p.usd })) }, 60);
console.log(`snapshot: ${pools ? pools.length : 0} own pools, ${kp.length} KoinDX pairs`);
if (process.env.SCOUT === '1') {
  const body = await scout(kp);
  await postIssue(`Pair scout ${at.slice(0, 10)}`, body);
  console.log(body);
}

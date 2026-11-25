// Checks the KoinDX VHP/KOIN pool and prints the current edge of buying VHP
// in the pool versus burning KOIN 1:1. Writes results to $GITHUB_OUTPUT.
import { appendFileSync } from 'node:fs';

const PAIR = '1NqLghiFRwkXZR7NBFHHiCJkF5gLHyJap1';     // token0 = VHP, token1 = KOIN
const USDT_POOL = '1E8AjPZxKLJGFouXtNNkPcYxAgsTh4AUTN'; // token0 = KOIN, token1 = vUSDT
const GET_RESERVES = 0x6d0c5abf;
const FEE = 0.9975;
const THRESHOLD = parseFloat(process.env.THRESHOLD_PCT || '5');

async function rpc(method, params) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.koinos.io', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.data || j.error.message);
      return j.result;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(res => setTimeout(res, 2000 * (i + 1)));
    }
  }
}

// minimal protobuf reader: varint fields only (string/bytes fields skipped)
function pb(buf) {
  const o = {}; let i = 0;
  const vr = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 127) << s; s += 7n; } while (b & 128); return r; };
  while (i < buf.length) {
    const k = Number(vr()), f = k >> 3, t = k & 7;
    if (t === 0) o[f] = vr();
    else if (t === 2) { const l = Number(vr()); i += l; }
    else break;
  }
  return o;
}

async function reserves(contract) {
  const r = await rpc('chain.read_contract', { contract_id: contract, entry_point: GET_RESERVES, args: '' });
  const d = pb(Buffer.from(r.result, 'base64url'));
  return [Number(d[2] || 0n) / 1e8, Number(d[3] || 0n) / 1e8];
}

const [V, K] = await reserves(PAIR);
if (!V || !K) throw new Error('Could not read pool reserves');
let koinUsd = null;
try { const [k, u] = await reserves(USDT_POOL); koinUsd = k && u ? u / k : null; } catch {}

const swapOut = x => V * FEE * x / (K + FEE * x);
const rate = FEE * V / K;
const edge = (rate - 1) * 100;
const best = Math.max(0, (Math.sqrt(K * V * FEE) - K) / FEE);
const bestOut = swapOut(best);
const gain = bestOut - best;
const breakEven = Math.max(0, (V * FEE - K) / FEE);

const f = (x, d = 2) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const summary = [
  `Edge vs burning: **+${edge.toFixed(2)}%** (${f(rate, 5)} VHP per KOIN on a small swap)`,
  `Best amount to swap: **${f(best)} KOIN** → about ${f(bestOut)} VHP (**+${f(gain)} VHP** vs burning${koinUsd ? `, about $${f(gain * koinUsd)}` : ''})`,
  `Break-even size: ${f(breakEven)} KOIN`,
  `Pool reserves: ${f(V, 0)} VHP / ${f(K, 0)} KOIN`,
].join('\n');

console.log(`edge=${edge.toFixed(3)}% threshold=${THRESHOLD}% best=${best.toFixed(2)} KOIN gain=${gain.toFixed(2)} VHP`);
const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(out, `edge=${edge.toFixed(2)}\n`);
  appendFileSync(out, `open=${edge >= THRESHOLD ? 'true' : 'false'}\n`);
  appendFileSync(out, `summary<<EOF_SUMMARY\n${summary}\nEOF_SUMMARY\n`);
}

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Bot } = require('../src/bot');
const { ADDR } = require('../src/chain');

const E8 = 100000000n;
const PRODUCER = '1DAHmrQJMAbn4FmMMrew78wPUizjVdbBrd';

function cfg(over = {}) {
  return {
    mode: 'paper', rpc: [], producerAddress: PRODUCER, reserveKoin: 100, lowBalanceKoin: 150, pollMs: 3000,
    vhp: { enabled: true, minEdgePct: 1, slippagePct: 0.5, minTradeKoin: 1, sweepMinVhp: 1 },
    loops: { enabled: false, starts: ['koin'], minProfitKoin: 0.5, keepProfitPct: 50, includeUnlisted: false, allowTokens: [], minPoolUsd: 1, scanEverySec: 60 },
    paper: { startKoin: 1000 }, ...over,
  };
}
// Pool with VHP cheaper than burning: 330k VHP vs 300k KOIN -> ~9.7% edge
function mockChain(res = { a: 330000n * E8, b: 300000n * E8 }, wallet = { koin: 1000n * E8, vhp: 0n, mana: 1000n * E8 }) {
  const sent = [];
  return {
    sent, res, wallet,
    async head() { return { height: Date.now() } },
    async reserves() { return { ...this.res } },
    async token0() { return ADDR.VHP },
    async balance(t) { return t === 'koin' ? this.wallet.koin : this.wallet.vhp },
    async mana() { return this.wallet.mana },
    async allowance() { return 0n },
    async approveOp(t, o, v) { return { kind: 'approve', t, v } },
    async swapOp(o, i, m, p) { return { kind: 'swap', amountIn: i, minOut: m, path: p } },
    async transferOp(t, f, to, v) { return { kind: 'transfer', t, to, v } },
    async send(signer, ops) { sent.push(ops); return { id: '0xtest' + sent.length } },
    verifyResult: { ok: true, sources: 3, bad: [] },
    async verify() { return this.verifyResult },
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kcbot-'));
const notes = [];
const notifier = { async send(kind, key, title) { notes.push({ kind, key, title }); return true }, dailyDue() { return null } };
const fakeSigner = { getAddress: () => '1BotAddressxxxxxxxxxxxxxxxxxxxxxx' };

test('paper: buys the best amount when edge >= 1% and sends VHP to the producer', async () => {
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain: mockChain(), dataDir: tmp(), notifier });
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 1);
  const s = bot.summary();
  assert.ok(s.extraVhpVsBurn > 0, 'must gain VHP vs burning');
  assert.ok(s.paperVhpSent > 0 && bot.paper.vhp === 0n, 'all VHP swept to producer');
  // best amount for these reserves is ~14,000 KOIN (closed form)
  const F = 0.9975, V = 330000, K = 300000, best = (Math.sqrt(K * V * F) - K) / F;
  assert.ok(Math.abs(s.koinSpent - best) < 1, `spent ${s.koinSpent} vs best ${best}`);
});

test('always keeps the 100 KOIN reserve', async () => {
  const bot = new Bot(cfg({ paper: { startKoin: 150 } }), { chain: mockChain(), dataDir: tmp(), notifier });
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 1);
  assert.ok(Math.abs(bot.summary().koinSpent - 50) < 0.01, 'spends exactly balance - reserve');
  assert.ok(bot.paper.koin >= 100n * E8, 'reserve kept');
  await bot.vhpCheck(); // nothing left to spend
  assert.equal(bot.stats.buys, 1);
});

test('does nothing when edge is below 1%', async () => {
  const bot = new Bot(cfg(), { chain: mockChain({ a: 302000n * E8, b: 300000n * E8 }), dataDir: tmp() });
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 0);
});

test('paper trade moves the shadow pool, so the same edge is not bought twice', async () => {
  const chain = mockChain();
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain, dataDir: tmp(), notifier });
  await bot.vhpCheck();
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 1, 'second check sees the pool after our pretend trade');
  chain.res = { a: 340000n * E8, b: 300000n * E8 }; // someone sold 10k VHP into the real pool: a new edge on top of ours
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 2);
});

test('live: one transaction approve+swap with minOut >= amountIn, then transfer to the producer only', async () => {
  const chain = mockChain();
  const bot = new Bot(cfg({ mode: 'live' }), { chain, dataDir: tmp(), notifier, signer: fakeSigner });
  bot.signer = fakeSigner; bot.address = fakeSigner.getAddress();
  chain.wallet = { koin: 1000n * E8, vhp: 0n, mana: 1000n * E8 };
  // after the swap the wallet holds VHP
  const origSend = chain.send.bind(chain);
  chain.send = async (s, ops) => { const r = await origSend(s, ops); if (ops.some(o => o.kind === 'swap')) chain.wallet.vhp = 500n * E8; return r; };
  await bot.vhpCheck();
  assert.equal(chain.sent.length, 2);
  const [swapTx, sweepTx] = chain.sent;
  assert.deepEqual(swapTx.map(o => o.kind), ['approve', 'swap']);
  const sw = swapTx[1];
  assert.deepEqual(sw.path, ['koin', 'vhp']);
  assert.ok(sw.minOut > sw.amountIn, 'never accepts less than burning');
  assert.equal(sw.amountIn, 900n * E8, 'uses everything above the 100 KOIN reserve');
  assert.equal(sweepTx[0].kind, 'transfer');
  assert.equal(sweepTx[0].to, PRODUCER);
  assert.equal(sweepTx[0].v, 500n * E8);
});

test('live: limited by mana, not just balance', async () => {
  const chain = mockChain();
  const bot = new Bot(cfg({ mode: 'live' }), { chain, dataDir: tmp(), notifier, signer: fakeSigner });
  bot.signer = fakeSigner; bot.address = fakeSigner.getAddress();
  chain.wallet = { koin: 1000n * E8, vhp: 0n, mana: 300n * E8 };
  await bot.vhpCheck();
  assert.ok(chain.sent[0][1].amountIn <= 298n * E8);
});

test('skips the trade when the other nodes report different reserves', async () => {
  const chain = mockChain();
  chain.verifyResult = { ok: false, sources: 2, bad: [{ pair: ADDR.VHP_PAIR, node: 'http://127.0.0.1:8081' }] };
  const dir = tmp();
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain, dataDir: dir, notifier });
  await bot.vhpCheck();
  assert.strictEqual(bot.stats.buys, 0);
  assert.match(fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8'), /verify-fail/);
});

test('STOP file stops all trading', async () => {
  const dir = tmp();
  const stopFile = path.join(dir, 'STOP');
  fs.writeFileSync(stopFile, '');
  const chain = mockChain();
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain, dataDir: dir, notifier, stopFile });
  await bot.tick();
  assert.strictEqual(bot.stats.buys, 0);
  fs.unlinkSync(stopFile);
  await bot.tick();
  assert.strictEqual(bot.stats.buys, 1);
});

test('live: emails when the best VHP buy needs more KOIN than the bot can spend', async () => {
  notes.length = 0;
  const chain = mockChain(undefined, { koin: 1000n * E8, vhp: 0n, mana: 1000n * E8 });
  const bot = new Bot(cfg({ mode: 'live' }), { chain, dataDir: tmp(), notifier, signer: fakeSigner });
  await bot.vhpCheck();
  assert.ok(notes.some(n => n.key === 'shortfall'), 'shortfall email queued');
  assert.strictEqual(bot.stats.buys, 1); // still buys what it can
});

test('mixed-venue loop: each segment passes on only its guaranteed minimum, and the loop still profits', () => {
  const bot = new Bot(cfg({ loops: { ...cfg().loops, segmentSlippagePct: 0.3 } }), { chain: mockChain(), dataDir: tmp(), notifier });
  const hops = [
    { rin: 100000n * E8, rout: 2000n * E8, venue: 'koindx', from: 'koin', to: 'USDT', pool: 'p1' },        // KOIN -> USDT on KoinDX
    { rin: 1800n * E8, rout: 100000n * E8, venue: 'own', feeBps: 100, from: 'USDT', to: 'koin', pool: 'own:C:a:b' }, // USDT -> KOIN in our 1% pool
  ];
  const plan = bot.planSegments(hops, 500n * E8);
  assert.strictEqual(plan.segs.length, 2);
  assert.strictEqual(plan.segs[1].amountIn, plan.segs[0].minOut);
  assert.ok(plan.segs[0].minOut < plan.segs[0].expected);
  assert.ok(plan.profit > 0n, 'profitable even after the haircut');
});

test('own-pool math matches the contract: fee rounded up, 1%', () => {
  const { LoopCore } = require('../src/chain');
  // 150 units at 1%: fee 1.5 -> 2, 148 goes in
  const out = LoopCore.amountOutOwn(150n, 300000n * E8, 100n * E8, 100);
  assert.strictEqual(out, (148n * 100n * E8) / (300000n * E8 + 148n));
});

test('daily summary is due once per day at 8 AM New York time', () => {
  const { Notifier } = require('../src/notify');
  const n = new Notifier({}, () => {}, tmp());
  assert.strictEqual(n.dailyDue(8, 'America/New_York', new Date('2026-11-28T12:30:00Z')), null); // 7:30 ET
  assert.strictEqual(n.dailyDue(8, 'America/New_York', new Date('2026-11-28T13:05:00Z')), '2026-11-28'); // 8:05 ET
  assert.strictEqual(n.dailyDue(8, 'America/New_York', new Date('2026-11-28T15:00:00Z')), null); // already sent today
  assert.strictEqual(n.dailyDue(8, 'America/New_York', new Date('2026-11-29T13:01:00Z')), '2026-11-29');
});

test('paper: a real trade by someone else does not erase our pretend trade', async () => {
  const chain = mockChain();
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain, dataDir: tmp(), notifier });
  await bot.vhpCheck();
  assert.strictEqual(bot.stats.buys, 1);
  const after = await bot.reserves(ADDR.VHP_PAIR);
  // someone else sells 1 VHP into the real pool
  const real = await chain.reserves(ADDR.VHP_PAIR);
  chain.res = { a: real.a + 1n * E8, b: real.b - 1n * E8 };
  const shifted = await bot.reserves(ADDR.VHP_PAIR);
  assert.strictEqual(shifted.a, after.a + 1n * E8);
  assert.strictEqual(shifted.b, after.b - 1n * E8);
  await bot.vhpCheck(); // the edge is gone in our shadow book, so no second big buy
  assert.strictEqual(bot.stats.buys, 1);
});

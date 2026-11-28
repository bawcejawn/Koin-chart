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
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kcbot-'));
const fakeSigner = { getAddress: () => '1BotAddressxxxxxxxxxxxxxxxxxxxxxx' };

test('paper: buys the best amount when edge >= 1% and sends VHP to the producer', async () => {
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain: mockChain(), dataDir: tmp() });
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
  const bot = new Bot(cfg({ paper: { startKoin: 150 } }), { chain: mockChain(), dataDir: tmp() });
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
  const bot = new Bot(cfg({ paper: { startKoin: 100000 } }), { chain, dataDir: tmp() });
  await bot.vhpCheck();
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 1, 'second check sees the pool after our pretend trade');
  chain.res = { a: 331000n * E8, b: 300000n * E8 }; // a real trade changed the pool
  await bot.vhpCheck();
  assert.equal(bot.stats.buys, 2);
});

test('live: one transaction approve+swap with minOut >= amountIn, then transfer to the producer only', async () => {
  const chain = mockChain();
  const bot = new Bot(cfg({ mode: 'live' }), { chain, dataDir: tmp(), signer: fakeSigner });
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
  const bot = new Bot(cfg({ mode: 'live' }), { chain, dataDir: tmp(), signer: fakeSigner });
  bot.signer = fakeSigner; bot.address = fakeSigner.getAddress();
  chain.wallet = { koin: 1000n * E8, vhp: 0n, mana: 300n * E8 };
  await bot.vhpCheck();
  assert.ok(chain.sent[0][1].amountIn <= 298n * E8);
});

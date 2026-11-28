// End-to-end test of the pool contract on a private local Koinos chain (Docker, via @roamin/local-koinos).
// Deploys test tokens (tETH, tUSDT, tUSDC), the pool contract, opens the 5 planned pools,
// adds liquidity, trades, checks fees and the owner share, removes liquidity, and checks the guards.
// Writes report.json and exits non-zero if any check fails.
const fs = require('fs');
const path = require('path');
const { LocalKoinos } = require('@roamin/local-koinos');
const { Provider, Signer, Contract, Transaction } = require('koilib');

const RPC = 'http://127.0.0.1:8080';
const E8 = 100000000n;
const POOL_WASM = path.join(__dirname, '..', 'contracts', 'pool', 'build', 'release', 'pool.wasm');
const POOL_ABI = require('../contracts/pool/build/pool-abi.json');
const TOKEN_WASM = path.join(__dirname, 'fixtures', 'kcs4-token.wasm');
const TOKEN_ABI = require('./fixtures/kcs4-token-abi.json');

const results = [];
let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
async function expectFail(name, fn) {
  try { await fn(); check(name, false, 'did not fail'); } catch (e) { check(name, true, String(e.message || e).slice(0, 120)); }
}
const big = (v) => BigInt(v || 0);
const k = (v) => Number(big(v)) / 1e8;

async function main() {
  const lk = new LocalKoinos();
  await lk.startNode();
  await lk.startBlockProduction();
  await lk.deployKoinContract();
  await lk.mintKoinDefaultAccounts();
  const provider = new Provider([RPC]);
  const KOIN = lk.koin.address();
  const accounts = lk.getAccounts().filter(a => a.name.startsWith('Account #'));
  const signer = (a) => { const s = Signer.fromWif(a.wif); s.provider = provider; return s; };
  const owner = signer(accounts[0]), lp2 = signer(accounts[1]), trader = signer(accounts[2]), stranger = signer(accounts[3]);

  const token = (id, s) => new Contract({ id, abi: TOKEN_ABI, provider, signer: s });
  const balance = async (id, who) => big((await token(id, owner).functions.balance_of({ owner: who })).result?.value);
  const send = async (s, ops) => {
    const tx = new Transaction({ signer: s, provider, options: { rcLimit: '1000000000' } });
    for (const [fn, args] of ops) await tx.pushOperation(fn, args);
    const receipt = await tx.send();
    await tx.wait();
    return receipt;
  };

  // fresh contract keys, funded with tKOIN for mana
  const keys = {};
  for (const n of ['pool', 'tETH', 'tUSDT', 'tUSDC']) { keys[n] = Signer.fromSeed('koin-chart-it-' + n + '-' + Date.now()); keys[n].provider = provider; }
  await send(owner, Object.values(keys).map(s => [token(KOIN, owner).functions.transfer, { from: owner.address, to: s.address, value: (200n * E8).toString() }]));
  check('contract keys funded with tKOIN', (await balance(KOIN, keys.pool.address)) === 200n * E8);

  // test tokens
  const tok = {};
  for (const n of ['tETH', 'tUSDT', 'tUSDC']) {
    const c = new Contract({ id: keys[n].address, abi: TOKEN_ABI, provider, signer: keys[n], bytecode: fs.readFileSync(TOKEN_WASM) });
    const { transaction } = await c.deploy({ abi: JSON.stringify(TOKEN_ABI), authorizesCallContract: false, authorizesTransactionApplication: false, authorizesUploadContract: false });
    await transaction.wait();
    tok[n] = keys[n].address;
    const mints = [owner, lp2, trader].map(s => [c.functions.mint, { to: s.address, value: (1000000n * E8).toString() }]);
    await send(keys[n], mints);
  }
  check('test tokens deployed and minted', (await balance(tok.tUSDT, trader.address)) === 1000000n * E8);

  // pool contract
  const poolDeploy = new Contract({ id: keys.pool.address, abi: POOL_ABI, provider, signer: keys.pool, bytecode: fs.readFileSync(POOL_WASM) });
  const dep = await poolDeploy.deploy({ abi: JSON.stringify(POOL_ABI), authorizesCallContract: false, authorizesTransactionApplication: false, authorizesUploadContract: false });
  await dep.transaction.wait();
  const POOL = keys.pool.address;
  const pool = (s) => new Contract({ id: POOL, abi: POOL_ABI, provider, signer: s });
  await expectFail('initialize without the contract key fails', () => send(stranger, [[pool(stranger).functions.initialize, { owner: stranger.address }]]));
  await send(keys.pool, [[pool(keys.pool).functions.initialize, { owner: owner.address }]]);
  check('initialized with owner', (await pool(owner).functions.get_owner()).result?.value === owner.address);
  await expectFail('second initialize fails', () => send(keys.pool, [[pool(keys.pool).functions.initialize, { owner: stranger.address }]]));

  // the 5 planned pools
  const plan = [
    { a: KOIN, b: tok.tETH, fee: 300, amtA: 150n * E8, amtB: 95000n },          // 150 KOIN ~ 0.00095 tETH
    { a: KOIN, b: tok.tUSDT, fee: 300, amtA: 150n * E8, amtB: 285000000n },     // 150 KOIN ~ 2.85 tUSDT
    { a: KOIN, b: tok.tUSDC, fee: 300, amtA: 150n * E8, amtB: 285000000n },
    { a: tok.tETH, b: tok.tUSDT, fee: 100, amtA: 3333333n, amtB: 100n * E8 },    // ~$100 each side
    { a: tok.tETH, b: tok.tUSDC, fee: 100, amtA: 3333333n, amtB: 100n * E8 },
  ];
  await expectFail('stranger cannot create a pool', () => send(stranger, [[pool(stranger).functions.create_pool, { token_a: KOIN, token_b: tok.tETH, fee_bps: 100 }]]));
  await expectFail('fee above 3% is refused', () => send(owner, [[pool(owner).functions.create_pool, { token_a: KOIN, token_b: tok.tETH, fee_bps: 301 }]]));
  for (const p of plan) await send(owner, [[pool(owner).functions.create_pool, { token_a: p.a, token_b: p.b, fee_bps: p.fee }]]);
  check('5 pools created', true);
  await expectFail('duplicate pool (reversed order) is refused', () => send(owner, [[pool(owner).functions.create_pool, { token_a: tok.tETH, token_b: KOIN, fee_bps: 300 }]]));

  // seed liquidity: approve both tokens to the pool and add in one transaction
  const addLiq = (s, p, amtA, amtB) => send(s, [
    [token(p.a, s).functions.approve, { owner: s.address, spender: POOL, value: amtA.toString() }],
    [token(p.b, s).functions.approve, { owner: s.address, spender: POOL, value: amtB.toString() }],
    [pool(s).functions.add_liquidity, { from: s.address, token_a: p.a, token_b: p.b, amount_a: amtA.toString(), amount_b: amtB.toString(), min_shares: '1' }],
  ]);
  for (const p of plan) await addLiq(owner, p, p.amtA, p.amtB);
  const getPool = async (a, b) => (await pool(owner).functions.get_pool({ token_a: a, token_b: b })).result;
  let p1 = await getPool(KOIN, tok.tUSDT);
  check('KOIN/tUSDT seeded', p1 && p1.exists && big(p1.reserve_a) + big(p1.reserve_b) === 150n * E8 + 285000000n, p1);
  check('pool holds the tokens', (await balance(KOIN, POOL)) === 450n * E8);

  // Info only: on Koinos a token may accept a transfer the owner signed even without an allowance.
  try {
    await send(trader, [[pool(trader).functions.swap, { from: trader.address, token_in: KOIN, token_out: tok.tUSDT, amount_in: '1000', min_out: '1' }]]);
    results.push({ name: 'info: KOIN accepted a signed swap without approve', ok: true });
  } catch (e) { results.push({ name: 'info: KOIN needs approve before a swap', ok: true }); }
  p1 = await getPool(KOIN, tok.tUSDT);

  // trade KOIN -> tUSDT at 3%
  const amountIn = 10n * E8;
  const quote = big((await pool(trader).functions.get_quote({ token_in: KOIN, token_out: tok.tUSDT, amount_in: amountIn.toString() })).result?.value);
  const usdtBefore = await balance(tok.tUSDT, trader.address);
  await expectFail('swap with min_out above the quote fails', () => send(trader, [
    [token(KOIN, trader).functions.approve, { owner: trader.address, spender: POOL, value: amountIn.toString() }],
    [pool(trader).functions.swap, { from: trader.address, token_in: KOIN, token_out: tok.tUSDT, amount_in: amountIn.toString(), min_out: (quote + 1n).toString() }],
  ]));
  await send(trader, [
    [token(KOIN, trader).functions.approve, { owner: trader.address, spender: POOL, value: amountIn.toString() }],
    [pool(trader).functions.swap, { from: trader.address, token_in: KOIN, token_out: tok.tUSDT, amount_in: amountIn.toString(), min_out: quote.toString() }],
  ]);
  const got = (await balance(tok.tUSDT, trader.address)) - usdtBefore;
  check('trader received exactly the quote', got === quote, { quote: quote.toString(), got: got.toString() });
  const p2 = await getPool(KOIN, tok.tUSDT);
  const fee = (amountIn * 300n + 9999n) / 10000n, ownerFee = fee / 10n;
  const ownerFees = big(p2.owner_fees_a) + big(p2.owner_fees_b) - big(p1.owner_fees_a) - big(p1.owner_fees_b);
  const totalOwnerFees = big(p2.owner_fees_a) + big(p2.owner_fees_b);
  check('owner share = 10% of the 3% fee', ownerFees === ownerFee, { ownerFee: k(ownerFee), recorded: k(ownerFees) });
  const kBefore = big(p1.reserve_a) * big(p1.reserve_b), kAfter = big(p2.reserve_a) * big(p2.reserve_b);
  check('constant product grew (LP fee stayed in the pool)', kAfter > kBefore);

  // trade tUSDT -> tETH at 1% and back
  const t2 = 5n * E8;
  const q2 = big((await pool(trader).functions.get_quote({ token_in: tok.tUSDT, token_out: tok.tETH, amount_in: t2.toString() })).result?.value);
  await send(trader, [
    [token(tok.tUSDT, trader).functions.approve, { owner: trader.address, spender: POOL, value: t2.toString() }],
    [pool(trader).functions.swap, { from: trader.address, token_in: tok.tUSDT, token_out: tok.tETH, amount_in: t2.toString(), min_out: q2.toString() }],
  ]);
  check('1% tUSDT -> tETH swap filled', q2 > 0n, { tETH: k(q2) });

  // a second LP joins, then leaves with a fair share
  const pE = plan[3];
  await addLiq(lp2, pE, 3333333n, 200n * E8); // offers extra tUSDT; only the matching ratio is taken
  const s2 = big((await pool(lp2).functions.get_shares({ token_a: pE.a, token_b: pE.b, account: lp2.address })).result?.value);
  check('second LP got shares', s2 > 0n, { shares: s2.toString() });
  const ethBefore = await balance(tok.tETH, lp2.address);
  await send(lp2, [[pool(lp2).functions.remove_liquidity, { from: lp2.address, token_a: pE.a, token_b: pE.b, shares: s2.toString(), min_a: '0', min_b: '0' }]]);
  const ethBack = (await balance(tok.tETH, lp2.address)) - ethBefore;
  check('second LP got tETH back (about what they put in)', ethBack > 3300000n && ethBack <= 3340000n, { tETH: k(ethBack) });
  await expectFail('stranger cannot remove shares they do not own', () => send(stranger, [[pool(stranger).functions.remove_liquidity, { from: stranger.address, token_a: pE.a, token_b: pE.b, shares: '1', min_a: '0', min_b: '0' }]]));
  await expectFail('nobody can spend someone else\'s tokens through the pool', () => send(stranger, [[pool(stranger).functions.swap, { from: trader.address, token_in: KOIN, token_out: tok.tUSDT, amount_in: '100', min_out: '0' }]]));

  // owner claims fees
  await expectFail('stranger cannot claim owner fees', () => send(stranger, [[pool(stranger).functions.claim_owner_fees, { token_a: KOIN, token_b: tok.tUSDT, to: stranger.address }]]));
  const koinBefore = await balance(KOIN, owner.address);
  await send(owner, [[pool(owner).functions.claim_owner_fees, { token_a: KOIN, token_b: tok.tUSDT, to: owner.address }]]);
  const claimed = (await balance(KOIN, owner.address)) - koinBefore;
  check('owner claimed all KOIN fees', claimed === totalOwnerFees, { claimed: k(claimed) });

  // accounting: pool's KOIN balance = sum of KOIN reserves + unclaimed owner fees
  let koinReserves = 0n;
  for (const p of plan.filter(p => p.a === KOIN)) {
    const s = await getPool(p.a, p.b);
    const koinIsA = s.token_a === KOIN;
    koinReserves += big(koinIsA ? s.reserve_a : s.reserve_b) + big(koinIsA ? s.owner_fees_a : s.owner_fees_b);
  }
  check('pool KOIN balance matches its books', (await balance(KOIN, POOL)) === koinReserves, { onChain: k(await balance(KOIN, POOL)), books: k(koinReserves) });

  lk.stopNode();
  const report = { when: new Date().toISOString(), pool: POOL, tokens: tok, koin: KOIN, passed: results.length - failures, failed: failures, results };
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Local-chain test: ${report.passed} passed, ${failures} failed\n\n` + results.map(r => `- ${r.ok ? '✅' : '❌'} ${r.name}`).join('\n') + '\n');
  console.log(`\n${report.passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); try { new LocalKoinos().stopNode(); } catch (_) {} process.exit(1); });

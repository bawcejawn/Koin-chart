// Bot Guard attack test, on the local chain left running by run.js/page.js (KEEP_NODE=1).
// A malicious token tries to rob the account that trades it, three ways, from inside the victim's own
// signed transaction. First without the guard (to show the risk is real on Koinos), then with the guard
// built exactly the way the bot builds its transactions (bot/src/chain.js).
const fs = require('fs');
const path = require('path');
const { Provider, Signer, Contract, Transaction } = require('koilib');
const { LocalKoinos } = require('@roamin/local-koinos');
const { makeChain } = require('../bot/src/chain');

const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'deploy.json'), 'utf8'));
const provider = new Provider([D.rpc]);
const TOKEN_ABI = require('./fixtures/kcs4-token-abi.json');
const POOL_ABI = require('../contracts/pool/build/pool-abi.json');
const EVIL_ABI = require('./fixtures/evil-token-abi.json');
const GUARD_ABI = require('./fixtures/bot-guard-abi.json');
const E8 = 100000000n;
const results = []; let failures = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  guard: ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); };
const info = (name, detail) => { results.push({ name: 'info: ' + name, ok: true, detail }); console.log(`INFO  guard: ${name}  ${JSON.stringify(detail)}`); };
const big = v => BigInt(v || 0);
const signerOf = w => { const s = Signer.fromWif(w); s.provider = provider; return s; };
let tokenC = (id, s) => new Contract({ id, abi: TOKEN_ABI, provider, signer: s });
const bal = async (id, who) => big((await tokenC(id).functions.balance_of({ owner: who })).result?.value);
async function send(s, ops) {
  const tx = new Transaction({ signer: s, provider, options: { rcLimit: '1000000000' } });
  for (const op of ops) { if (Array.isArray(op)) await tx.pushOperation(op[0], op[1]); else tx.transaction.operations.push(op); }
  const r = await tx.send(); await tx.wait('byBlock', 60000); return r;
}
async function fresh(label) { const s = Signer.fromSeed('guard-it-' + label + '-' + Date.now()); s.provider = provider; return s; }

async function main() {
  const lk = new LocalKoinos();
  await lk.startBlockProduction();
  const owner = signerOf(D.owner);
  const KOIN = D.koin, POOL = D.pool;
  const pool = s => new Contract({ id: POOL, abi: POOL_ABI, provider, signer: s });

  // actors
  const thief = await fresh('thief');
  const evilKey = await fresh('evil');
  await send(owner, [[tokenC(KOIN, owner).functions.transfer, { from: owner.address, to: evilKey.address, value: (100n * E8).toString() }]]);
  const evilC = new Contract({ id: evilKey.address, abi: EVIL_ABI, provider, signer: evilKey, bytecode: fs.readFileSync(path.join(__dirname, 'fixtures', 'evil-token.wasm')) });
  await (await evilC.deploy({ abi: JSON.stringify(EVIL_ABI) })).transaction.wait('byBlock', 60000);
  const EVIL = evilKey.address;
  await send(evilKey, [[evilC.functions.mint, { to: owner.address, value: (1000000n * E8).toString() }]]);
  // a normal, well-behaved token to trade with (same code with no target set). The KCS-4 fixture used
  // elsewhere needs a newer system call than this local chain has, so the guard test uses this one.
  const goodKey = await fresh('good');
  await send(owner, [[tokenC(KOIN, owner).functions.transfer, { from: owner.address, to: goodKey.address, value: (100n * E8).toString() }]]);
  const goodC = new Contract({ id: goodKey.address, abi: EVIL_ABI, provider, signer: goodKey, bytecode: fs.readFileSync(path.join(__dirname, 'fixtures', 'evil-token.wasm')) });
  await (await goodC.deploy({ abi: JSON.stringify(EVIL_ABI) })).transaction.wait('byBlock', 60000);
  const USDT = goodKey.address; // "tGOOD"
  await send(goodKey, [[goodC.functions.mint, { to: owner.address, value: (1000000n * E8).toString() }]]);
  tokenC = (id, s) => new Contract({ id, abi: id === USDT || id === EVIL ? EVIL_ABI : TOKEN_ABI, provider, signer: s });
  // owner opens a 1% tUSDT/EVIL pool with liquidity (like a scam token someone lists)
  await send(owner, [[pool(owner).functions.create_pool, { token_a: USDT, token_b: EVIL, fee_bps: 100 }]]);
  await send(owner, [
    [tokenC(USDT, owner).functions.approve, { owner: owner.address, spender: POOL, value: (100n * E8).toString() }],
    [tokenC(EVIL, owner).functions.approve, { owner: owner.address, spender: POOL, value: (100000n * E8).toString() }],
    [pool(owner).functions.add_liquidity, { from: owner.address, token_a: USDT, token_b: EVIL, amount_a: (100n * E8).toString(), amount_b: (100000n * E8).toString(), min_shares: '1' }],
  ]);
  check('scam pool tUSDT/EVIL opened', true);
  const swapEntry = POOL_ABI.methods.swap.entry_point;

  async function victimRound(victim, useGuard) {
    // fund the victim: KOIN for mana, tUSDT to trade
    await send(owner, [
      [tokenC(KOIN, owner).functions.transfer, { from: owner.address, to: victim.address, value: (5000n * E8).toString() }],
      [tokenC(USDT, owner).functions.transfer, { from: owner.address, to: victim.address, value: (50n * E8).toString() }],
    ]);
    await send(evilKey, [[evilC.functions.set_target, { victim: victim.address, thief: thief.address, koin: KOIN, other: USDT, pool: POOL, pool_token: USDT }],
      [evilC.functions.set_pool_swap_entry, { value: String(swapEntry) }]]);
    const before = { koin: await bal(KOIN, victim.address), usdt: await bal(USDT, victim.address), tk: await bal(KOIN, thief.address), tu: await bal(USDT, thief.address) };
    const tried0 = (await evilC.functions.get_attempts()).result || {};
    const amount = 10n * E8;
    const q = big((await pool(victim).functions.get_quote({ token_in: USDT, token_out: EVIL, amount_in: amount.toString() })).result?.value);
    let ops;
    if (useGuard) {
      // exactly what the bot does with the guard on: allowance instead of approve, then the swap
      const chain = makeChain([D.rpc]);
      ops = [await chain.guardAllowanceOp(victim.address, USDT, POOL, POOL, amount), await chain.ownSwapOp(POOL, victim.address, USDT, EVIL, amount, q * 99n / 100n)];
    } else {
      ops = [[tokenC(USDT, victim).functions.approve, { owner: victim.address, spender: POOL, value: amount.toString() }],
        [pool(victim).functions.swap, { from: victim.address, token_in: USDT, token_out: EVIL, amount_in: amount.toString(), min_out: (q * 99n / 100n).toString() }]];
    }
    let err = null;
    try { await send(victim, ops); } catch (e) { err = String(e.message || e).slice(0, 200); }
    const att = (await evilC.functions.get_attempts()).result || {};
    const after = { koin: await bal(KOIN, victim.address), usdt: await bal(USDT, victim.address), tk: await bal(KOIN, thief.address), tu: await bal(USDT, thief.address) };
    return { err, tried: big(att.tried) - big(tried0.tried), stolenOk: big(att.succeeded) - big(tried0.succeeded), lostKoin: before.koin - after.koin, thiefKoin: after.tk - before.tk, thiefUsdt: after.tu - before.tu, usdtSpent: before.usdt - after.usdt, gotEvil: await bal(EVIL, victim.address) };
  }

  // ---- A: plain account, no guard ----
  const plain = await fresh('plain');
  const a = await victimRound(plain, false);
  info('without the guard', { tried: String(a.tried), succeeded: String(a.stolenOk), thiefGotKoin: Number(a.thiefKoin) / 1e8, thiefGotUsdt: Number(a.thiefUsdt) / 1e8, err: a.err });

  // ---- B: account with the Bot Guard ----
  const bot = await fresh('bot');
  await send(owner, [[tokenC(KOIN, owner).functions.transfer, { from: owner.address, to: bot.address, value: (200n * E8).toString() }]]);
  const guard = new Contract({ id: bot.address, abi: GUARD_ABI, provider, signer: bot, bytecode: fs.readFileSync(path.join(__dirname, 'fixtures', 'bot-guard.wasm')) });
  await (await guard.deploy({ abi: JSON.stringify(GUARD_ABI), authorizesCallContract: true, authorizesTransactionApplication: true, authorizesUploadContract: true })).transaction.wait('byBlock', 60000);
  check('guard installed on the bot address', true);
  const b = await victimRound(bot, true);
  check('with the guard, the trade itself still works', !b.err && b.gotEvil > 0n, { err: b.err, gotEvil: Number(b.gotEvil) / 1e8 });
  check('with the guard, the scam token tried to steal', b.tried > 0n, { tried: String(b.tried) });
  check('with the guard, every theft attempt failed', b.stolenOk === 0n, { succeeded: String(b.stolenOk) });
  check('with the guard, the thief got nothing', b.thiefKoin === 0n && b.thiefUsdt === 0n);
  check('with the guard, the bot lost no KOIN', b.lostKoin === 0n, { lost: Number(b.lostKoin) / 1e8 });
  check('with the guard, only the approved 10 tUSDT left the bot', b.usdtSpent === 10n * E8, { spent: Number(b.usdtSpent) / 1e8 });

  // the bot's own plain transfers (like sending VHP to the producer) still work
  const k0 = await bal(KOIN, thief.address);
  await send(bot, [[tokenC(KOIN, bot).functions.transfer, { from: bot.address, to: thief.address, value: E8.toString() }]]);
  check('the bot can still send its own transfer (e.g. VHP to the producer)', (await bal(KOIN, thief.address)) - k0 === E8);
  // nobody else can move the bot's tokens
  let blocked = false;
  try { await send(thief, [[tokenC(KOIN, thief).functions.transfer, { from: bot.address, to: thief.address, value: E8.toString() }]]); } catch (e) { blocked = true; }
  check('someone else signing cannot move the bot\'s KOIN', blocked);
  // an allowance from one transaction cannot be reused in another
  let reuse = false;
  try { await send(thief, [[pool(thief).functions.swap, { from: bot.address, token_in: USDT, token_out: EVIL, amount_in: E8.toString(), min_out: '0', receiver: thief.address }]]); reuse = true; } catch (e) {}
  check('nobody can make the pool trade the bot\'s tokens', !reuse);
}

main().catch(e => check('guard flow finished', false, String(e.message || e).slice(0, 300))).finally(() => {
  fs.writeFileSync(path.join(__dirname, 'guard-report.json'), JSON.stringify({ passed: results.length - failures, failed: failures, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Bot Guard attack test: ${results.length - failures} passed, ${failures} failed\n\n` + results.map(r => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.name.startsWith('info') ? ' ' + JSON.stringify(r.detail) : ''}`).join('\n') + '\n');
  console.log(`\nguard: ${results.length - failures} passed, ${failures} failed`);
  try { new LocalKoinos().stopNode(); } catch (e) {}
  process.exit(failures ? 1 : 0);
});

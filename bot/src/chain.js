// Koinos chain access for the bot: reads, transaction building, signing.
// Reuses the page's ABIs and loop math so the bot and the page always agree.
const path = require('path');
globalThis.window = globalThis;
require(path.join(__dirname, '../../js/abi.js'));
require(path.join(__dirname, '../../js/loopcore.js'));
const { Provider, Contract, Signer, Transaction, utils } = require('koilib');

const ADDR = {
  PERIPHERY: '17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s',
  KOIN: '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK',
  VHP: '12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq',
  VHP_PAIR: '1NqLghiFRwkXZR7NBFHHiCJkF5gLHyJap1',
};
const contractAddr = id => (id === 'koin' ? ADDR.KOIN : id === 'vhp' ? ADDR.VHP : id);
const tokenName = addr => (addr === ADDR.KOIN ? 'koin' : addr === ADDR.VHP ? 'vhp' : addr);
const GUARD_ABI = require(path.join(__dirname, '../guard/bot-guard-abi.json'));
const POOL_ABI = require(path.join(__dirname, '../../contracts/pool/build/pool-abi.json'));
// our own pools are addressed as "own:<poolContract>:<tokenA>:<tokenB>" (tokens as contract addresses)
const isOwn = id => typeof id === 'string' && id.startsWith('own:');
const ownParts = id => { const [, c, a, b] = id.split(':'); return { c, a, b }; };

// token.transfer_args {from=1, to=2, value=3} as raw protobuf bytes
function encodeTransfer(from, to, value) {
  const out = [];
  const varint = v => { v = BigInt(v); while (v >= 0x80n) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; } out.push(Number(v)); };
  const bytes = (f, b) => { out.push((f << 3) | 2); varint(b.length); out.push(...b); };
  bytes(1, utils.decodeBase58(from)); if (to) bytes(2, utils.decodeBase58(to));
  out.push((3 << 3) | 0); varint(value);
  return new Uint8Array(out);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Errors that mean "this node had a bad moment", not "the chain said no"
const TRANSPORT = /invalid json|unexpected token|fetch failed|failed to fetch|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network|timeout|<html|\b5\d\d\b|429|too many/i;

// Node failover: koilib moves to the next node on an error; we retry with backoff instead of giving up,
// so a public node's hiccup (rate limit page, 502) just rolls over to the next node.
function resilient(provider, tries = 4) {
  const raw = provider.call.bind(provider);
  provider.onError = () => true; // let us decide
  provider.call = async (method, params) => {
    let last;
    for (let i = 0; i < Math.max(tries, provider.rpcNodes.length + 1); i++) {
      try { return await raw(method, params); } catch (e) {
        last = e;
        if (!TRANSPORT.test(String(e && e.message || e))) throw e; // a real chain error: don't retry
        await sleep(Math.min(8000, 300 * 3 ** i));
      }
    }
    throw last;
  };
  return provider;
}

function makeChain(rpcUrls, verifyUrls = []) {
  const provider = resilient(new Provider(rpcUrls));
  const verifiers = verifyUrls.map(u => resilient(new Provider([u]), 2));
  const poolC = (c, prov = provider) => new Contract({ id: c, abi: POOL_ABI, provider: prov });
  const periphery = new Contract({ id: ADDR.PERIPHERY, abi: globalThis.PERIPHERY_ABI, provider });
  const tokenC = id => new Contract({ id: contractAddr(id), abi: globalThis.TOKEN_ABI, provider });

  // tiny protobuf varint reader for raw contract reads
  function pb(buf) {
    const o = {}; let i = 0;
    const vr = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 127) << s; s += 7n; } while (b & 128); return r; };
    while (i < buf.length) {
      const k = Number(vr()), f = k >> 3, t = k & 7;
      if (t === 0) o[f] = vr(); else if (t === 2) { const l = Number(vr()); o[f] = buf.slice(i, i + l); i += l; } else break;
    }
    return o;
  }
  const read = async (contract_id, entry_point, prov = provider) => {
    const r = await prov.call('chain.read_contract', { contract_id, entry_point, args: '' });
    return pb(Buffer.from((r && r.result) || '', 'base64url'));
  };
  // reserves of a KoinDX pair or one of our pools, as { a: token0/token_a reserve, b: token1/token_b reserve }
  async function reservesVia(prov, pair) {
    if (isOwn(pair)) {
      const { c, a, b } = ownParts(pair);
      const { result } = await poolC(c, prov).functions.get_pool({ token_a: a, token_b: b });
      if (!result || !result.exists) return { a: 0n, b: 0n, feeBps: 0, tokenA: null };
      return { a: BigInt(result.reserve_a || 0), b: BigInt(result.reserve_b || 0), feeBps: result.fee_bps, tokenA: result.token_a };
    }
    const d = await read(pair, 0x6d0c5abf, prov);
    return { a: BigInt(d[2] || 0n), b: BigInt(d[3] || 0n) };
  }

  const api = {
    provider, utils, ADDR,
    async head() {
      let h = await provider.getHeadInfo();
      // a node that stopped syncing still answers; if its head is old, move to the next node
      for (let i = 1; i < provider.rpcNodes.length && Date.now() - Number(h.head_block_time) > 90e3; i++) {
        provider.currentNodeId = (provider.currentNodeId + 1) % provider.rpcNodes.length;
        h = await provider.getHeadInfo();
      }
      return { height: Number(h.head_topology.height), id: h.head_topology.id, time: Number(h.head_block_time), node: provider.rpcNodes[provider.currentNodeId] };
    },
    get node() { return provider.rpcNodes[provider.currentNodeId]; },
    // token0 / token1 raw reserves (BigInt)
    async reserves(pair) { return reservesVia(provider, pair); },
    async token0(pair) {
      if (isOwn(pair)) return (await reservesVia(provider, pair)).tokenA;
      const d = await read(pair, 0x7d5b5ed7); return utils.encodeBase58(new Uint8Array(d[1]));
    },
    // Cross-check pools against every verify node (e.g. your other local nodes).
    // ok only if every node that answers reports exactly the same reserves, and at least `need` nodes answered in total.
    async verify(pairs, expected, need = 1) {
      if (!verifiers.length) return { ok: true, sources: 1, note: 'no verify nodes configured' };
      let answered = 1; const bad = [];
      for (const v of verifiers) {
        try {
          for (let i = 0; i < pairs.length; i++) {
            const r = await reservesVia(v, pairs[i]);
            if (r.a !== expected[i].a || r.b !== expected[i].b) bad.push({ pair: pairs[i], node: v.rpcNodes ? v.rpcNodes[0] : '?' });
          }
          answered++;
        } catch (e) { /* node down: does not count either way */ }
      }
      return { ok: bad.length === 0 && answered >= need, sources: answered, bad };
    },
    // our pools: list the configured pairs with their live state
    async ownPools(contract, pairs) {
      const out = [];
      for (const [a, b] of pairs) {
        const id = `own:${contract}:${contractAddr(a)}:${contractAddr(b)}`;
        const r = await reservesVia(provider, id);
        if (!r.tokenA || r.a === 0n || r.b === 0n) continue;
        const tA = tokenName(r.tokenA), tB = tokenName(r.tokenA === contractAddr(a) ? contractAddr(b) : contractAddr(a));
        out.push({ id, venue: 'own', feeBps: r.feeBps, t0: tA, t1: tB, d0: 8, d1: 8, r0: Number(r.a) / 1e8, r1: Number(r.b) / 1e8, usd: 1e9 });
      }
      return out;
    },
    // owner fees waiting in each of our pools
    async ownFees(contract, pairs) {
      const out = [];
      for (const [a, b] of pairs) {
        const { result: r } = await poolC(contract).functions.get_pool({ token_a: contractAddr(a), token_b: contractAddr(b) });
        if (!r || !r.exists) continue;
        out.push({ tokenA: r.token_a, tokenB: r.token_b, feesA: BigInt(r.owner_fees_a || 0), feesB: BigInt(r.owner_fees_b || 0),
          reserveA: BigInt(r.reserve_a || 0), reserveB: BigInt(r.reserve_b || 0), totalShares: BigInt(r.total_shares || 0) });
      }
      return out;
    },
    async claimOp(contract, tokenA, tokenB, to) {
      const { operation } = await poolC(contract).functions.claim_owner_fees({ token_a: tokenA, token_b: tokenB, to }, { onlyOperation: true });
      return operation;
    },
    async addLiquidityOp(contract, from, tokenA, tokenB, amountA, amountB, minShares) {
      const { operation } = await poolC(contract).functions.add_liquidity({ from, token_a: tokenA, token_b: tokenB, amount_a: amountA.toString(), amount_b: amountB.toString(), min_shares: minShares.toString() }, { onlyOperation: true });
      return operation;
    },
    async feeSettings(contract) { return (await poolC(contract).functions.get_fee_settings()).result || {}; },
    // ---- Bot Guard (koinosbox SmartWalletAllowance on the bot's own address) ----
    // One allowance per token the bot lets a contract move in THIS transaction: exactly this token,
    // only via transfer, only when called by `caller` (KoinDX router or our pool), only to `to`, at most `value`.
    // Anything else asking to move the bot's tokens during the transaction is refused.
    async guardAllowanceOp(bot, token, caller, to, value) {
      const data = encodeTransfer(bot, to, value);
      const { operation } = await new Contract({ id: bot, abi: GUARD_ABI, provider }).functions.set_allowance({
        type: 'transfer_token', contract_id: contractAddr(token), entry_point: 0x27f576ca, caller, data: utils.encodeBase64url(data),
      }, { onlyOperation: true });
      return operation;
    },
    // does the bot's address carry the guard?
    async guardActive(bot) {
      try { const r = await provider.invokeGetContractMetadata(bot); return !!(r && r.value && r.value.authorizes_call_contract && r.value.hash); } catch (e) { return false; }
    },
    async ownSwapOp(contract, from, tokenIn, tokenOut, amountIn, minOut) {
      const { operation } = await poolC(contract).functions.swap({
        from, token_in: contractAddr(tokenIn), token_out: contractAddr(tokenOut), amount_in: amountIn.toString(), min_out: minOut.toString(),
      }, { onlyOperation: true });
      return operation;
    },
    async balance(token, owner) {
      const { result } = await tokenC(token).functions.balanceOf({ owner });
      return BigInt((result && result.value) || 0);
    },
    async mana(owner) { return BigInt(await provider.getAccountRc(owner)); },
    async allowance(token, owner, spender) {
      const { result } = await tokenC(token).functions.allowance({ owner, spender: spender || ADDR.PERIPHERY });
      return BigInt((result && result.value) || 0);
    },
    async approveOp(token, owner, value, spender) {
      const { operation } = await tokenC(token).functions.approve({ owner, spender: spender || ADDR.PERIPHERY, value: value.toString() }, { onlyOperation: true });
      return operation;
    },
    async swapOp(owner, amountIn, amountOutMin, pathIds) {
      const { operation } = await periphery.functions.swap_tokens_in({
        from: owner, receiver: owner, amountIn: amountIn.toString(), amountOutMin: amountOutMin.toString(), path: pathIds,
      }, { onlyOperation: true });
      return operation;
    },
    async transferOp(token, from, to, value) {
      const { operation } = await tokenC(token).functions.transfer({ from, to, value: value.toString() }, { onlyOperation: true });
      return operation;
    },
    // Sign and send ops as one transaction, then wait for the block.
    async send(signer, ops, maxManaRaw = 500000000n) {
      const owner = signer.getAddress();
      const rc = await api.mana(owner);
      const rcLimit = (rc < maxManaRaw ? rc : maxManaRaw).toString();
      const tx = await Transaction.prepareTransaction({ header: { rc_limit: rcLimit, payer: owner }, operations: ops.filter(Boolean) }, provider, owner);
      const signed = await signer.signTransaction(tx);
      const { receipt } = await provider.sendTransaction(signed, true);
      if (receipt && receipt.reverted) throw new Error('transaction reverted (min-return not met); nothing traded');
      try { await provider.wait(signed.id, 'byBlock', 60000); } catch (e) { /* landed but not yet confirmed */ }
      return { id: signed.id, receipt };
    },
  };
  return api;
}

function loadSigner(wif) {
  if (!wif) throw new Error('No bot key. Run "npm run keygen" and put the key in bot.key (see README).');
  return Signer.fromWif(wif.trim());
}

module.exports = { encodeTransfer, GUARD_ABI, resilient, TRANSPORT, makeChain, loadSigner, ADDR, LoopCore: globalThis.LoopCore, isOwn, ownParts, contractAddr };

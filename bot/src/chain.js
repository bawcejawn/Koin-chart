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

function makeChain(rpcUrls) {
  const provider = new Provider(rpcUrls);
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
  const read = async (contract_id, entry_point) => {
    const r = await provider.call('chain.read_contract', { contract_id, entry_point, args: '' });
    return pb(Buffer.from((r && r.result) || '', 'base64url'));
  };

  const api = {
    provider, utils, ADDR,
    async head() { const h = await provider.getHeadInfo(); return { height: Number(h.head_topology.height), id: h.head_topology.id }; },
    // token0 / token1 raw reserves (BigInt)
    async reserves(pair) { const d = await read(pair, 0x6d0c5abf); return { a: BigInt(d[2] || 0n), b: BigInt(d[3] || 0n) }; },
    async token0(pair) { const d = await read(pair, 0x7d5b5ed7); return utils.encodeBase58(new Uint8Array(d[1])); },
    async balance(token, owner) {
      const { result } = await tokenC(token).functions.balanceOf({ owner });
      return BigInt((result && result.value) || 0);
    },
    async mana(owner) { return BigInt(await provider.getAccountRc(owner)); },
    async allowance(token, owner) {
      const { result } = await tokenC(token).functions.allowance({ owner, spender: ADDR.PERIPHERY });
      return BigInt((result && result.value) || 0);
    },
    async approveOp(token, owner, value) {
      const { operation } = await tokenC(token).functions.approve({ owner, spender: ADDR.PERIPHERY, value: value.toString() }, { onlyOperation: true });
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

module.exports = { makeChain, loadSigner, ADDR, LoopCore: globalThis.LoopCore };

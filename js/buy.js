// One-click "Buy VHP in the pool" — swaps KOIN -> VHP on KoinDX only when it beats burning 1:1.
(() => {
  const $ = id => document.getElementById(id);
  const K = () => window.KW;

  // Live quote straight from the pool contract (not the cached chart data)
  async function quote(amountKoin) {
    const { a: vhpR, b: koinR } = await K().reserves(K().VHP_PAIR);
    const amountIn = K().toRaw(amountKoin);
    const out = LoopCore.amountOut(amountIn, koinR, vhpR);
    return { amountIn, out, vhpR, koinR };
  }

  async function buy(amountKoin, label) {
    const k = K();
    if (!(amountKoin > 0)) throw new Error('Enter an amount of KOIN first.');
    if (!(await k.ensureConnected())) return;
    await k.refreshBalances();
    const spend = k.spendableKoin();
    if (amountKoin > spend + 1e-8) {
      throw new Error(`You can spend up to ${k.fmt(spend, 2)} KOIN right now (wallet has ${k.fmt(k.W.koin, 2)} KOIN; ${k.MANA_BUFFER} KOIN of mana is kept free for the transaction, and KOIN can only move while its mana is available). Lower the amount or add KOIN.`);
    }
    const q = await quote(amountKoin);
    if (q.out <= q.amountIn) throw new Error('Right now burning gives as much VHP or more than the pool. Nothing to buy.');
    const slip = BigInt(Math.round(k.S.slippage * 100));
    let minOut = q.out * (10000n - slip) / 10000n;
    if (minOut <= q.amountIn) minOut = q.amountIn + 1n; // never accept less than burning would give
    const exp = k.fromRaw(q.out), min = k.fromRaw(minOut), extra = exp - amountKoin;
    const ok = await k.review({
      title: 'Buy VHP in the KoinDX pool',
      intro: 'You swap KOIN for VHP in the VHP/KOIN pool instead of burning it. If the price moves so you would get less than the minimum below, the whole transaction cancels and nothing is traded.',
      rows: [
        ['You pay', `${k.fmt(amountKoin, 4)} KOIN`],
        ['You should get', `${k.fmt(exp, 4)} VHP`, 'up'],
        ['Extra vs burning', `+${k.fmt(extra, 4)} VHP (+${(extra / amountKoin * 100).toFixed(2)}%)`, 'up'],
        ['Minimum you accept', `${k.fmt(min, 4)} VHP`],
        ['Route', 'KOIN → VHP (KoinDX)'],
        ['Network cost', 'Some mana (recharges); no fee in KOIN'],
      ],
      confirm: 'Review and sign in Kondor',
    });
    if (!ok) return;
    const ops = [await k.approveOpIfNeeded('koin', q.amountIn), await k.swapOp(q.amountIn, minOut, ['koin', 'vhp'])];
    const res = await k.send(ops, { kind: 'buy', label: label || `Bought VHP with ${k.fmt(amountKoin, 2)} KOIN` });
    if (res && res.delta) {
      const got = res.delta.vhp, paid = -res.delta.koin;
      k.toast(`Done: +${k.fmt(got, 4)} VHP for ${k.fmt(paid, 4)} KOIN, ${k.fmt(got - paid, 4)} more VHP than burning.`, 'ok', 12000);
    }
  }

  const MIN_GAIN = 0.01; // VHP; below this the trade isn't worth a click
  // Extra VHP vs burning for swapping x KOIN, from the latest pool state
  function bestGain(x) {
    const rows = window.KC.rows, last = rows[rows.length - 1];
    if (!last || !(x > 0)) return 0;
    const out = last.a * 0.9975 * x / (last.b + 0.9975 * x);
    return out - x;
  }
  function bestAmount() {
    const rows = window.KC.rows, last = rows[rows.length - 1];
    if (!last) return 0;
    const V = last.a, Kr = last.b, F = 0.9975;
    return Math.max(0, (Math.sqrt(Kr * V * F) - Kr) / F);
  }

  function update() {
    const k = K(); if (!k) return;
    const best = bestAmount();
    const spend = k.W.address ? k.spendableKoin() : Infinity;
    const use = Math.min(best, spend);
    const b = $('buyBestBtn');
    if (bestGain(use) < MIN_GAIN) { b.disabled = true; b.textContent = 'No worthwhile edge right now'; }
    else {
      b.disabled = k.W.busy;
      b.textContent = !k.W.address ? `Connect & buy ${k.fmt(best, 0)} KOIN worth` : use < best - 0.01 ? `Buy with ${k.fmt(use, 2)} KOIN (your max)` : `Buy best amount: ${k.fmt(best, 2)} KOIN`;
    }
    const a = $('buyAmtBtn'), amt = parseFloat($('amt').value);
    const gainAmt = bestGain(amt);
    a.disabled = k.W.busy || !(amt > 0) || gainAmt <= 0;
    a.textContent = !(amt > 0) ? 'Enter an amount' : gainAmt <= 0 ? 'Burning gives more for this amount' : k.W.address ? 'Buy VHP with this amount' : 'Connect & buy this amount';
    $('buyHint').textContent = k.W.address ? `You can spend ${k.fmt(k.spendableKoin(), 2)} KOIN now.` : 'Connect Kondor to buy in one click.';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const k = K();
    $('buyBestBtn').addEventListener('click', () => k.guarded(async () => {
      if (!(await k.ensureConnected())) return;
      await k.refreshBalances();
      const amt = Math.min(bestAmount(), k.spendableKoin());
      if (amt <= 0) throw new Error('No spendable KOIN in this wallet right now. Add KOIN (and let its mana charge) to buy.');
      await buy(Math.floor(amt * 1e8) / 1e8, 'Bought VHP (best amount)');
    }));
    $('buyAmtBtn').addEventListener('click', () => k.guarded(() => buy(parseFloat($('amt').value))));
    $('amt').addEventListener('input', update);
    k.listeners.push(update);
    window.KC.hooks.push(update);
    update();
  });
})();

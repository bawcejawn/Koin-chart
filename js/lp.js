// Liquidity: what the VHP/KOIN pool pays liquidity providers, your position, and one-click add/remove.
(() => {
  const $ = id => document.getElementById(id);
  const K = () => window.KW;
  const P = { a: 0, b: 0, supply: 0, at: 0 }; // a = VHP, b = KOIN (whole tokens), supply = LP tokens
  let removePct = 50;

  async function load() {
    const k = K();
    try {
      const [r, s] = await Promise.all([k.reserves(k.VHP_PAIR), k.totalSupply(k.VHP_PAIR)]);
      Object.assign(P, { a: k.fromRaw(r.a), b: k.fromRaw(r.b), supply: k.fromRaw(s), at: Date.now() });
      snapshot();
      render();
    } catch (e) { console.error('lp load', e); }
  }

  // Value per LP token measured as sqrt(VHP*KOIN)/supply. It only grows from fees,
  // so its growth over time is what LPs actually earned (after KoinDX's protocol cut).
  const growthIndex = () => P.supply > 0 ? Math.sqrt(P.a * P.b) / P.supply : 0;
  function snaps() { try { return JSON.parse(localStorage.getItem('kc-lp-snaps') || '[]'); } catch (e) { return []; } }
  function snapshot() {
    const g = growthIndex(); if (!g) return;
    const list = snaps(), now = Date.now();
    if (!list.length || now - list[list.length - 1].t > 3600e3) {
      list.push({ t: now, g });
      try { localStorage.setItem('kc-lp-snaps', JSON.stringify(list.slice(-3000))); } catch (e) {}
    }
  }

  function vol24() {
    const rows = window.KC.rows, now = Date.now() / 1000;
    let v = 0;
    for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (r.t > now - 86400 && r.kind === 'Swap') v += Math.abs(r.b - rows[i - 1].b); }
    return v; // KOIN moved by swaps = trade size in KOIN terms
  }

  function render() {
    const k = K(); if (!k || !P.supply) return;
    const usd = window.KC.koinUsd || 0;
    const price = P.b / P.a; // KOIN per VHP
    const tvlK = P.a * price + P.b;
    const v = vol24(), fees = v * 0.0025;
    $('lpTvl').textContent = `${k.fmt(tvlK, 0)} KOIN` + (usd ? ` ($${k.fmt(tvlK * usd, 0)})` : '');
    $('lpVol').textContent = `${k.fmt(v, 0)} KOIN`;
    $('lpFees').textContent = `${k.fmt(fees, 1)} KOIN`;
    $('lpApr').textContent = tvlK ? `${(fees * 365 / tvlK * 100).toFixed(1)}%` : '—';
    const list = snaps();
    if (list.length > 1) {
      const first = list[0], g = growthIndex(), days = (Date.now() - first.t) / 864e5;
      const gr = (g / first.g - 1) * 100;
      $('lpMeasured').textContent = days >= 0.25 ? `${gr >= 0 ? '+' : ''}${gr.toFixed(3)}% in ${days < 2 ? (days * 24).toFixed(0) + ' h' : days.toFixed(1) + ' days'} (≈${(gr / days * 365).toFixed(1)}%/yr)` : 'Collecting…';
    } else $('lpMeasured').textContent = 'Collecting… (check back in a few hours)';

    // your position
    const on = !!k.W.address;
    $('lpMine').hidden = !on; $('lpConnectNote').hidden = on;
    if (on) {
      const share = P.supply ? k.W.lp / P.supply : 0;
      const myV = share * P.a, myK = share * P.b;
      $('lpShare').textContent = share ? `${(share * 100).toFixed(4)}%` : 'None yet';
      $('lpHold').textContent = share ? `${k.fmt(myV, 2)} VHP + ${k.fmt(myK, 2)} KOIN` : '—';
      $('lpEarn').textContent = share ? `≈ ${k.fmt(fees * share, 3)} KOIN/day` : '—';
      $('lpRemoveRow').hidden = !share;
      if (share) {
        const f = removePct / 100;
        $('lpRemoveOut').textContent = `${k.fmt(myV * f, 2)} VHP + ${k.fmt(myK * f, 2)} KOIN`;
      }
    }
    addPreview();
  }

  function addPreview() {
    const k = K();
    const x = parseFloat($('lpAddKoin').value);
    if (!(x > 0) || !P.b) { $('lpAddNeed').textContent = '—'; return; }
    const needV = x * P.a / P.b;
    $('lpAddNeed').textContent = `${k.fmt(needV, 4)} VHP`;
    $('lpAddNeed').className = k.W.address && needV > k.W.vhp ? 'down' : '';
  }

  async function add() {
    const k = K();
    if (!(await k.ensureConnected())) return;
    await Promise.all([k.refreshBalances(), load()]);
    const x = parseFloat($('lpAddKoin').value);
    if (!(x > 0)) throw new Error('Enter how much KOIN to add.');
    const r = await k.reserves(k.VHP_PAIR);
    const koinRaw = k.toRaw(x), vhpRaw = koinRaw * r.a / r.b + 1n;
    if (x > k.spendableKoin() + 1e-8) throw new Error(`You can add up to ${k.fmt(k.spendableKoin(), 2)} KOIN right now (mana limit).`);
    if (k.fromRaw(vhpRaw) > k.W.vhp + 1e-8) throw new Error(`This needs ${k.fmt(k.fromRaw(vhpRaw), 4)} VHP but the wallet has ${k.fmt(k.W.vhp, 4)}. Lower the KOIN amount.`);
    const slip = BigInt(Math.round(k.S.slippage * 100));
    const minK = koinRaw * (10000n - slip) / 10000n, minV = vhpRaw * (10000n - slip) / 10000n;
    const ok = await k.review({
      title: 'Add liquidity to VHP/KOIN',
      intro: 'You deposit both tokens and receive LP tokens. You earn a share of every swap fee while your liquidity is in the pool. If the VHP/KOIN price moves, the mix of tokens you can withdraw changes.',
      rows: [
        ['You deposit', `${k.fmt(x, 4)} KOIN + ${k.fmt(k.fromRaw(vhpRaw), 4)} VHP`],
        ['Minimum deposited', `${k.fmt(k.fromRaw(minK), 4)} KOIN + ${k.fmt(k.fromRaw(minV), 4)} VHP`],
        ['Your new pool share', `≈ ${((x / (P.b + x)) * 100 + (k.W.lp / P.supply) * 100 * (P.b / (P.b + x))).toFixed(4)}%`],
        ['Network cost', 'Some mana (recharges)'],
      ],
      confirm: 'Review and sign in Kondor',
    });
    if (!ok) return;
    const ops = [
      await k.approveOpIfNeeded('vhp', vhpRaw), await k.approveOpIfNeeded('koin', koinRaw),
      await k.peripheryOp('add_liquidity', { from: k.W.address, receiver: k.W.address, tokenA: 'vhp', tokenB: 'koin',
        amountADesired: vhpRaw.toString(), amountBDesired: koinRaw.toString(), amountAMin: minV.toString(), amountBMin: minK.toString() }),
    ];
    const res = await k.send(ops, { kind: 'lp-add', label: `Added liquidity (${k.fmt(x, 2)} KOIN + VHP)` });
    if (res) k.toast(`Liquidity added: +${k.fmt(res.delta.lp, 4)} LP tokens.`, 'ok', 10000);
    load();
  }

  async function remove() {
    const k = K();
    if (!(await k.ensureConnected())) return;
    await Promise.all([k.refreshBalances(), load()]);
    if (!(k.W.lp > 0)) throw new Error('This wallet has no liquidity in the VHP/KOIN pool.');
    const [r, sRaw] = await Promise.all([k.reserves(k.VHP_PAIR), k.totalSupply(k.VHP_PAIR)]);
    const lpRaw = k.toRaw(k.W.lp) * BigInt(removePct) / 100n;
    const expV = lpRaw * r.a / sRaw, expK = lpRaw * r.b / sRaw;
    const slip = BigInt(Math.round(k.S.slippage * 100));
    const minV = expV * (10000n - slip) / 10000n, minK = expK * (10000n - slip) / 10000n;
    const ok = await k.review({
      title: `Remove ${removePct}% of your liquidity`,
      intro: 'You return LP tokens to the pool and get your share of VHP and KOIN back, fees included.',
      rows: [
        ['LP tokens returned', k.fmt(k.fromRaw(lpRaw), 6)],
        ['You get back', `${k.fmt(k.fromRaw(expV), 4)} VHP + ${k.fmt(k.fromRaw(expK), 4)} KOIN`, 'up'],
        ['Minimum you accept', `${k.fmt(k.fromRaw(minV), 4)} VHP + ${k.fmt(k.fromRaw(minK), 4)} KOIN`],
        ['Network cost', 'Some mana (recharges)'],
      ],
      confirm: 'Review and sign in Kondor',
    });
    if (!ok) return;
    const ops = [
      await k.approveOpIfNeeded(k.VHP_PAIR, lpRaw),
      await k.peripheryOp('remove_liquidity', { from: k.W.address, receiver: k.W.address, tokenA: 'vhp', tokenB: 'koin',
        liquidity: lpRaw.toString(), amountAMin: minV.toString(), amountBMin: minK.toString() }),
    ];
    const res = await k.send(ops, { kind: 'lp-remove', label: `Removed ${removePct}% liquidity` });
    if (res) k.toast(`Liquidity removed: +${k.fmt(res.delta.vhp, 4)} VHP, +${k.fmt(res.delta.koin, 4)} KOIN.`, 'ok', 10000);
    load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const k = K();
    $('lpAddKoin').addEventListener('input', addPreview);
    $('lpAddMax').addEventListener('click', () => {
      if (!k.W.address || !P.b) { k.toast('Connect your wallet first.', 'info'); return; }
      const max = Math.min(k.spendableKoin(), k.W.vhp * P.b / P.a);
      $('lpAddKoin').value = Math.max(0, Math.floor(max * 0.999 * 1e4) / 1e4); addPreview();
    });
    $('lpAddBtn').addEventListener('click', () => k.guarded(add));
    $('lpRemovePct').addEventListener('click', e => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      removePct = +b.dataset.p;
      for (const x of $('lpRemovePct').children) x.classList.toggle('on', x === b);
      render();
    });
    $('lpRemoveBtn').addEventListener('click', () => k.guarded(remove));
    k.listeners.push(render);
    window.KC.hooks.push(render);
    load();
    setInterval(load, 60000);
  });
})();

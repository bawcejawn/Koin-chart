// Wallet + transaction engine.
// Security model: this page never sees your private key. Every transaction is built here,
// shown to you in a review step, then signed (or rejected) by you inside the Kondor popup.
(() => {
  const $ = id => document.getElementById(id);
  const PERIPHERY = '17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s';
  const KOIN = '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK';
  const VHP = '12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq';
  const VHP_PAIR = '1NqLghiFRwkXZR7NBFHHiCJkF5gLHyJap1';
  const MANA_BUFFER = 10; // KOIN of mana kept free so the transaction itself can run
  const contractAddr = id => id === 'koin' ? KOIN : id === 'vhp' ? VHP : id;

  const provider = new Provider(['https://api.koinos.io']);
  const periphery = new Contract({ id: PERIPHERY, abi: PERIPHERY_ABI, provider });
  const token = id => new Contract({ id: contractAddr(id), abi: TOKEN_ABI, provider });
  const plainAbis = JSON.parse(JSON.stringify({ [PERIPHERY]: PERIPHERY_ABI, [KOIN]: TOKEN_ABI, [VHP]: TOKEN_ABI, [VHP_PAIR]: TOKEN_ABI }));

  const W = { address: null, koin: 0, vhp: 0, lp: 0, mana: 0, busy: false };
  const listeners = [];
  const emit = () => { for (const f of listeners) try { f(W); } catch (e) { console.error(e); } };

  // ---------- settings ----------
  const S = { slippage: 0.5, keepProfit: 50 };
  try { Object.assign(S, JSON.parse(localStorage.getItem('kc-settings') || '{}')); } catch (e) {}
  const saveSettings = () => { try { localStorage.setItem('kc-settings', JSON.stringify(S)); } catch (e) {} };

  // ---------- helpers ----------
  const fmt = (x, d = 4) => (+x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) });
  const toRaw = (x, dec = 8) => BigInt(Math.floor(+x * 10 ** dec + 1e-9));
  const fromRaw = (x, dec = 8) => Number(x) / 10 ** dec;
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(msg)), ms))]);

  async function balanceOf(id, owner) {
    const { result } = await token(id).functions.balanceOf({ owner });
    return Number(result?.value || 0) / 1e8;
  }
  async function reserves(pair) {
    const r = await provider.call('chain.read_contract', { contract_id: pair, entry_point: 0x6d0c5abf, args: '' });
    const d = window.KC.pb(window.KC.b64(r.result));
    return { a: BigInt(d[2] || 0n), b: BigInt(d[3] || 0n) }; // token0 / token1 raw
  }
  async function totalSupply(pair) {
    const r = await provider.call('chain.read_contract', { contract_id: pair, entry_point: 0xb0da3934, args: '' });
    const d = window.KC.pb(window.KC.b64(r.result || ''));
    return BigInt(d[1] || 0n);
  }

  // ---------- connect / balances ----------
  async function refreshBalances() {
    if (!W.address) return;
    try {
      const [k, v, l, rc] = await Promise.all([
        balanceOf('koin', W.address), balanceOf('vhp', W.address), balanceOf(VHP_PAIR, W.address), provider.getAccountRc(W.address),
      ]);
      Object.assign(W, { koin: k, vhp: v, lp: l, mana: Number(rc) / 1e8 });
      emit();
    } catch (e) { console.error('balances', e); }
  }
  // KOIN you can swap right now: Koinos only lets you move KOIN whose mana is available
  const spendableKoin = () => Math.max(0, Math.min(W.koin, W.mana - MANA_BUFFER));

  async function connect() {
    if (!window.kondor) throw new Error('The Kondor connector did not load. Refresh the page and try again.');
    const hint = setTimeout(() => toast('Waiting for Kondor… Approve the request in the Kondor popup. No popup? Make sure the Kondor extension is installed and unlocked.', 'info', 12000), 4000);
    let accounts;
    try {
      accounts = await withTimeout(kondor.getAccounts(), 120000, 'Kondor did not respond. Install or unlock the Kondor extension, then try again.');
    } finally { clearTimeout(hint); }
    if (!accounts || !accounts.length) throw new Error('No Kondor accounts were shared with this page.');
    let address = accounts[0].address;
    if (accounts.length > 1) {
      address = await pickAccount(accounts);
      if (!address) return;
    }
    setAddress(address);
    toast('Wallet connected: ' + short(address), 'ok');
  }
  function setAddress(a) {
    W.address = a;
    try { a ? localStorage.setItem('kc-wallet', a) : localStorage.removeItem('kc-wallet'); } catch (e) {}
    emit(); refreshBalances();
  }
  function disconnect() { Object.assign(W, { address: null, koin: 0, vhp: 0, lp: 0, mana: 0 }); setAddress(null); }
  async function ensureConnected() { if (!W.address) await connect(); return !!W.address; }

  // ---------- transactions ----------
  async function approveOpIfNeeded(id, amountRaw) {
    const t = token(id);
    const { result } = await t.functions.allowance({ owner: W.address, spender: PERIPHERY });
    if (BigInt(result?.value || 0) >= amountRaw) return null;
    const { operation } = await t.functions.approve({ owner: W.address, spender: PERIPHERY, value: amountRaw.toString() }, { onlyOperation: true });
    return operation;
  }
  async function swapOp(amountIn, amountOutMin, path) {
    const { operation } = await periphery.functions.swap_tokens_in({
      from: W.address, receiver: W.address, amountIn: amountIn.toString(), amountOutMin: amountOutMin.toString(), path,
    }, { onlyOperation: true });
    return operation;
  }
  async function peripheryOp(name, args) {
    const { operation } = await periphery.functions[name](args, { onlyOperation: true });
    return operation;
  }

  // Builds the transaction, hands it to Kondor to sign + send, waits for the block.
  async function send(ops, activity) {
    if (W.busy) throw new Error('Another transaction is still in progress.');
    W.busy = true; emit();
    const before = { koin: W.koin, vhp: W.vhp, lp: W.lp };
    let entry = null;
    try {
      const rc = Number(await provider.getAccountRc(W.address));
      if (rc < 2e8) throw new Error('Not enough mana to send a transaction. Mana comes from the KOIN in this wallet and recharges over time.');
      const rcLimit = String(Math.min(rc, 1e9)); // at most 10 KOIN of mana; only what is used is consumed (and it recharges)
      const tx = await Transaction.prepareTransaction({ header: { rc_limit: rcLimit, payer: W.address }, operations: ops.filter(Boolean) }, provider, W.address);
      const signer = kondor.getSigner(W.address);
      toast('Check the Kondor popup to review and sign.', 'info', 8000);
      let res;
      try { res = await signer.sendTransaction(JSON.parse(JSON.stringify(tx)), { broadcast: true, abis: plainAbis }); }
      catch (e) {
        if (/clone|serializ/i.test(String(e))) res = await signer.sendTransaction(JSON.parse(JSON.stringify(tx)), { broadcast: true });
        else throw e;
      }
      const txId = res.transaction.id;
      if (res.receipt && res.receipt.reverted) throw new Error('The transaction reverted on-chain (prices moved past your minimum). Nothing was traded; only some mana was used, and it recharges.');
      entry = { t: Date.now(), ...activity, txId, status: 'pending' };
      logActivity(entry);
      toast('Sent. Waiting for it to be included in a block…', 'info', 8000);
      try { await provider.wait(txId, 'byBlock', 60000); entry.status = 'confirmed'; }
      catch (e) { entry.status = 'sent (not yet confirmed)'; }
      await refreshBalances();
      entry.delta = { koin: W.koin - before.koin, vhp: W.vhp - before.vhp, lp: W.lp - before.lp };
      logActivity(entry, true);
      return entry;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/reject|denied|cancel/i.test(msg)) throw new Error('You rejected the transaction in Kondor. Nothing was sent.');
      throw e;
    } finally { W.busy = false; emit(); }
  }

  // ---------- activity log (results) ----------
  function getActivity() { try { return JSON.parse(localStorage.getItem('kc-activity') || '[]'); } catch (e) { return []; } }
  function logActivity(entry, update) {
    const list = getActivity();
    const i = list.findIndex(x => x.txId === entry.txId);
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    try { localStorage.setItem('kc-activity', JSON.stringify(list.slice(0, 300))); } catch (e) {}
    renderActivity();
  }
  function renderActivity() {
    const el = $('actBody'); if (!el) return;
    const list = getActivity();
    let gainV = 0, gainK = 0;
    for (const a of list) {
      if (!a.delta) continue;
      if (a.kind === 'buy') gainV += a.delta.vhp + a.delta.koin; // extra VHP vs burning the KOIN spent
      if (a.kind === 'loop') { if (a.start === 'vhp') gainV += a.delta.vhp; else gainK += a.delta.koin; }
    }
    $('actGainV').textContent = (gainV >= 0 ? '+' : '') + fmt(gainV, 4) + ' VHP';
    $('actGainK').textContent = (gainK >= 0 ? '+' : '') + fmt(gainK, 4) + ' KOIN';
    $('actCount').textContent = String(list.length);
    el.innerHTML = list.length ? list.map(a => {
      const d = a.delta ? [a.delta.koin ? `${a.delta.koin >= 0 ? '+' : ''}${fmt(a.delta.koin, 4)} KOIN` : '', a.delta.vhp ? `${a.delta.vhp >= 0 ? '+' : ''}${fmt(a.delta.vhp, 4)} VHP` : '', a.delta.lp ? `${a.delta.lp >= 0 ? '+' : ''}${fmt(a.delta.lp, 4)} LP` : ''].filter(Boolean).join(' · ') : '—';
      return `<tr><td>${esc(new Date(a.t).toLocaleString())}</td><td>${esc(a.label || a.kind)}</td><td>${esc(d)}</td><td>${esc(a.status)}</td><td><a href="https://koinosblocks.com/tx/${encodeURIComponent(a.txId)}" target="_blank" rel="noopener">${esc(String(a.txId).slice(6, 14))}…</a></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">No trades from this page yet. Your one-click trades and their results will show here.</td></tr>';
  }

  // ---------- UI: toasts, review modal, account picker ----------
  function toast(msg, kind = 'info', ms = 6000) {
    const box = $('toasts'); if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => d.remove(), ms);
  }
  // rows: [[label, value, cls?]]; resolves true when the user clicks the confirm button
  function review({ title, intro, rows, warn, confirm = 'Confirm in Kondor' }) {
    return new Promise(resolve => {
      const m = $('modal');
      m.querySelector('.mTitle').textContent = title;
      m.querySelector('.mIntro').textContent = intro || '';
      m.querySelector('.mRows').innerHTML = rows.map(([l, v, c]) => `<span>${esc(l)}</span><b class="${c || ''}">${esc(v)}</b>`).join('');
      const w = m.querySelector('.mWarn'); w.hidden = !warn; w.textContent = warn || '';
      const ok = m.querySelector('.mOk'), no = m.querySelector('.mNo');
      ok.textContent = confirm;
      const done = v => { m.hidden = true; ok.onclick = no.onclick = null; document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      ok.onclick = () => done(true); no.onclick = () => done(false);
      document.addEventListener('keydown', onKey);
      m.hidden = false; ok.focus();
    });
  }
  function pickAccount(accounts) {
    return new Promise(resolve => {
      const m = $('modal');
      m.querySelector('.mTitle').textContent = 'Choose an account';
      m.querySelector('.mIntro').textContent = 'Kondor shared more than one account. Which one should this page use?';
      m.querySelector('.mRows').innerHTML = accounts.map((a, i) => `<span>${esc(a.name || 'Account ' + (i + 1))}</span><b><button class="btn small" data-a="${esc(a.address)}">${esc(short(a.address))}</button></b>`).join('');
      m.querySelector('.mWarn').hidden = true;
      const ok = m.querySelector('.mOk'), no = m.querySelector('.mNo');
      ok.hidden = true;
      const done = v => { m.hidden = true; ok.hidden = false; resolve(v); };
      m.querySelector('.mRows').onclick = e => { const b = e.target.closest('button[data-a]'); if (b) done(b.dataset.a); };
      no.onclick = () => done(null);
      m.hidden = false;
    });
  }

  // ---------- wallet bar ----------
  function renderWallet() {
    const on = !!W.address;
    $('wConnect').hidden = on; $('wInfo').hidden = !on;
    if (on) {
      $('wAddr').textContent = short(W.address);
      $('wAddr').title = W.address;
      $('wKoin').textContent = fmt(W.koin, 2);
      $('wVhp').textContent = fmt(W.vhp, 2);
      $('wMana').textContent = fmt(Math.max(0, W.mana), 2);
      $('wSpend').textContent = fmt(spendableKoin(), 2);
    }
    document.body.classList.toggle('connected', on);
    document.body.classList.toggle('txbusy', !!W.busy);
  }
  listeners.push(renderWallet);

  async function guarded(fn) {
    try { await fn(); }
    catch (e) { console.error(e); toast(String(e && e.message || e), 'err', 10000); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('wConnect').addEventListener('click', () => guarded(connect));
    $('wDisconnect').addEventListener('click', disconnect);
    $('wCopy').addEventListener('click', () => { navigator.clipboard?.writeText(W.address).then(() => toast('Address copied', 'ok', 2500)).catch(() => {}); });
    $('setSlip').value = S.slippage; $('setKeep').value = S.keepProfit;
    $('setSlip').addEventListener('change', e => { const v = parseFloat(e.target.value); if (v > 0 && v <= 20) { S.slippage = v; saveSettings(); } else e.target.value = S.slippage; });
    $('setKeep').addEventListener('change', e => { const v = parseFloat(e.target.value); if (v >= 0 && v <= 100) { S.keepProfit = v; saveSettings(); } else e.target.value = S.keepProfit; });
    $('actClear').addEventListener('click', async () => {
      if (await review({ title: 'Clear your activity log?', intro: 'This only clears the list stored in this browser. Nothing on-chain changes.', rows: [], confirm: 'Clear log' })) {
        try { localStorage.removeItem('kc-activity'); } catch (e) {} renderActivity();
      }
    });
    renderActivity(); renderWallet();
    let saved = null; try { saved = localStorage.getItem('kc-wallet'); } catch (e) {}
    if (saved) setAddress(saved);
    setInterval(refreshBalances, 30000);
  });

  window.KW = {
    W, S, PERIPHERY, KOIN, VHP, VHP_PAIR, provider, listeners,
    connect, ensureConnected, refreshBalances, spendableKoin, send, review, toast, guarded,
    approveOpIfNeeded, swapOp, peripheryOp, reserves, totalSupply, balanceOf,
    fmt, toRaw, fromRaw, esc, short, MANA_BUFFER,
  };
})();

// Pools page: swap, add/remove liquidity, and (for the owner) create pools and claim fees.
// Security model: the page never sees your key. Each transaction is shown to you, then signed in Kondor.
// Every trade carries an on-chain minimum (min_out / min_shares / min_a+min_b), so it cancels rather than fill worse.
(() => {
  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const CFG = Object.assign({}, window.POOLS_CONFIG, window.POOLS_CONFIG_OVERRIDE || {}); // override: used by the automated page test
  if (qs.get('contract')) CFG.contract = qs.get('contract');
  if (qs.get('rpc')) CFG.rpc = qs.get('rpc');
  const CONTRACT = (CFG.contract || '').trim();

  const provider = new Provider([CFG.rpc]);
  const T = {}; for (const t of CFG.tokens) T[t.sym] = t;
  const bySym = s => T[s], byId = id => CFG.tokens.find(t => t.id === id);
  const token = sym => new Contract({ id: T[sym].id, abi: TOKEN_ABI, provider });
  const pool = CONTRACT ? new Contract({ id: CONTRACT, abi: POOL_ABI, provider }) : null;
  const plainAbis = JSON.parse(JSON.stringify(Object.assign({ [CONTRACT || 'none']: POOL_ABI }, ...CFG.tokens.map(t => ({ [t.id]: TOKEN_ABI })))));

  const W = { address: null, bal: {}, mana: 0, busy: false };
  let POOLS = [], OWNER = null, KOIN_USD = 0;

  // ---------- helpers ----------
  const fmt = (x, d = 4) => (+x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) });
  const usd = x => x ? '$' + (+x).toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 2 : 0, minimumFractionDigits: x < 10 ? 2 : 0 }) : '—';
  const toRaw = (x, dec = 8) => { const s = String(x).trim(); if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return 0n; const [i, f = ''] = s.split('.'); return BigInt(i || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0'); };
  const fromRaw = (x, dec = 8) => Number(x) / 10 ** dec;
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slipBps = () => { const v = parseFloat($('slip').value); return BigInt(Math.round((v > 0 && v <= 20 ? v : 0.5) * 100)); };
  const big = v => BigInt(v || 0);
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(msg)), ms))]);

  // same math as the contract's _quote: fee rounded up, LP + owner fee taken from the input
  function quote(p, inSym, amountIn) {
    const inIsA = inSym === p.A;
    const rin = inIsA ? p.ra : p.rb, rout = inIsA ? p.rb : p.ra;
    if (amountIn <= 0n || rin === 0n || rout === 0n) return { out: 0n, fee: 0n };
    const fee = (amountIn * BigInt(p.fee) + 9999n) / 10000n;
    const x = amountIn - fee;
    const out = x > 0n ? (x * rout) / (rin + x) : 0n;
    return { out: out >= rout ? 0n : out, fee, rin, rout };
  }
  const findPool = (a, b) => POOLS.find(p => (p.A === a && p.B === b) || (p.A === b && p.B === a));

  // ---------- chain reads ----------
  function pb(buf) {
    const o = {}; let i = 0;
    const vr = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 127) << s; s += 7n; } while (b & 128); return r; };
    while (i < buf.length) { const k = Number(vr()), f = k >> 3, t = k & 7; if (t === 0) o[f] = vr(); else if (t === 2) { const l = Number(vr()); o[f] = buf.slice(i, i + l); i += l; } else break; }
    return o;
  }
  const b64 = s => Uint8Array.from(atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  async function koinUsd() {
    try {
      const rd = async ep => pb(b64((await provider.call('chain.read_contract', { contract_id: CFG.koinUsdPool, entry_point: ep, args: '' })).result));
      const [r, t] = await Promise.all([rd(0x6d0c5abf), rd(0x7d5b5ed7)]);
      const t0 = utils.encodeBase58(t[1]);
      const k = t0 === T.KOIN.id ? r[2] : r[3], u = t0 === T.KOIN.id ? r[3] : r[2];
      return Number(u) / Number(k);
    } catch (e) { return 0; }
  }
  async function loadPools() {
    if (!pool) { POOLS = []; return; }
    const out = [];
    for (const [a, b] of CFG.pairs) {
      try {
        const { result: r } = await pool.functions.get_pool({ token_a: T[a].id, token_b: T[b].id });
        if (!r || !r.exists) continue;
        const A = byId(r.token_a).sym, B = byId(r.token_b).sym;
        const p = { A, B, ra: big(r.reserve_a), rb: big(r.reserve_b), fee: +r.fee_bps, total: big(r.total_shares), ofA: big(r.owner_fees_a), ofB: big(r.owner_fees_b), mine: 0n };
        if (W.address) p.mine = big((await pool.functions.get_shares({ token_a: T[A].id, token_b: T[B].id, account: W.address })).result?.value);
        out.push(p);
      } catch (e) { console.warn('get_pool', a, b, e); }
    }
    POOLS = out;
  }
  async function loadOwner() { try { OWNER = pool ? (await pool.functions.get_owner()).result?.value || null : null; } catch (e) { OWNER = null; } }
  async function loadBalances() {
    if (!W.address) return;
    const rows = await Promise.all(CFG.tokens.map(async t => [t.sym, big((await token(t.sym).functions.balanceOf({ owner: W.address })).result?.value)]));
    W.bal = Object.fromEntries(rows);
    W.mana = Number(await provider.getAccountRc(W.address)) / 1e8;
  }
  const usdOf = (sym, raw) => { const t = T[sym]; const v = fromRaw(raw, t.dec); return t.usd ? v * t.usd : sym === 'KOIN' ? v * KOIN_USD : 0; };
  const poolUsd = p => { const a = usdOf(p.A, p.ra), b = usdOf(p.B, p.rb); return a && b ? a + b : (a || b) * 2; };

  // ---------- render ----------
  function renderPools() {
    const body = $('pBody');
    if (!CONTRACT) {
      body.innerHTML = CFG.pairs.slice(0, 5).map(([a, b]) => `<tr><td>${a} / ${b}</td><td><span class="feeTag">${a === 'KOIN' ? '3%' : '1%'}</span></td><td colspan="4" class="mute">planned</td></tr>`).join('');
      return;
    }
    if (!POOLS.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No pools yet.</td></tr>'; return; }
    body.innerHTML = POOLS.map(p => {
      const share = p.total ? Number(p.mine) / Number(p.total) * 100 : 0;
      const price = p.ra ? fromRaw(p.rb, T[p.B].dec) / fromRaw(p.ra, T[p.A].dec) : 0;
      return `<tr><td>${p.A} / ${p.B}</td><td><span class="feeTag">${p.fee / 100}%</span></td>
        <td>${fmt(fromRaw(p.ra, T[p.A].dec), 4)} ${p.A} · ${fmt(fromRaw(p.rb, T[p.B].dec), 4)} ${p.B}</td>
        <td>1 ${p.A} = ${fmt(price, price < 1 ? 8 : 4)} ${p.B}</td><td>${usd(poolUsd(p))}</td>
        <td>${p.mine ? fmt(share, 2) + '%' : '—'}</td></tr>`;
    }).join('');
    $('sPools').textContent = String(POOLS.length);
    $('sTvl').textContent = usd(POOLS.reduce((a, p) => a + poolUsd(p), 0));
  }
  function renderWallet() {
    const on = !!W.address;
    $('wConnect').hidden = on; $('wInfo').hidden = !on;
    if (on) {
      $('wAddr').textContent = short(W.address); $('wAddr').title = W.address;
      $('wBal').innerHTML = CFG.tokens.map(t => `<div><b>${fmt(fromRaw(W.bal[t.sym] || 0n, t.dec), t.sym === 'vETH' ? 6 : 2)}</b><span>${t.sym}</span></div>`).join('');
    }
    $('ownerBox').hidden = !(on && OWNER && OWNER === W.address);
    document.body.classList.toggle('txbusy', !!W.busy);
  }
  function fillSelects() {
    const syms = CFG.tokens.map(t => t.sym);
    const opt = (list, v) => list.map(s => `<option ${s === v ? 'selected' : ''}>${s}</option>`).join('');
    const from = $('sFrom').value || 'KOIN';
    const reachable = syms.filter(s => s !== from && (!CONTRACT || findPool(from, s)));
    $('sFrom').innerHTML = opt(syms, from);
    const to = reachable.includes($('sTo').value) ? $('sTo').value : reachable[0];
    $('sTo').innerHTML = opt(reachable, to);
    const lp = $('lPool').value;
    const list = CONTRACT ? POOLS.map(p => `${p.A}/${p.B}`) : CFG.pairs.slice(0, 5).map(x => x.join('/'));
    $('lPool').innerHTML = list.map(k => `<option ${k === lp ? 'selected' : ''}>${k}</option>`).join('');
    $('cA').innerHTML = opt(syms, $('cA').value || 'KOIN');
    $('cB').innerHTML = opt(syms, $('cB').value || 'vETH');
  }
  function renderFees() {
    const rows = POOLS.filter(p => p.ofA || p.ofB);
    $('feeBody').innerHTML = rows.length ? rows.map(p => `<tr><td>${p.A}/${p.B}</td><td>${fmt(fromRaw(p.ofA, T[p.A].dec), 6)} ${p.A} · ${fmt(fromRaw(p.ofB, T[p.B].dec), 6)} ${p.B}</td><td><button class="btn small" data-claim="${p.A}/${p.B}">Claim</button></td></tr>`).join('')
      : '<tr><td class="empty">No fees waiting yet.</td></tr>';
  }

  // ---------- swap ----------
  function swapState() {
    const from = $('sFrom').value, to = $('sTo').value;
    const p = findPool(from, to);
    const amt = toRaw($('sIn').value, T[from].dec);
    const q = p ? quote(p, from, amt) : { out: 0n };
    const minOut = q.out * (10000n - slipBps()) / 10000n;
    return { from, to, p, amt, q, minOut };
  }
  function renderSwap() {
    const s = swapState();
    $('sFromBal').textContent = W.address ? `Balance: ${fmt(fromRaw(W.bal[s.from] || 0n, T[s.from].dec), 6)} ${s.from}` : '';
    $('sOut').value = s.q.out ? String(fromRaw(s.q.out, T[s.to].dec)) : '';
    const go = $('sGo');
    let label = 'Swap', ok = true;
    if (!CONTRACT) { label = 'Opening soon'; ok = false; }
    else if (!s.p) { label = 'No pool for this pair'; ok = false; }
    else if (!s.amt) { label = 'Enter an amount'; ok = false; }
    else if (!s.q.out) { label = 'Amount too small'; ok = false; }
    else if (W.address && (W.bal[s.from] || 0n) < s.amt) { label = `Not enough ${s.from}`; ok = false; }
    else if (!W.address) label = 'Connect wallet to swap';
    go.textContent = label; go.disabled = !ok || W.busy;
    if (s.p && s.amt && s.q.out) {
      const spot = Number(s.q.rout) / Number(s.q.rin);
      const exec = Number(s.q.out) / Number(s.amt);
      const impact = Math.max(0, (1 - exec / spot) * 100);
      $('sInfo').innerHTML = `<span>Pool fee</span><b>${s.p.fee / 100}% (${fmt(fromRaw(s.q.fee, T[s.from].dec), 6)} ${s.from})</b>
        <span>Price impact</span><b class="${impact > 5 ? 'down' : ''}">${fmt(impact, 2)}%</b>
        <span>Minimum you get</span><b>${fmt(fromRaw(s.minOut, T[s.to].dec), 8)} ${s.to}</b>`;
    } else $('sInfo').innerHTML = '';
  }
  async function doSwap() {
    if (!(await ensureConnected())) return;
    const s = swapState();
    // authoritative quote from the contract right before signing
    const live = big((await pool.functions.get_quote({ token_in: T[s.from].id, token_out: T[s.to].id, amount_in: s.amt.toString() })).result?.value);
    const minOut = live * (10000n - slipBps()) / 10000n;
    if (!minOut) throw new Error('The pool would give nothing for this amount.');
    const ok = await review({
      title: `Swap ${s.from} → ${s.to}`, intro: 'One transaction: approve the pool for exactly this amount, then swap.',
      rows: [['You pay', `${fmt(fromRaw(s.amt, T[s.from].dec), 8)} ${s.from}`], ['You get about', `${fmt(fromRaw(live, T[s.to].dec), 8)} ${s.to}`], ['At least', `${fmt(fromRaw(minOut, T[s.to].dec), 8)} ${s.to}`, 'up'], ['Pool fee', `${s.p.fee / 100}%`]],
    });
    if (!ok) return;
    const ops = [
      await op(token(s.from), 'approve', { owner: W.address, spender: CONTRACT, value: s.amt.toString() }),
      await op(pool, 'swap', { from: W.address, token_in: T[s.from].id, token_out: T[s.to].id, amount_in: s.amt.toString(), min_out: minOut.toString() }),
    ];
    await send(ops, `Swap ${fmt(fromRaw(s.amt, T[s.from].dec), 6)} ${s.from} → ${s.to}`);
  }

  // ---------- liquidity ----------
  const selPool = () => { const [a, b] = ($('lPool').value || '/').split('/'); return findPool(a, b); };
  function addState() {
    const p = selPool(); if (!p) return null;
    let a = toRaw($('lA').value, T[p.A].dec), b;
    const first = p.total === 0n;
    if (first) b = toRaw($('lB').value, T[p.B].dec);
    else { b = p.ra ? a * p.rb / p.ra : 0n; }
    const minted = first ? 0n : (() => { const sA = a * p.total / p.ra, sB = b * p.total / p.rb; return sA < sB ? sA : sB; })();
    return { p, a, b, first, minted, minShares: minted ? minted * (10000n - slipBps()) / 10000n : 1n };
  }
  function renderAdd() {
    const p = selPool();
    $('lALbl').textContent = p ? `${p.A} amount` : 'Amount';
    $('lBLbl').textContent = p ? `${p.B} amount` : 'Amount';
    const s = addState();
    const go = $('lGo');
    if (!CONTRACT || !s) { go.textContent = CONTRACT ? 'Choose a pool' : 'Opening soon'; go.disabled = true; return; }
    $('lB').readOnly = !s.first;
    if (!s.first) $('lB').value = s.b ? String(fromRaw(s.b, T[s.p.B].dec)) : '';
    $('lBNote').textContent = s.first ? 'First deposit sets the price' : 'Matched to the pool ratio';
    $('lABal').textContent = W.address ? `Balance: ${fmt(fromRaw(W.bal[s.p.A] || 0n, T[s.p.A].dec), 6)}` : '';
    $('lBBal').textContent = W.address ? `Balance: ${fmt(fromRaw(W.bal[s.p.B] || 0n, T[s.p.B].dec), 6)}` : '';
    const share = s.minted && s.p.total ? Number(s.minted) / Number(s.p.total + s.minted) * 100 : (s.first ? 100 : 0);
    $('lInfo').innerHTML = s.a && s.b ? `<span>Your share of the pool</span><b>${fmt(share, 2)}%</b><span>Fee you earn on</span><b>${s.p.fee / 100 * 0.9}% of every trade (pool fee minus the 10% owner share), shared by LPs</b>` : '';
    let label = 'Add liquidity', ok = true;
    if (!s.a || !s.b) { label = 'Enter amounts'; ok = false; }
    else if (W.address && ((W.bal[s.p.A] || 0n) < s.a || (W.bal[s.p.B] || 0n) < s.b)) { label = 'Not enough balance'; ok = false; }
    else if (!W.address) label = 'Connect wallet';
    go.textContent = label; go.disabled = !ok || W.busy;
  }
  async function doAdd() {
    if (!(await ensureConnected())) return;
    const s = addState();
    const ok = await review({
      title: `Add liquidity to ${s.p.A}/${s.p.B}`, intro: s.first ? 'This is the first deposit: it sets the starting price. 1,000 tiny shares are locked forever (standard protection).' : 'Amounts follow the pool\'s current ratio.',
      rows: [[s.p.A, fmt(fromRaw(s.a, T[s.p.A].dec), 8)], [s.p.B, fmt(fromRaw(s.b, T[s.p.B].dec), 8)], ['Minimum shares', s.minShares.toString()]],
    });
    if (!ok) return;
    const ops = [
      await op(token(s.p.A), 'approve', { owner: W.address, spender: CONTRACT, value: s.a.toString() }),
      await op(token(s.p.B), 'approve', { owner: W.address, spender: CONTRACT, value: s.b.toString() }),
      await op(pool, 'add_liquidity', { from: W.address, token_a: T[s.p.A].id, token_b: T[s.p.B].id, amount_a: s.a.toString(), amount_b: s.b.toString(), min_shares: s.minShares.toString() }),
    ];
    await send(ops, `Add liquidity ${s.p.A}/${s.p.B}`);
  }
  function remState() {
    const p = selPool(); if (!p) return null;
    const pct = BigInt($('rPct').value);
    const shares = p.mine * pct / 100n;
    const outA = p.total ? shares * p.ra / p.total : 0n, outB = p.total ? shares * p.rb / p.total : 0n;
    const k = 10000n - slipBps();
    return { p, shares, outA, outB, minA: outA * k / 10000n, minB: outB * k / 10000n };
  }
  function renderRem() {
    $('rPctLbl').textContent = $('rPct').value + '%';
    const s = remState(), go = $('rGo');
    if (!CONTRACT || !s) { go.disabled = true; $('rInfo').innerHTML = ''; return; }
    $('rInfo').innerHTML = `<span>Your shares</span><b>${s.p.mine.toString()}</b><span>You get about</span><b>${fmt(fromRaw(s.outA, T[s.p.A].dec), 8)} ${s.p.A} + ${fmt(fromRaw(s.outB, T[s.p.B].dec), 8)} ${s.p.B}</b>`;
    go.disabled = !s.shares || W.busy;
    go.textContent = !W.address ? 'Connect wallet' : s.p.mine ? 'Remove liquidity' : 'You have no shares here';
  }
  async function doRemove() {
    if (!(await ensureConnected())) return;
    const s = remState();
    if (!(await review({ title: `Remove liquidity from ${s.p.A}/${s.p.B}`, rows: [['Shares', s.shares.toString()], ['At least', `${fmt(fromRaw(s.minA, T[s.p.A].dec), 8)} ${s.p.A}`], ['and', `${fmt(fromRaw(s.minB, T[s.p.B].dec), 8)} ${s.p.B}`]] }))) return;
    await send([await op(pool, 'remove_liquidity', { from: W.address, token_a: T[s.p.A].id, token_b: T[s.p.B].id, shares: s.shares.toString(), min_a: s.minA.toString(), min_b: s.minB.toString() })], `Remove liquidity ${s.p.A}/${s.p.B}`);
  }

  // ---------- owner ----------
  async function doCreate() {
    const a = $('cA').value, b = $('cB').value, fee = +$('cFee').value;
    if (a === b) throw new Error('Pick two different tokens.');
    if (findPool(a, b)) throw new Error('That pool already exists.');
    if (!(await review({ title: `Create ${a}/${b} at ${fee / 100}%`, intro: 'The fee is permanent. After creating, add the first liquidity to set the price.', rows: [['Pool', `${a} / ${b}`], ['Fee', `${fee / 100}% (owner gets 10% of it)`]], warn: 'This cannot be changed later.' }))) return;
    await send([await op(pool, 'create_pool', { token_a: T[a].id, token_b: T[b].id, fee_bps: fee })], `Create pool ${a}/${b} ${fee / 100}%`);
  }
  async function doClaim(key) {
    const [a, b] = key.split('/'); const p = findPool(a, b);
    if (!(await review({ title: `Claim owner fees from ${a}/${b}`, rows: [[a, fmt(fromRaw(p.ofA, T[p.A].dec), 8)], [b, fmt(fromRaw(p.ofB, T[p.B].dec), 8)], ['To', short(W.address)]] }))) return;
    await send([await op(pool, 'claim_owner_fees', { token_a: T[p.A].id, token_b: T[p.B].id, to: W.address })], `Claim fees ${a}/${b}`);
  }

  // ---------- wallet / transactions ----------
  async function op(contract, fn, args) { const { operation } = await contract.functions[fn](args, { onlyOperation: true }); return operation; }
  async function connect() {
    if (!window.kondor) throw new Error('The Kondor connector did not load. Refresh and try again.');
    const accounts = await withTimeout(kondor.getAccounts(), 120000, 'Kondor did not respond. Install or unlock Kondor, then try again.');
    if (!accounts || !accounts.length) throw new Error('No Kondor accounts were shared with this page.');
    W.address = accounts[0].address;
    try { localStorage.setItem('kc-wallet', W.address); } catch (e) {}
    await refresh(); toast('Wallet connected: ' + short(W.address), 'ok');
  }
  async function ensureConnected() { if (!W.address) await connect(); return !!W.address; }
  async function send(ops, label) {
    if (W.busy) throw new Error('Another transaction is still in progress.');
    W.busy = true; renderAll();
    try {
      const rc = Number(await provider.getAccountRc(W.address));
      if (rc < 5e7) throw new Error('Not enough mana to send a transaction. Mana comes from the KOIN in this wallet and recharges over time.');
      const tx = await Transaction.prepareTransaction({ header: { rc_limit: String(Math.min(rc, 5e8)), payer: W.address }, operations: ops }, provider, W.address);
      toast('Check the Kondor popup to review and sign.', 'info', 8000);
      const res = await kondor.getSigner(W.address).sendTransaction(JSON.parse(JSON.stringify(tx)), { broadcast: true, abis: plainAbis });
      const id = res.transaction.id;
      if (res.receipt && res.receipt.reverted) throw new Error('The transaction reverted (the price moved past your minimum). Nothing was traded.');
      logAct({ t: Date.now(), label, id, status: 'sent' });
      try { await provider.wait(id, 'byBlock', 60000); logAct({ id, status: 'confirmed' }); toast(label + ': confirmed', 'ok'); }
      catch (e) { logAct({ id, status: 'sent (not yet confirmed)' }); }
      $('sIn').value = ''; $('lA').value = ''; $('lB').value = '';
      await refresh();
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/reject|denied|cancel/i.test(msg)) throw new Error('You rejected the transaction in Kondor. Nothing was sent.');
      throw e;
    } finally { W.busy = false; renderAll(); }
  }
  function getActs() { try { return JSON.parse(localStorage.getItem('kp-activity') || '[]'); } catch (e) { return []; } }
  function logAct(e) {
    const list = getActs(); const i = list.findIndex(x => x.id === e.id);
    if (i >= 0) list[i] = Object.assign(list[i], e); else list.unshift(e);
    try { localStorage.setItem('kp-activity', JSON.stringify(list.slice(0, 200))); } catch (err) {}
    renderActs();
  }
  function renderActs() {
    const l = getActs();
    $('aBody').innerHTML = l.length ? l.map(a => `<tr><td>${esc(new Date(a.t).toLocaleString())}</td><td>${esc(a.label)}</td><td>${esc(a.status)}</td><td><a href="${esc(CFG.explorer + a.id)}" target="_blank" rel="noopener">${esc(String(a.id).slice(6, 14))}…</a></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Nothing yet.</td></tr>';
  }
  function toast(msg, kind = 'info', ms = 6000) {
    const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = msg;
    $('toasts').appendChild(d); setTimeout(() => d.remove(), ms);
  }
  function review({ title, intro, rows, warn, confirm = 'Confirm in Kondor' }) {
    return new Promise(resolve => {
      const m = $('modal');
      m.querySelector('.mTitle').textContent = title;
      m.querySelector('.mIntro').textContent = intro || '';
      m.querySelector('.mRows').innerHTML = rows.map(([l, v, c]) => `<span>${esc(l)}</span><b class="${c || ''}">${esc(v)}</b>`).join('');
      const w = m.querySelector('.mWarn'); w.hidden = !warn; w.textContent = warn || '';
      const ok = m.querySelector('.mOk'), no = m.querySelector('.mNo'); ok.textContent = confirm;
      const done = v => { m.hidden = true; ok.onclick = no.onclick = null; resolve(v); };
      ok.onclick = () => done(true); no.onclick = () => done(false);
      m.hidden = false; ok.focus();
    });
  }
  const guarded = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(String(e && e.message || e), 'err', 10000); } };

  function renderAll() { renderWallet(); renderPools(); fillSelects(); renderSwap(); renderAdd(); renderRem(); renderFees(); }
  async function refresh() {
    try {
      [KOIN_USD] = await Promise.all([koinUsd(), loadOwner()]);
      await Promise.all([loadPools(), loadBalances()]);
      $('sKoin').textContent = KOIN_USD ? '$' + KOIN_USD.toFixed(4) : '—';
    } catch (e) { console.error(e); }
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('notDeployed').hidden = !!CONTRACT;
    $('fContract').textContent = CONTRACT || 'not deployed yet';
    $('wConnect').onclick = guarded(connect);
    $('wDisconnect').onclick = () => { W.address = null; W.bal = {}; try { localStorage.removeItem('kc-wallet'); } catch (e) {} renderAll(); };
    $('sIn').oninput = renderSwap;
    $('sFrom').onchange = () => { fillSelects(); renderSwap(); };
    $('sTo').onchange = renderSwap;
    $('sFlip').onclick = () => { const f = $('sFrom').value, t = $('sTo').value; $('sFrom').value = t; fillSelects(); $('sTo').value = f; renderSwap(); };
    $('sMax').onclick = () => { const f = $('sFrom').value; let b = W.bal[f] || 0n; if (f === 'KOIN') { const m = toRaw(Math.max(0, W.mana - 1.5)); if (m < b) b = m; } $('sIn').value = String(fromRaw(b, T[f].dec)); renderSwap(); };
    $('slip').onchange = () => { renderSwap(); renderAdd(); renderRem(); };
    $('sGo').onclick = guarded(doSwap);
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      $('lAdd').hidden = b.dataset.t !== 'add'; $('lRem').hidden = b.dataset.t !== 'remove';
    });
    $('lPool').onchange = () => { $('lA').value = ''; $('lB').value = ''; renderAdd(); renderRem(); };
    $('lA').oninput = renderAdd; $('lB').oninput = renderAdd;
    $('lAMax').onclick = () => { const p = selPool(); if (p) { $('lA').value = String(fromRaw(W.bal[p.A] || 0n, T[p.A].dec)); renderAdd(); } };
    $('lGo').onclick = guarded(doAdd);
    $('rPct').oninput = renderRem; $('rGo').onclick = guarded(doRemove);
    $('cGo').onclick = guarded(doCreate);
    $('feeBody').onclick = e => { const b = e.target.closest('[data-claim]'); if (b) guarded(doClaim)(b.dataset.claim); };
    let saved = null; try { saved = localStorage.getItem('kc-wallet'); } catch (e) {}
    if (saved) W.address = saved;
    renderActs(); renderAll(); refresh();
    setInterval(refresh, 20000);
  });

  window.KP = { quote, toRaw, fromRaw, get pools() { return POOLS; } };
})();

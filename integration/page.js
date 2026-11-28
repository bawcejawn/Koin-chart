// Drives pools.html in a headless DOM against the local chain left running by run.js (KEEP_NODE=1).
// Kondor is replaced by a stand-in that signs with the test account's key, so every button press
// builds, signs and sends a real transaction exactly as the page does in a browser.
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { Provider, Signer, Contract } = require('koilib');
const { LocalKoinos } = require('@roamin/local-koinos');

const ROOT = path.join(__dirname, '..');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'deploy.json'), 'utf8'));
const TOKEN_ABI = require('./fixtures/kcs4-token-abi.json');
const provider = new Provider([D.rpc]);
const results = []; let failures = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  page: ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 60000, what = 'condition') { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(300); } throw new Error('timed out waiting for ' + what); }
const balance = async (id, who) => BigInt((await new Contract({ id, abi: TOKEN_ABI, provider }).functions.balance_of({ owner: who })).result?.value || 0);

function fakeKondor(wif) {
  const signer = Signer.fromWif(wif); signer.provider = provider;
  return `window.kondor = {
    getAccounts: async () => [{ address: ${JSON.stringify(signer.address)}, name: 'test' }],
    getSigner: () => ({ sendTransaction: (tx, opts) => window.__send(tx, opts) }),
  };`;
}

async function openPage(wif) {
  const signer = Signer.fromWif(wif); signer.provider = provider;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.detail?.stack || e.message)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  class Loader extends ResourceLoader {
    fetch(url) {
      if (url.includes('kondor-js')) return Promise.resolve(Buffer.from(fakeKondor(wif)));
      if (url.startsWith('file://')) return Promise.resolve(fs.readFileSync(decodeURIComponent(url.replace('file://', '').split('?')[0])));
      return Promise.resolve(Buffer.from(''));
    }
  }
  const html = fs.readFileSync(path.join(ROOT, 'pools.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'file://' + path.join(ROOT, 'pools.html'), runScripts: 'dangerously', resources: new Loader(), virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.TextDecoder = require('util').TextDecoder; w.TextEncoder = require('util').TextEncoder; w.crypto = require('crypto').webcrypto;
      w.fetch = (...a) => fetch(...a);
      w.POOLS_CONFIG_OVERRIDE = {
        rpc: D.rpc, contract: D.pool, koinUsdPool: '',
        tokens: [
          { sym: 'KOIN', id: D.koin, dec: 8 }, { sym: 'vETH', id: D.tokens.tETH, dec: 8 },
          { sym: 'vUSDT', id: D.tokens.tUSDT, dec: 8, usd: 1 }, { sym: 'vUSDC', id: D.tokens.tUSDC, dec: 8, usd: 1 },
        ],
      };
      // the stand-in for Kondor's signer: sign with the test key and broadcast
      w.__send = async (tx) => {
        const signed = await signer.signTransaction(JSON.parse(JSON.stringify(tx)));
        const { receipt } = await provider.sendTransaction(signed, true);
        return { transaction: signed, receipt };
      };
      // the page waits for blocks with koilib's "byBlock", which the local chain supports
    },
  });
  const w = dom.window;
  await waitFor(() => w.KP && w.document.getElementById('pBody').textContent.includes('/'), 60000, 'pools to load');
  // approve every review dialog automatically
  const timer = setInterval(() => { const m = w.document.getElementById('modal'); if (m && !m.hidden) m.querySelector('.mOk').click(); }, 200);
  return { w, $: id => w.document.getElementById(id), signer, errors, close: () => { clearInterval(timer); w.close(); } };
}
const set = (el, v) => { el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input')); el.dispatchEvent(new el.ownerDocument.defaultView.Event('change')); };
const lastAct = w => JSON.parse(w.localStorage.getItem('kp-activity') || '[]')[0] || {};

async function main() {
  const lk = new LocalKoinos();
  await lk.startBlockProduction(); // run.js exited; produce blocks for the page's transactions
  // ---- trader: connect, swap, add + remove liquidity ----
  const t = await openPage(D.trader);
  t.$('wConnect').click();
  await waitFor(() => !t.$('wInfo').hidden, 30000, 'wallet connect');
  check('wallet connects', true);
  check('pools table shows the 5 pools', (t.$('pBody').textContent.match(/%/g) || []).length >= 5, t.$('pBody').textContent.slice(0, 120));

  set(t.$('sFrom'), 'KOIN'); set(t.$('sTo'), 'vUSDT'); set(t.$('sIn'), '2');
  await waitFor(() => !t.$('sGo').disabled, 10000, 'swap button');
  const usdtBefore = await balance(D.tokens.tUSDT, t.signer.address);
  t.$('sGo').click();
  await waitFor(() => /confirmed/.test(lastAct(t.w).status || ''), 90000, 'swap confirmation');
  const gotUsdt = (await balance(D.tokens.tUSDT, t.signer.address)) - usdtBefore;
  check('swap from the page delivers tokens', gotUsdt > 0n, { tUSDT: Number(gotUsdt) / 1e8 });

  set(t.$('lPool'), 'vETH/vUSDT');
  await sleep(300);
  const p = t.w.KP.pools.find(x => x.A + '/' + x.B === t.$('lPool').value);
  set(t.$('lA'), p.A === 'vETH' ? '0.001' : '30');
  await waitFor(() => !t.$('lGo').disabled, 10000, 'add button');
  t.$('lGo').click();
  await waitFor(() => /Add liquidity/.test(lastAct(t.w).label || '') && /confirmed/.test(lastAct(t.w).status || ''), 90000, 'add confirmation');
  await waitFor(() => t.w.KP.pools.find(x => x.A + '/' + x.B === t.$('lPool').value)?.mine > 0n, 30000, 'shares to show');
  check('add liquidity from the page mints shares', true);

  t.w.document.querySelector('.tabs button[data-t="remove"]').click();
  set(t.$('rPct'), '100');
  await waitFor(() => !t.$('rGo').disabled, 10000, 'remove button');
  t.$('rGo').click();
  await waitFor(() => /Remove/.test(lastAct(t.w).label || '') && /confirmed/.test(lastAct(t.w).status || ''), 90000, 'remove confirmation');
  await waitFor(() => t.w.KP.pools.find(x => x.A + '/' + x.B === t.$('lPool').value)?.mine === 0n, 30000, 'shares to clear');
  check('remove liquidity from the page returns all shares', true);
  check('owner panel hidden for a trader', t.$('ownerBox').hidden);
  check('no page errors (trader)', !t.errors.length, t.errors.slice(0, 3));
  t.close();

  // ---- owner: claim fees, create a pool ----
  const o = await openPage(D.owner);
  o.$('wConnect').click();
  await waitFor(() => !o.$('ownerBox').hidden, 30000, 'owner panel');
  check('owner panel shows for the owner', true);
  const claimBtn = await waitFor(() => o.w.document.querySelector('[data-claim]'), 30000, 'a claim button');
  const key = claimBtn.dataset.claim;
  const [a] = key.split('/');
  const koinBefore = await balance(D.koin, o.signer.address);
  claimBtn.click();
  await waitFor(() => /Claim/.test(lastAct(o.w).label || '') && /confirmed/.test(lastAct(o.w).status || ''), 90000, 'claim confirmation');
  const claimed = (await balance(D.koin, o.signer.address)) - koinBefore;
  check('owner claims fees from the page', a !== 'KOIN' || claimed > 0n, { pool: key, koin: Number(claimed) / 1e8 });

  set(o.$('cA'), 'vUSDT'); set(o.$('cB'), 'vUSDC'); set(o.$('cFee'), '30');
  o.$('cGo').click();
  await waitFor(() => o.w.KP.pools.some(x => (x.A + x.B).includes('vUSDT') && (x.A + x.B).includes('vUSDC')), 90000, 'new pool');
  check('owner creates a pool from the page (vUSDT/vUSDC 0.3%)', true);
  check('no page errors (owner)', !o.errors.length, o.errors.slice(0, 3));
  o.close();
}

main().catch(e => { check('page flow finished', false, String(e.message || e)); }).finally(() => {
  fs.writeFileSync(path.join(__dirname, 'page-report.json'), JSON.stringify({ passed: results.length - failures, failed: failures, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Pools page test: ${results.length - failures} passed, ${failures} failed\n\n` + results.map(r => `- ${r.ok ? '✅' : '❌'} ${r.name}`).join('\n') + '\n');
  console.log(`\npage: ${results.length - failures} passed, ${failures} failed`);
  try { new LocalKoinos().stopNode(); } catch (e) {}
  process.exit(failures ? 1 : 0);
});

// Cross-chain monitor: bridged KOIN (vKOIN) on Ethereum, Base and Solana vs native KOIN on KoinDX.
// Monitor only. Acting on a gap means bridging through Vortex, which has its own fees and gas.
(() => {
  const $ = id => document.getElementById(id);
  const K = () => window.KW;
  const POOLS = [
    { net: 'eth', chain: 'Ethereum', dex: 'Uniswap v4', addr: '0xd833a3afa936ca389966a9ed3a3d9abf7ec45c11b0d575aaaf6ca4d354687da6', fee: 1 },
    { net: 'eth', chain: 'Ethereum', dex: 'Uniswap v3', addr: '0xe447e81e2d7e7ca63a25ac0ee9de835dc6aae79a', fee: 1 },
    { net: 'eth', chain: 'Ethereum', dex: 'Uniswap v4', addr: '0xf3fb8ddbfb8845eb5caf0c7951a7bfc31826f6569ed4408a4d249b4de01b4fb4', fee: 1 },
    { net: 'base', chain: 'Base', dex: 'Uniswap v4', addr: '0x67e2b4bf9917e1ab76bff55dbe125d27858c04bfe77da71b8721d526059859c3', fee: 1 },
    { net: 'solana', chain: 'Solana', dex: 'Raydium', addr: '2kbZSkxa3M7VAWMnZDqBNarkFFBYUyskeavXnq1oK3gT', fee: 1 },
  ];
  const KOINDX_FEE = 0.25;
  let data = [], at = 0, err = null, gas = {}; // gas: USD cost of one swap per chain
  const GAS_UNITS = 180000; // a typical Uniswap swap
  const RPC = { eth: 'https://ethereum-rpc.publicnode.com', base: 'https://base-rpc.publicnode.com' };
  async function gasPrices(ethUsd) {
    const out = { solana: 0.002 };
    await Promise.all(Object.entries(RPC).map(async ([net, url]) => {
      try {
        const j = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) })).json();
        out[net] = Number(BigInt(j.result)) / 1e18 * GAS_UNITS * ethUsd;
      } catch (e) {}
    }));
    return out;
  }
  // Rough most-you-could-make by trading against one pool until its price meets Koinos (constant-product estimate;
  // concentrated-liquidity pools can differ). netGap as a fraction, after fees.
  const maxProfit = (liqUsd, netGap) => netGap > 0 ? (liqUsd / 2) * (Math.sqrt(1 + netGap) - 1) ** 2 : 0;

  async function load() {
    err = null;
    try {
      const byNet = {};
      for (const p of POOLS) (byNet[p.net] ||= []).push(p.addr);
      const results = {};
      await Promise.all(Object.entries(byNet).map(async ([net, addrs]) => {
        const r = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/multi/${addrs.join(',')}`)).json();
        for (const d of r.data || []) results[d.attributes.address.toLowerCase()] = d.attributes;
      }));
      let ethUsd = 0;
      for (const a of Object.values(results)) if (/vKOIN \/ WETH/i.test(a.name || '')) ethUsd = +a.quote_token_price_usd;
      gas = ethUsd ? await gasPrices(ethUsd) : {};
      data = POOLS.map(p => {
        const a = results[p.addr.toLowerCase()];
        if (!a) return { ...p, missing: true };
        const vFirst = /^vKOIN/i.test(a.name || '');
        return { ...p, name: a.name, price: +(vFirst ? a.base_token_price_usd : a.quote_token_price_usd), liq: +a.reserve_in_usd || 0, vol: +(a.volume_usd && a.volume_usd.h24) || 0 };
      });
      at = Date.now();
    } catch (e) { console.error(e); err = 'Could not load bridged prices right now. Retrying in 2 minutes.'; }
    render();
  }

  function render() {
    const k = K(); if (!k) return;
    const native = window.KC.koinUsd;
    $('xNative').textContent = native ? `$${native.toFixed(5)}` : '—';
    $('xStatus').textContent = err || (at ? `Updated ${new Date(at).toLocaleTimeString()} · refreshes every 2 minutes` : 'Loading…');
    if (!native || !data.length) { $('xBody').innerHTML = ''; return; }
    let best = null;
    $('xBody').innerHTML = data.map(p => {
      if (p.missing) return `<tr><td>${k.esc(p.chain)}</td><td>${k.esc(p.dex)}</td><td colspan="7" class="mute">No data</td></tr>`;
      const gap = (p.price / native - 1) * 100;
      const net = Math.abs(gap) - p.fee - KOINDX_FEE;
      const g = gas[p.net];
      const prof = maxProfit(p.liq, net / 100) - (g || 0) * 2;
      if (p.liq >= 1000 && (!best || net > best.net)) best = { ...p, gap, net };
      const url = `https://www.geckoterminal.com/${p.net}/pools/${p.addr}`;
      return `<tr><td>${k.esc(p.chain)}</td><td><a href="${url}" target="_blank" rel="noopener">${k.esc(p.name || p.dex)}</a></td>
        <td>$${p.price.toFixed(5)}</td><td class="${gap >= 0 ? 'up' : 'down'}">${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%</td>
        <td class="${net > 0 ? 'up' : 'mute'}">${net > 0 ? '+' + net.toFixed(2) + '%' : 'none'}</td>
        <td class="${prof > 0.5 ? 'up' : 'mute'}">${prof > 0.01 ? '≈ $' + k.fmt(prof, 2) : '—'}</td>
        <td>${g != null ? '$' + (g < 0.01 ? '<0.01' : k.fmt(g, 2)) : '—'}</td>
        <td>$${k.fmt(p.liq, 0)}</td><td>$${k.fmt(p.vol, 0)}</td></tr>`;
    }).join('');
    const h = $('xHeadline');
    if (best && best.net > 0) {
      const dir = best.gap > 0 ? `KOIN is ${best.gap.toFixed(2)}% more expensive on ${best.chain}. Buy KOIN on Koinos, bridge it with Vortex, and sell it there.` : `KOIN is ${(-best.gap).toFixed(2)}% cheaper on ${best.chain}. Buy vKOIN there, bridge it to Koinos with Vortex, and keep the extra KOIN.`;
      h.innerHTML = `<b class="up">About ${best.net.toFixed(2)}% gap after pool fees.</b> ${k.esc(dir)} Bridge fees and gas are not included, so small gaps usually aren't worth it.`;
    } else {
      h.innerHTML = 'No gap bigger than the trading fees right now. Prices on other chains are in line with Koinos.';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.KC.hooks.push(render);
    load();
    setInterval(() => { if (!document.hidden) load(); }, 120000);
  });
})();

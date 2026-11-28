// Bot dashboard: reads the bot's heartbeat (bot-status branch) and pool fees from chain. Read-only.
(() => {
  const REPO = 'bawcejawn/Koin-chart';
  const RAW = `https://raw.githubusercontent.com/${REPO}/bot-status/`;
  const $ = id => document.getElementById(id);
  const fmt = (x, d = 2) => x == null || isNaN(x) ? '—' : (+x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tile = (v, l) => `<div class="tile"><b>${v}</b><span>${esc(l)}</span></div>`;
  const ago = ms => { const m = Math.round(ms / 60e3); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

  $('pauseBtn').href = `https://github.com/${REPO}/issues/new?labels=pause-bot&title=${encodeURIComponent('PAUSE BOT')}&body=${encodeURIComponent('The bot stops trading while this issue is open. Close it to resume.')}`;
  $('resumeBtn').href = `https://github.com/${REPO}/issues?q=${encodeURIComponent('is:issue is:open label:pause-bot')}`;

  async function getStatus() {
    const r = await fetch(RAW + 'status.json?t=' + Date.now());
    if (!r.ok) throw new Error('no status yet');
    return r.json();
  }
  async function getHistory() {
    try { const t = await (await fetch(RAW + 'history.jsonl?t=' + Date.now())).text(); return t.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; }
  }
  function renderState(s) {
    const age = Date.now() - new Date(s.at).getTime();
    const quiet = age > 45 * 60e3;
    const lag = s.node && s.node.lagSec;
    let cls = 'ok', text = 'Running';
    if (s.paused) { cls = 'warn'; text = 'Paused'; }
    if (quiet) { cls = 'bad'; text = 'Quiet: no report for ' + ago(age).replace(' ago', ''); }
    else if (lag != null && lag > 90) { cls = 'warn'; text = `Node behind by ${lag}s`; }
    $('stateLine').className = 'state ' + cls; $('stateLine').textContent = text;
    $('stateNote').textContent = `Reports every 30 minutes. Node: ${s.node ? `${s.node.url || ''} at block ${s.node.height}` : 'unknown'}.`;
    $('hState').textContent = text.split(':')[0]; $('hAge').textContent = ago(age); $('hMode').textContent = s.mode;
  }
  function renderNow(s) {
    $('now').innerHTML = [tile(fmt(s.koin), 'KOIN in the bot'), tile(fmt(s.vhp), 'VHP waiting to send'), tile(fmt(s.mana), 'Mana (KOIN)'),
      tile(fmt(s.totals && s.totals.extraVhpVsBurn), 'Extra VHP vs burning (since start)'), tile(fmt(s.totals && s.totals.loopProfitKoin, 4), 'Loop profit KOIN (since start)'),
      tile(s.totals ? s.totals.errors : '—', 'Errors since start')].join('');
    const t = s.today || {};
    $('day').innerHTML = [tile(t.buys ?? '—', 'VHP buys'), tile(fmt(t.koinOnVhp), 'KOIN spent on VHP'), tile('+' + fmt(t.extraVhp), 'VHP gained vs burning'),
      tile(fmt(t.vhpSent), 'VHP sent to producer'), tile(t.loops ?? '—', 'Loops'), tile('+' + fmt(t.loopProfit, 4), 'Loop profit KOIN')].join('');
  }
  function renderSpark(h) {
    const pts = h.filter(x => x.koin != null);
    if (pts.length < 2) { $('spark').innerHTML = ''; $('sparkNote').textContent = 'Not enough reports yet.'; return; }
    const xs = pts.map(p => new Date(p.at).getTime()), ys = pts.map(p => p.koin);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys) || 1;
    const X = x => ((x - x0) / Math.max(1, x1 - x0)) * 596 + 2, Y = y => 116 - ((y - y0) / Math.max(1e-9, y1 - y0)) * 108;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('');
    $('spark').innerHTML = `<path d="${d}" fill="none" stroke="var(--acc)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    $('sparkNote').textContent = `Low ${fmt(y0)} · high ${fmt(y1)} KOIN · ${pts.length} reports`;
  }
  async function renderFees() {
    const C = window.POOLS_CONFIG || {};
    if (!C.contract) return;
    try {
      const provider = new Provider([C.rpc]);
      const pool = new Contract({ id: C.contract, abi: POOL_ABI, provider });
      const T = Object.fromEntries(C.tokens.map(t => [t.sym, t]));
      const sym = id => (C.tokens.find(t => t.id === id) || {}).sym || id.slice(0, 6);
      const rows = [];
      for (const [a, b] of C.pairs) {
        const { result: r } = await pool.functions.get_pool({ token_a: T[a].id, token_b: T[b].id });
        if (!r || !r.exists) continue;
        rows.push(`<tr><td>${sym(r.token_a)}/${sym(r.token_b)}</td><td>${fmt(Number(r.owner_fees_a || 0) / 1e8, 6)} ${sym(r.token_a)}</td><td>${fmt(Number(r.owner_fees_b || 0) / 1e8, 6)} ${sym(r.token_b)}</td></tr>`);
      }
      $('fees').innerHTML = rows.join('') || '<tr><td class="empty">No pools yet.</td></tr>';
    } catch (e) { $('fees').innerHTML = '<tr><td class="empty">Could not read the pools right now.</td></tr>'; }
  }
  async function refresh() {
    try { const s = await getStatus(); renderState(s); renderNow(s); }
    catch (e) { $('stateLine').className = 'state warn'; $('stateLine').textContent = 'No report from the bot yet'; $('stateNote').textContent = 'The bot publishes its first report a few seconds after it starts (it needs a GitHub token in config.json on your PC; the paper test uses GitHub\'s own).'; }
    renderSpark(await getHistory());
  }
  refresh(); renderFees();
  setInterval(refresh, 60e3);
})();

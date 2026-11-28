// Sends the bot's emails through GitHub: the bot fires a repository_dispatch event, and the
// "Bot notifications" workflow posts it as an issue/comment from github-actions, which emails you.
// Needs a GitHub token (config.github.token or env GITHUB_TOKEN) that can write to the repo's contents.
// Without a token it just logs what it would have sent.
const fs = require('fs');
const path = require('path');

class Notifier {
  constructor(cfg, log, dataDir) {
    const g = cfg.github || {};
    this.token = g.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    this.repo = g.repo || process.env.GITHUB_REPOSITORY || 'bawcejawn/Koin-chart';
    this.log = log;
    this.stateFile = path.join(dataDir, 'notify-state.json');
    try { this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch (e) { this.state = {}; }
    this.fetch = globalThis.fetch;
  }
  save() { try { fs.writeFileSync(this.stateFile, JSON.stringify(this.state)); } catch (e) {} }

  // at most once per `everyMs` for the same key
  async send(kind, key, title, body, everyMs = 0, { quiet = false } = {}) {
    const last = this.state['k:' + key] || 0;
    if (everyMs && Date.now() - last < everyMs) return false;
    this.state['k:' + key] = Date.now(); this.save();
    if (!this.token) { if (!quiet) this.log(`(email not sent, no GitHub token) ${title}`); return false; }
    const r = await this.fetch(`https://api.github.com/repos/${this.repo}/dispatches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'koin-chart-bot' },
      body: JSON.stringify({ event_type: `bot-${kind}`, client_payload: { title, body: body.slice(0, 60000), key } }),
    });
    if (!r.ok) { this.log(`email dispatch failed: HTTP ${r.status}`); return false; }
    if (!quiet) this.log(`email queued: ${title}`);
    return true;
  }

  // true once per day when the local time in `tz` reaches `hour`
  dailyDue(hour = 8, tz = 'America/New_York', now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (+parts.hour < hour || this.state.dailyDay === day) return null;
    this.state.dailyDay = day; this.save();
    return day;
  }
}

// Summarise ledger entries from the last 24 hours
function dailyReport(ledgerFile, summary, extra = {}) {
  const since = Date.now() - 864e5;
  let rows = [];
  try { rows = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => new Date(r.t).getTime() >= since); } catch (e) {}
  const sum = (kind, f) => rows.filter(r => r.kind === kind).reduce((a, r) => a + (+r[f] || 0), 0);
  const n = kind => rows.filter(r => r.kind === kind).length;
  const fmt = x => (+x).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const buys = n('vhp-buy'), koinIn = sum('vhp-buy', 'koinIn'), vhpOut = sum('vhp-buy', 'vhpOut');
  const loops = n('loop'), loopProfit = sum('loop', 'profit');
  const lines = [
    `**Last 24 hours** (${extra.mode || 'paper'} mode)`,
    '',
    '| | |', '|---|---|',
    `| VHP buys | ${buys} |`,
    `| KOIN spent on VHP | ${fmt(koinIn)} |`,
    `| VHP bought | ${fmt(vhpOut)} (**+${fmt(vhpOut - koinIn)}** vs burning) |`,
    `| VHP sent to producer | ${fmt(sum('vhp-sweep', 'vhp'))} |`,
    `| Loops | ${loops} (**+${fmt(loopProfit)}** KOIN) |`,
    `| Net KOIN (loops − VHP buys) | ${fmt(loopProfit - koinIn)} |`,
    `| Top-ups needed | ${n('paper-refill') + n('topup-needed')} |`,
    `| Skipped (sources disagreed) | ${n('verify-fail')} |`,
  ];
  if (extra.balances) lines.push('', `Bot now holds **${fmt(extra.balances.koin)} KOIN** and ${fmt(extra.balances.vhp)} VHP.`);
  if (extra.ownerFees && extra.ownerFees.length) lines.push('', 'Unclaimed owner fees in your pools: ' + extra.ownerFees.map(f => `${f.pair}: ${f.text}`).join(', '));
  lines.push('', `Since start: ${summary.buys} buys, +${fmt(summary.extraVhpVsBurn)} VHP vs burning, ${summary.loops} loops, +${fmt(summary.loopProfitKoin)} KOIN, ${summary.errors} errors.`);
  return lines.join('\n');
}

module.exports = { Notifier, dailyReport };

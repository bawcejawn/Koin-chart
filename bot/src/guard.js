// Process-level safety: one bot at a time, and a remote pause you can trigger from your phone.
const fs = require('fs');
const path = require('path');

// Single-instance lock: refuses to start if another bot process with a live PID holds the lock.
function acquireLock(dir) {
  const file = path.join(dir, 'bot.lock');
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (old.pid && old.pid !== process.pid && alive(old.pid)) {
      throw new Error(`Another bot is already running (PID ${old.pid}, started ${old.at}). Close it first, or delete ${file} if it is not running.`);
    }
  } catch (e) { if (/already running/.test(e.message)) throw e; }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const release = () => { try { const cur = JSON.parse(fs.readFileSync(file, 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(file); } catch (e) {} };
  process.on('exit', release);
  return { file, release };
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// Remote pause: an OPEN issue in the repo carrying the "pause-bot" label pauses trading.
// Only people with write access can put labels on an issue, so strangers can't pause your bot.
// Reads the public GitHub API (no token needed; 60 requests/hour is plenty at one check every 2 minutes).
class RemotePause {
  constructor(repo, token, everyMs = 120e3) {
    this.repo = repo; this.token = token; this.everyMs = everyMs;
    this.paused = false; this.reason = ''; this.checkedAt = 0;
    this.fetch = globalThis.fetch;
  }
  async check() {
    if (Date.now() - this.checkedAt < this.everyMs) return this.paused;
    this.checkedAt = Date.now();
    try {
      const headers = { accept: 'application/vnd.github+json', 'user-agent': 'koin-chart-bot' };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      const r = await this.fetch(`https://api.github.com/repos/${this.repo}/issues?labels=pause-bot&state=open&per_page=1`, { headers });
      if (!r.ok) return this.paused; // keep the last known state if GitHub is unreachable
      const list = await r.json();
      this.paused = Array.isArray(list) && list.length > 0;
      this.reason = this.paused ? `issue #${list[0].number} "${list[0].title}"` : '';
    } catch (e) { /* keep last state */ }
    return this.paused;
  }
}

module.exports = { acquireLock, RemotePause, alive };

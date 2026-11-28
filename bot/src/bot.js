// Koin-chart trading bot.
// - Buys VHP in the KoinDX pool when it beats burning by >= minEdgePct, at the size that gives the most extra VHP,
//   always keeping reserveKoin in the wallet, then sends all VHP to the producer address.
// - Runs loss-proof loop trades (one transaction, minimum return >= amount in).
// - "paper" mode reads the real chain and records what it would do, without signing anything.
const fs = require('fs');
const path = require('path');
const { makeChain, loadSigner, ADDR, LoopCore, isOwn, ownParts } = require('./chain');
const { Notifier, dailyReport, monthlyReport } = require('./notify');
const { RemotePause } = require('./guard');

const E8 = 100000000n;
const toK = raw => Number(raw) / 1e8;
const fromK = x => BigInt(Math.floor(x * 1e8));
const nowIso = () => new Date().toISOString();

class Bot {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.chain = opts.chain || makeChain(cfg.rpc, cfg.verifyRpc || []);
    this.live = cfg.mode === 'live';
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.signer = this.live ? (opts.signer || loadSigner(opts.wif || readKey(cfg))) : null;
    this.address = this.live ? this.signer.getAddress() : 'PAPER';
    this.paper = { koin: fromK(cfg.paper.startKoin), vhp: 0n, sentVhp: 0n };
    this.shadow = new Map(); // paper mode: pool -> {realA, realB, simA, simB}
    this.lastHeight = 0;
    this.lastLoopScan = 0;
    this.busy = false;
    this.lowWarned = 0;
    this.notifier = opts.notifier || new Notifier(cfg, (m) => this.log(m), this.dataDir);
    this.stopFile = opts.stopFile || path.join(__dirname, '..', 'STOP');
    this.remotePause = opts.remotePause || (cfg.remotePause === false ? null : new RemotePause((cfg.github && cfg.github.repo) || 'bawcejawn/Koin-chart', this.notifier.token));
    this.stats = { buys: 0, koinSpent: 0n, vhpGot: 0n, loops: 0, loopProfit: 0n, skipped: 0, errors: 0, startedAt: nowIso() };
  }

  log(msg, extra) {
    const line = `[${nowIso()}] ${this.live ? 'LIVE ' : 'PAPER'} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
    console.log(line);
    fs.appendFileSync(path.join(this.dataDir, 'bot.log'), line + '\n');
  }
  // same message at most once per `everyMs` (keeps the log readable when nothing changes)
  logEvery(key, everyMs, msg, extra) {
    this.quiet = this.quiet || new Map();
    const last = this.quiet.get(key) || 0;
    if (Date.now() - last < everyMs) return;
    this.quiet.set(key, Date.now());
    this.log(msg, extra);
  }
  record(entry) {
    fs.appendFileSync(path.join(this.dataDir, 'ledger.jsonl'), JSON.stringify({ t: nowIso(), mode: this.cfg.mode, ...entry }, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
  }

  // ---- reserves, with paper-mode shadowing so a pretend trade "moves" the pool until a real trade does ----
  async reserves(pair) {
    const real = await this.chain.reserves(pair);
    const s = this.shadow.get(pair);
    if (!s) return real;
    if (s.realA === real.a && s.realB === real.b) return { a: s.simA, b: s.simB };
    // Someone else traded the real pool. Our pretend trade would still be in it, so apply their
    // change on top of our shadow instead of forgetting it (otherwise paper re-buys the same edge).
    const a = s.simA + (real.a - s.realA), b = s.simB + (real.b - s.realB);
    const next = { realA: real.a, realB: real.b, simA: a > 1n ? a : 1n, simB: b > 1n ? b : 1n };
    this.shadow.set(pair, next);
    return { a: next.simA, b: next.simB };
  }
  shadowTrade(pair, realBefore, simAfter) {
    if (this.live) return;
    this.shadow.set(pair, { realA: realBefore.a, realB: realBefore.b, simA: simAfter.a, simB: simAfter.b });
  }

  // ---- wallet ----
  async wallet() {
    if (!this.live) return { koin: this.paper.koin, vhp: this.paper.vhp, mana: this.paper.koin };
    const [koin, vhp, mana] = await Promise.all([
      this.chain.balance('koin', this.address), this.chain.balance('vhp', this.address), this.chain.mana(this.address),
    ]);
    return { koin, vhp, mana };
  }
  // KOIN the bot may spend now: keep the reserve, and KOIN can only move with its mana (minus ~2 KOIN for the tx itself)
  spendable(w) {
    const reserve = fromK(this.cfg.reserveKoin);
    const byBalance = w.koin - reserve;
    // keep enough mana for the next transactions (the VHP transfer, a loop) after this one
    const byMana = w.mana - fromK(this.cfg.manaReserveKoin ?? 5);
    const s = byBalance < byMana ? byBalance : byMana;
    return s > 0n ? s : 0n;
  }

  // Cross-check the pools we are about to trade against the other nodes. A bad read can never lose money
  // (every trade carries an on-chain minimum return), but this stops us even trying on a wrong price.
  async verified(pairs, reals, what) {
    const v = await this.chain.verify(pairs, reals, this.cfg.verifyNeed || 1);
    if (v.ok) return true;
    this.stats.skipped++;
    this.record({ kind: 'verify-fail', what, sources: v.sources, bad: v.bad });
    this.logEvery('verify:' + what, 300e3, `SKIP ${what}: nodes disagree on pool reserves (${v.bad.length} mismatches, ${v.sources} sources)`);
    return false;
  }

  // Permission for `spender` (KoinDX router or our pool) to move exactly `value` of `token` to `to` in this transaction.
  // With the Bot Guard on: a one-time guard allowance (nothing else can move the bot's tokens).
  // Without it: an exact-amount approve on the token.
  async spendOp(token, spender, to, value) {
    if (this.guardOn) return this.chain.guardAllowanceOp(this.address, token, spender, to, value);
    return this.chain.approveOp(token, this.address, value, spender);
  }

  unlistedAllowed() {
    return !!(this.cfg.loops.includeUnlisted && (!this.live || this.guardOn));
  }

  stopped() {
    if (this.cfg.paused || fs.existsSync(this.stopFile)) {
      this.logEvery('stopped', 600e3, `STOPPED: ${this.cfg.paused ? '"paused": true in config' : 'STOP file present'} - not trading. Delete the STOP file (or run resume-bot.bat) to resume.`);
      return true;
    }
    return false;
  }

  // ---- strategy 1: buy VHP below burn ----
  async vhpCheck() {
    const c = this.cfg.vhp;
    if (!c.enabled) return;
    const real = await this.chain.reserves(ADDR.VHP_PAIR);
    const r = await this.reserves(ADDR.VHP_PAIR); // a = VHP, b = KOIN
    const edgePct = (Number(r.a) * 0.9975 / Number(r.b) - 1) * 100;
    if (edgePct < c.minEdgePct) return;
    const w = await this.wallet();
    const cap = this.spendable(w);
    const hop = [{ rin: r.b, rout: r.a }];
    const best = LoopCore.bestSize(hop, r.b);
    const amountIn = best.amountIn < cap ? best.amountIn : cap;
    if (this.live && best.amountIn > cap + E8) {
      const short = best.amountIn - cap;
      const extra = (LoopCore.simulate(hop, best.amountIn) - best.amountIn) - (LoopCore.simulate(hop, cap) - cap);
      this.notifier.send('alert', 'shortfall', `Bot needs ${Math.ceil(toK(short)).toLocaleString('en-US')} more KOIN for a +${edgePct.toFixed(1)}% VHP buy`,
        `The best VHP buy right now is **${toK(best.amountIn).toFixed(2)} KOIN** (edge +${edgePct.toFixed(2)}%), but the bot can spend **${toK(cap).toFixed(2)} KOIN**.\n\nTopping up **${toK(short).toFixed(2)} KOIN** would get about **+${toK(extra).toFixed(2)} more VHP** vs burning. Send KOIN to \`${this.address}\`, or take it yourself: https://bawcejawn.github.io/Koin-chart/#buy`, 2 * 3600e3).catch(() => {});
    }
    if (amountIn < fromK(c.minTradeKoin)) {
      this.stats.skipped++;
      if (!this.live && this.cfg.paper.autoRefill) {
        // paper test: pretend the owner topped the bot up, so a 2-day test measures every opportunity
        const target = fromK(this.cfg.paper.startKoin);
        const added = target - this.paper.koin;
        this.paper.koin = target;
        this.stats.refills = (this.stats.refills || 0) + 1;
        this.stats.refilledKoin = (this.stats.refilledKoin || 0n) + added;
        this.record({ kind: 'paper-refill', koinAdded: toK(added), edgePct: +edgePct.toFixed(3) });
        this.log(`(paper) top-up needed: refilled ${toK(added).toFixed(2)} KOIN back to ${this.cfg.paper.startKoin} (refill #${this.stats.refills})`);
        return;
      }
      return this.logEvery('topup', 600e3, `VHP edge ${edgePct.toFixed(2)}% but only ${toK(cap).toFixed(2)} KOIN spendable (reserve ${this.cfg.reserveKoin} KOIN). Top up the bot.`);
    }
    const out = LoopCore.simulate(hop, amountIn);
    if (out <= amountIn) return;
    const slip = BigInt(Math.round(c.slippagePct * 100));
    let minOut = out * (10000n - slip) / 10000n;
    if (minOut <= amountIn) minOut = amountIn + 1n; // never accept less than burning would give
    const info = { edgePct: +edgePct.toFixed(3), koinIn: toK(amountIn), vhpOut: toK(out), extraVhp: toK(out - amountIn), minOut: toK(minOut) };
    if (!(await this.verified([ADDR.VHP_PAIR], [real], 'VHP buy'))) return;
    if (this.live) {
      const ops = [];
      ops.push(await this.spendOp('koin', ADDR.PERIPHERY, ADDR.VHP_PAIR, amountIn));
      ops.push(await this.chain.swapOp(this.address, amountIn, minOut, ['koin', 'vhp']));
      const tx = await this.chain.send(this.signer, ops);
      info.tx = tx.id;
    } else {
      this.paper.koin -= amountIn; this.paper.vhp += out;
      this.shadowTrade(ADDR.VHP_PAIR, real, { a: r.a - out, b: r.b + amountIn });
    }
    this.stats.buys++; this.stats.koinSpent += amountIn; this.stats.vhpGot += out;
    this.log(`BUY VHP: ${info.koinIn.toFixed(4)} KOIN -> ${info.vhpOut.toFixed(4)} VHP (+${info.extraVhp.toFixed(4)} vs burning, edge ${info.edgePct}%)`, info.tx ? { tx: info.tx } : undefined);
    this.record({ kind: 'vhp-buy', ...info });
    await this.sweepVhp();
  }

  // send all VHP to the producer address
  async sweepVhp() {
    const w = await this.wallet();
    if (w.vhp < fromK(this.cfg.vhp.sweepMinVhp)) return;
    const to = this.cfg.producerAddress;
    if (this.live) {
      const tx = await this.chain.send(this.signer, [await this.chain.transferOp('vhp', this.address, to, w.vhp)]);
      this.log(`SENT ${toK(w.vhp).toFixed(4)} VHP to producer ${to}`, { tx: tx.id });
      this.record({ kind: 'vhp-sweep', vhp: toK(w.vhp), to, tx: tx.id });
    } else {
      this.paper.sentVhp += w.vhp; this.paper.vhp = 0n;
      this.log(`(paper) would send ${toK(w.vhp).toFixed(4)} VHP to producer ${to}`);
      this.record({ kind: 'vhp-sweep', vhp: toK(w.vhp), to });
    }
  }

  // ---- strategy 2: loss-proof loops (KoinDX pairs and our own pools) ----
  // Biggest margin first, then trade the next one down, until no loop pays: one scan runs up to
  // maxRounds loops back to back, each re-reading the live (or paper-shadow) reserves.
  async loopCheck(round = 0) {
    const c = this.cfg.loops;
    if (!c.enabled) return;
    if (round === 0) {
      if (Date.now() - this.lastLoopScan < c.scanEverySec * 1000) return;
      this.lastLoopScan = Date.now();
      const [koindx, listed] = await Promise.all([fetchPairs(), fetchListed()]);
      this.scan = { koindx, listed };
    }
    const { koindx, listed } = this.scan;
    const own = this.cfg.ownPools && this.cfg.ownPools.contract ? await this.chain.ownPools(this.cfg.ownPools.contract, this.cfg.ownPools.pairs || []) : [];
    const ownTokens = new Set(own.flatMap(p => [p.t0, p.t1]));
    // Unlisted tokens run their own code inside our signed transaction. Live trading only allows them
    // once the Bot Guard is on the bot's address (it blocks any contract but the router/our pool from moving funds).
    const unlistedOk = this.unlistedAllowed();
    const known = id => listed.has(id) || ownTokens.has(id) || (c.allowTokens || []).includes(id);
    const allow = id => unlistedOk || known(id);
    const cands = LoopCore.findLoops([...koindx, ...own], c.starts, { maxHops: 4, minEdge: 1.003, minUsd: c.minPoolUsd, allowToken: allow })
      .map(l => ({ l, est: LoopCore.estimate(l) })).filter(x => x.est.profit > 0n)
      .sort((x, y) => (y.est.profit > x.est.profit ? 1 : -1)).slice(0, 12);
    if (!cands.length) return;
    const w = await this.wallet();
    let best = null;
    for (const { l } of cands) {
      const hops = [], reals = [];
      for (const e of l.edges) {
        const real = await this.chain.reserves(e.p.id);
        const r = await this.reserves(e.p.id);
        const fwd = (await this.chain.token0(e.p.id)) === (e.from === 'koin' ? ADDR.KOIN : e.from === 'vhp' ? ADDR.VHP : e.from);
        hops.push({ rin: fwd ? r.a : r.b, rout: fwd ? r.b : r.a, fwd, pool: e.p.id, venue: e.p.venue, feeBps: e.p.feeBps, from: e.from, to: e.to });
        reals.push(real);
      }
      const cap = l.start === 'koin' ? this.spendable(w) : w.vhp;
      if (cap <= 0n) continue;
      const b = LoopCore.bestSize(hops, hops[0].rin < cap ? hops[0].rin : cap);
      if (b.profit < fromK(c.minProfitKoin)) continue;
      const plan = this.planSegments(hops, b.amountIn);
      if (!plan || plan.profit < fromK(c.minProfitKoin)) continue;
      if (!best || plan.profit > best.plan.profit) best = { l, hops, reals, b, plan };
    }
    if (!best) return;
    const { l, hops, reals, plan } = best;
    const pathIds = [l.start, ...l.edges.map(e => e.to)];
    const keep = BigInt(Math.round(c.keepProfitPct * 100));
    let minOut = plan.amountIn + plan.profit * keep / 10000n;
    if (minOut <= plan.amountIn) minOut = plan.amountIn + 1n;
    const unlisted = pathIds.filter(t => !known(t));
    const info = { unlisted: unlisted.length ? [...new Set(unlisted)] : undefined, path: pathIds, venues: plan.segs.map(sg => sg.venue), amountIn: toK(plan.amountIn), amountOut: toK(plan.amountOut), profit: toK(plan.profit), minOut: toK(minOut) };
    if (!(await this.verified(hops.map(h => h.pool), reals, 'loop ' + pathIds.join('>')))) return;
    if (this.live) {
      const ops = [];
      plan.segs.forEach((sg, i) => { sg.minOut = i === plan.segs.length - 1 ? minOut : sg.minOut; });
      for (const sg of plan.segs) {
        const spender = sg.venue === 'own' ? ownParts(sg.pool).c : ADDR.PERIPHERY;
        ops.push(await this.spendOp(sg.tokens[0], spender, sg.venue === 'own' ? spender : sg.hops[0].pool, sg.amountIn));
        ops.push(sg.venue === 'own'
          ? await this.chain.ownSwapOp(spender, this.address, sg.tokens[0], sg.tokens[1], sg.amountIn, sg.minOut)
          : await this.chain.swapOp(this.address, sg.amountIn, sg.minOut, sg.tokens));
      }
      const tx = await this.chain.send(this.signer, ops);
      info.tx = tx.id;
    } else {
      // move each pool in the shadow book
      let x = plan.amountIn;
      hops.forEach((h, i) => {
        const out = LoopCore.hopOut(h, x);
        const nin = h.rin + x, nout = h.rout - out;
        this.shadowTrade(h.pool, reals[i], h.fwd ? { a: nin, b: nout } : { a: nout, b: nin });
        x = out;
      });
      if (l.start === 'koin') this.paper.koin += plan.profit; else this.paper.vhp += plan.profit;
    }
    this.stats.loops++; this.stats.loopProfit += plan.profit;
    this.log(`LOOP ${pathIds.join('>')} [${info.venues.join('+')}]: ${info.amountIn.toFixed(4)} -> ${info.amountOut.toFixed(4)} (+${info.profit.toFixed(4)})`, info.tx ? { tx: info.tx } : undefined);
    this.record({ kind: 'loop', ...info, round });
    if (round + 1 < (c.maxRounds ?? 10)) return this.loopCheck(round + 1);
  }

  // Split a loop into one swap per venue run: consecutive KoinDX hops go through the router in one call,
  // each of our pools is its own swap. Every segment but the last passes on only its guaranteed minimum,
  // so the next swap never asks for more than we are sure to have. All in one transaction: if any part
  // returns less than its minimum, the whole thing reverts and nothing is traded.
  planSegments(hops, amountIn) {
    const slip = BigInt(Math.round((this.cfg.loops.segmentSlippagePct ?? 0.3) * 100));
    const segs = [];
    for (const h of hops) {
      const venue = h.venue === 'own' ? 'own' : 'koindx';
      const last = segs[segs.length - 1];
      if (venue === 'koindx' && last && last.venue === 'koindx') { last.hops.push(h); last.tokens.push(h.to); }
      else segs.push({ venue, pool: h.pool, hops: [h], tokens: [h.from, h.to] });
    }
    let x = amountIn;
    segs.forEach((sg, i) => {
      sg.amountIn = x;
      sg.expected = LoopCore.simulate(sg.hops, x);
      sg.minOut = i === segs.length - 1 ? sg.expected : sg.expected * (10000n - slip) / 10000n;
      x = sg.minOut;
    });
    if (segs.length === 1) return { segs, amountIn, amountOut: segs[0].expected, profit: segs[0].expected - amountIn };
    const out = segs[segs.length - 1].expected;
    return { segs, amountIn, amountOut: out, profit: out - amountIn };
  }

  async lowBalanceCheck() {
    const w = await this.wallet();
    const low = fromK(this.cfg.lowBalanceKoin);
    const lowMana = w.mana < fromK(this.cfg.lowManaKoin ?? 50);
    if (lowMana && w.koin >= low && Date.now() - (this.manaWarned || 0) > 6 * 3600e3) {
      this.manaWarned = Date.now();
      // mana refills by itself over ~5 days; adding KOIN adds mana right away, so treat it like a top-up
      await this.notifier.send('alert', 'mana', `Bot is low on mana: ${toK(w.mana).toFixed(0)} left`,
        `The bot has **${toK(w.koin).toFixed(2)} KOIN** but only **${toK(w.mana).toFixed(2)}** of it is spendable mana right now, so it can't make big trades. Mana recharges on its own over about 5 days, or send KOIN to \`${this.address}\` to add mana immediately.`, 24 * 3600e3);
    }
    if (w.koin < low && Date.now() - this.lowWarned > 6 * 3600e3) {
      this.lowWarned = Date.now();
      this.log(`LOW BALANCE: ${toK(w.koin).toFixed(2)} KOIN (warn below ${this.cfg.lowBalanceKoin}). Top up the bot address ${this.address}.`);
      this.record({ kind: 'topup-needed', koin: toK(w.koin) });
      await this.notifier.send('alert', 'low', `Bot needs KOIN: ${toK(w.koin).toFixed(0)} left`,
        `The bot has **${toK(w.koin).toFixed(2)} KOIN** (alert below ${this.cfg.lowBalanceKoin}). Refill to ${this.cfg.refillToKoin || 30000} by sending KOIN to \`${this.address}\`.`, 24 * 3600e3);
    }
  }

  summary() {
    const s = this.stats;
    return {
      since: s.startedAt, buys: s.buys, koinSpent: toK(s.koinSpent), vhpGot: toK(s.vhpGot), extraVhpVsBurn: toK(s.vhpGot - s.koinSpent),
      loops: s.loops, loopProfitKoin: toK(s.loopProfit), skipped: s.skipped, errors: s.errors, refills: s.refills || 0, refilledKoin: toK(s.refilledKoin || 0n),
      ...(this.live ? {} : { paperKoin: toK(this.paper.koin), paperVhpSent: toK(this.paper.sentVhp) }),
    };
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.stopped()) return;
      if (this.remotePause && await this.remotePause.check()) {
        this.logEvery('remote-pause', 600e3, `PAUSED from GitHub (${this.remotePause.reason}). Close that issue to resume.`);
        return;
      }
      const h = await this.chain.head();
      if (h.height === this.lastHeight) return;
      this.lastHeight = h.height;
      await this.vhpCheck();
      await this.loopCheck();
    } catch (e) {
      this.stats.errors++;
      this.logEvery('err:' + String(e && e.message ? e.message : e).slice(0, 60), 300e3, 'error: ' + (e && e.message ? e.message : e));
    } finally { this.busy = false; }
  }

  async run() {
    this.log(`started. address=${this.address} producer=${this.cfg.producerAddress} reserve=${this.cfg.reserveKoin} KOIN minEdge=${this.cfg.vhp.minEdgePct}%`);
    if (this.live) {
      this.guardOn = await this.chain.guardActive(this.address);
      this.log(this.guardOn ? 'Bot Guard is ON: only the exact amounts the bot approves per trade can leave this address.'
        : 'Bot Guard is OFF: trading listed tokens only. Run install-guard.bat to turn it on.');
      await this.lowBalanceCheck();
    }
    setInterval(() => this.tick(), this.cfg.pollMs);
    setInterval(() => { this.log('summary', this.summary()); this.writeSummary(); }, 3600e3);
    if (this.live) setInterval(() => this.lowBalanceCheck().catch(() => {}), 600e3);
    setInterval(() => this.dailyCheck().catch(e => this.log('daily summary failed: ' + e.message)), 60e3);
    if (this.live) setInterval(async () => {
      try { await this.feeCheck(usdOfWith(await priceBook())); } catch (e) { this.log('fee check failed: ' + e.message); }
    }, 5 * 60e3);
    const beat = () => this.heartbeat().catch(e => this.log('heartbeat failed: ' + e.message));
    setTimeout(beat, 15e3);
    setInterval(beat, (this.cfg.heartbeatMin ?? 30) * 60e3);
    const stop = () => { this.writeSummary(); process.exit(0); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    this.tick();
  }

  // ---- #1 auto-claim and compound the owner's 10% ----
  // Needs set_fee_settings(fee_to = bot, collector = bot) on the pool contract (done once from the owner panel).
  async feeCheck(usdOf) {
    const f = this.cfg.fees || {};
    const op = this.cfg.ownPools || {};
    if (!this.live || f.enabled === false || !op.contract) return null;
    if (Date.now() - (this.lastFeeCheck || 0) < (f.checkEveryMin ?? 60) * 60e3) return null;
    this.lastFeeCheck = Date.now();
    const settings = await this.chain.feeSettings(op.contract);
    if (settings.collector !== this.address || settings.fee_to !== this.address) {
      this.logEvery('fees-setup', 24 * 3600e3, 'Auto-claim is off: in the owner panel, set the fee collector and fee destination to the bot address.');
      return null;
    }
    const pools = (await this.chain.ownFees(op.contract, op.pairs || [])).filter(p => p.feesA > 0n || p.feesB > 0n);
    if (!pools.length) return null;
    const usd = pools.reduce((a, p) => a + usdOf(p.tokenA, p.feesA) + usdOf(p.tokenB, p.feesB), 0);
    const weekly = Date.now() - (this.lastClaim || 0) > 7 * 864e5;
    if (usd < (f.claimUsd ?? 5) && !weekly) return null;
    const ops = [];
    for (const p of pools) ops.push(await this.chain.claimOp(op.contract, p.tokenA, p.tokenB, this.address));
    const tx = await this.chain.send(this.signer, ops);
    this.lastClaim = Date.now();
    this.record({ kind: 'fee-claim', usd: +usd.toFixed(2), pools: pools.length, tx: tx.id });
    this.log(`CLAIMED owner fees from ${pools.length} pools (~$${usd.toFixed(2)})`, { tx: tx.id });
    if (f.compound !== false) await this.compound(op, pools).catch(e => this.log('compound skipped: ' + e.message));
    return { usd, pools: pools.length };
  }

  // Reinvest the claimed fees as liquidity, with the shares credited to you (cfg.fees.sharesTo), so you can
  // remove them any time from the pools page with your own wallet.
  // - vETH/vUSDT, vETH/vUSDC: both sides come from fees.
  // - KOIN pools: the fee token (vETH/vUSDT/vUSDC) is matched with KOIN from the bot, up to
  //   fees.maxExtraKoinPerWeek beyond the KOIN fees themselves (gradual growth).
  async compound(op, pools) {
    const f = this.cfg.fees || {};
    const sharesTo = f.sharesTo || this.cfg.producerAddress;
    const weekStart = Date.now() - 7 * 864e5;
    this.koinAdded = (this.koinAdded || []).filter(x => x.t > weekStart);
    const used = () => this.koinAdded.reduce((a, x) => a + x.v, 0n);
    const budget = fromK(f.maxExtraKoinPerWeek ?? 2000);
    for (const p of pools) {
      if (p.totalShares === 0n || p.reserveA === 0n || p.reserveB === 0n) continue;
      const koinSide = p.tokenA === ADDR.KOIN ? 'a' : p.tokenB === ADDR.KOIN ? 'b' : null;
      let a, b;
      if (!koinSide) {
        const [ha, hb] = await Promise.all([this.chain.balance(p.tokenA, this.address), this.chain.balance(p.tokenB, this.address)]);
        a = ha; b = ha * p.reserveB / p.reserveA;
        if (b > hb) { b = hb; a = hb * p.reserveA / p.reserveB; }
      } else {
        const other = koinSide === 'a' ? p.tokenB : p.tokenA;
        const held = await this.chain.balance(other, this.address);
        const rK = koinSide === 'a' ? p.reserveA : p.reserveB, rX = koinSide === 'a' ? p.reserveB : p.reserveA;
        let x = held, k = x * rK / rX;
        const feeKoin = koinSide === 'a' ? p.feesA : p.feesB;
        const extra = k > feeKoin ? k - feeKoin : 0n;
        const room = budget - used();
        const spendable = this.spendable(await this.wallet());
        const maxK = feeKoin + (room > 0n ? room : 0n);
        const capK = maxK < spendable ? maxK : spendable;
        if (k > capK) { k = capK; x = k * rX / rK; }
        if (k <= 0n || x <= 0n) continue;
        if (koinSide === 'a') { a = k; b = x; } else { a = x; b = k; }
        this.koinAdded.push({ t: Date.now(), v: k > feeKoin ? k - feeKoin : 0n });
        void extra;
      }
      if (!a || !b || a <= 0n || b <= 0n) continue;
      const sa = a * p.totalShares / p.reserveA, sb = b * p.totalShares / p.reserveB;
      const minShares = (sa < sb ? sa : sb) * 995n / 1000n;
      if (minShares <= 0n) continue;
      const tx = await this.chain.send(this.signer, [
        await this.spendOp(p.tokenA, op.contract, op.contract, a),
        await this.spendOp(p.tokenB, op.contract, op.contract, b),
        await this.chain.addLiquidityOp(op.contract, this.address, p.tokenA, p.tokenB, a, b, minShares, sharesTo),
      ]);
      this.record({ kind: 'compound', tokenA: p.tokenA, tokenB: p.tokenB, a: toK(a), b: toK(b), sharesTo, tx: tx.id });
      this.log(`REINVESTED fees into ${p.tokenA.slice(0, 6)}/${p.tokenB.slice(0, 6)} (shares to ${sharesTo.slice(0, 8)}…)`, { tx: tx.id });
    }
  }

  // Every 30 min: publish a small status (balances, today's results, node health) for the dashboard,
  // and so the alert job can email you if the bot goes quiet.
  async heartbeat() {
    let w = null, head = null;
    try { w = await this.wallet(); } catch (e) {}
    try { head = await this.chain.head(); } catch (e) {}
    const status = {
      at: new Date().toISOString(), mode: this.cfg.mode, address: this.address, producer: this.cfg.producerAddress,
      paused: !!(this.cfg.paused || fs.existsSync(this.stopFile) || (this.remotePause && this.remotePause.paused)),
      koin: w ? toK(w.koin) : null, vhp: w ? toK(w.vhp) : null, mana: w ? toK(w.mana) : null,
      node: head ? { height: head.height, lagSec: Math.round((Date.now() - head.time) / 1000), url: head.node } : null,
      today: this.todayTotals(), totals: this.summary(),
    };
    this.lastStatus = status;
    try { fs.writeFileSync(path.join(this.dataDir, 'status.json'), JSON.stringify(status, null, 2)); } catch (e) {}
    await this.notifier.send('heartbeat', 'hb', 'heartbeat', JSON.stringify(status), 0, { quiet: true });
  }

  todayTotals() {
    const since = Date.now() - 864e5;
    let rows = [];
    try { rows = fs.readFileSync(path.join(this.dataDir, 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => new Date(r.t).getTime() >= since); } catch (e) {}
    const sum = (k, f) => rows.filter(r => r.kind === k).reduce((a, r) => a + (+r[f] || 0), 0);
    return { buys: rows.filter(r => r.kind === 'vhp-buy').length, koinOnVhp: sum('vhp-buy', 'koinIn'), extraVhp: sum('vhp-buy', 'extraVhp'),
      vhpSent: sum('vhp-sweep', 'vhp'), loops: rows.filter(r => r.kind === 'loop').length, loopProfit: sum('loop', 'profit') };
  }

  async dailyCheck() {
    const d = this.cfg.daily || {};
    if (d.enabled === false) return;
    const day = this.notifier.dailyDue(d.hour ?? 8, d.tz || 'America/New_York');
    if (!day) return;
    let balances;
    try { const w = await this.wallet(); balances = { koin: toK(w.koin), vhp: toK(w.vhp) }; } catch (e) {}
    const body = dailyReport(path.join(this.dataDir, 'ledger.jsonl'), this.summary(), { mode: this.cfg.mode, balances });
    await this.notifier.send('summary', 'daily-' + day, `Bot daily summary ${day}`, body);
    if (day.endsWith('-01')) {
      const d = new Date(day + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
      const month = d.toISOString().slice(0, 7);
      const rep = monthlyReport(path.join(this.dataDir, 'ledger.jsonl'), path.join(this.dataDir, 'reports'), month);
      await this.notifier.send('summary', 'month-' + month, `Bot proof report ${month}`, rep.md);
    }
  }

  writeSummary() {
    try { fs.writeFileSync(path.join(this.dataDir, 'summary.json'), JSON.stringify(this.summary(), null, 2)); } catch (e) {}
  }
}

function readKey(cfg) {
  const f = path.resolve(__dirname, '..', cfg.keyFile || 'bot.key');
  if (process.env.BOT_WIF) return process.env.BOT_WIF;
  if (!fs.existsSync(f)) throw new Error(`Live mode needs the bot key in ${f} (run "npm run keygen").`);
  return fs.readFileSync(f, 'utf8');
}

// USD price of each token from KoinDX: its deepest pair's reserveUSD / 2 / its reserve. Cached 10 min.
let priceCache = { at: 0, map: new Map() };
async function priceBook() {
  if (Date.now() - priceCache.at < 600e3) return priceCache.map;
  const best = new Map();
  for (const p of await fetchPairs()) {
    for (const [id, r] of [[p.t0, p.r0], [p.t1, p.r1]]) {
      if (!(r > 0) || !(p.usd > 0)) continue;
      const cur = best.get(id);
      if (!cur || p.usd > cur.usd) best.set(id, { usd: p.usd, price: p.usd / 2 / r });
    }
  }
  const map = new Map([...best].map(([id, v]) => [id === 'koin' ? ADDR.KOIN : id === 'vhp' ? ADDR.VHP : id, v.price]));
  priceCache = { at: Date.now(), map };
  return map;
}
const usdOfWith = book => (tokenAddr, raw) => (book.get(tokenAddr) || 0) * Number(raw) / 1e8;

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) { last = e; await new Promise(res => setTimeout(res, 500 * 3 ** i)); }
  }
  throw last;
}
async function fetchPairs() {
  const out = [];
  for (let page = 1; page < 12; page++) {
    const j = await getJson(`https://api.koindx.com/v2/pairs?pageSize=100&page=${page}`);
    if (!j.result || !j.result.length) break;
    out.push(...j.result.map(p => ({ id: p.id, t0: p.token0.id, t1: p.token1.id, d0: +p.token0.decimals || 8, d1: +p.token1.decimals || 8, r0: +p.reserve0, r1: +p.reserve1, usd: +p.reserveUSD || 0 })));
    if (j.result.length < 100) break;
  }
  return out;
}
let listedCache = { at: 0, set: new Set(['koin', 'vhp']) };
async function fetchListed() {
  if (Date.now() - listedCache.at < 3600e3) return listedCache.set;
  try { listedCache = { at: Date.now(), set: new Set(((await getJson('https://tokens.koindx.com/mainnet.json')).tokens || []).map(t => t.address)) }; } catch (e) {}
  return listedCache.set;
}

module.exports = { Bot, priceBook, usdOfWith };

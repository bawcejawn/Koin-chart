# Koin-chart working notes

Running log for the overnight check-ins. Read this first, add to it every time.

## Goals (from the user, in priority order)

1. Accumulate **KOIN and VHP** (the user mines on Koinos, so VHP is the main target).
2. Accumulate **USDC, ETH and BTC** from other chains, then bring them onto Koinos through the **Vortex bridge** (vortexbridge.io). Find where fees on other chains block arbitrage that a feeless chain (Koinos) or bridged vKOIN could capture.
3. Possibly create Koinos liquidity pools with a higher fee (around 1%). KoinDX pools charge a fixed 0.25%, so a 1% pool would need its own pool contract or another DEX. Research only; needs the user's decision (PR, not merge).
4. Keep everything one or two clicks with the connected Kondor wallet, clear and safe.

## Rules for unattended work

- Read-only on-chain. Never sign or send transactions, never act on the user's wallet.
- Only free, safe, public data sources that need no keys or permissions.
- Small, clearly-safe fixes go to `main`. Anything that needs the user's input goes in a PR and is **not merged**.

## Facts learned

- KoinDX router (periphery) `17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s`, `swap_tokens_in(from, receiver, amountIn, amountOutMin, path[])`, entry 2335548678. Path uses `koin` / `vhp` names or token addresses. Approve the input token to the router first, in the same transaction.
- Pair `get_reserves` (0x6d0c5abf): field 2 = token0 reserve, field 3 = token1 reserve. KoinDX API `token0/token1` order matches.
- KoinDX `get_config`: `feeOn = true` (protocol takes part of LP fees).
- Koinos: **KOIN can only be transferred if it has all of its mana.** Mana recharges over about 5 days. Spendable KOIN ~= current mana.
- Another bot already runs KOIN loops with `amountOutMin = amountIn + 1`.
- Most current loops go through tokens not on KoinDX's official list (`tokens.koindx.com/mainnet.json`, 32 tokens).
- Bridged vKOIN pools: Ethereum (Uniswap v3/v4, 1% fee), Base (Uniswap v4), Solana (Raydium CLMM). GeckoTerminal API works from the page (CORS ok).

## Log

- 2026-11-25 21:40 ET: v1 shipped (wallet, buy, loops, liquidity, cross-chain, alerts). User connected Kondor fine. Fixed: "Spendable KOIN" showed 0 because of a 10 KOIN mana buffer; now 1.5 KOIN, plus a note showing how much KOIN is still recharging mana. Loop empty state now explains hidden smaller/unlisted loops. Observed: VHP edge ~0%, no listed-token loops >= 1 KOIN, cross-chain gap ~2.4% after pool fees (Ethereum vKOIN above native).
- Script tags carry `?v=<timestamp>` so browsers load new JS right after a deploy. Bump it on every JS change: `V=$(date -u +%Y%m%d%H%M); sed -i -E "s#src=\"(js/[a-z]+\.js)(\?v=[0-9]+)?\"#src=\"\1?v=$V\"#g" index.html`
- Loops with unlisted tokens (21:37 ET): 6 found, best +8.7 KOIN via KOIN→vUSDC→USDS→KOIN. All share one tiny USDS/KOIN pool (~$3), so only one is takeable.
- 2026-11-25 23:46 ET (check-in 1): VHP edge +0.001% (none). Loops: 0 with listed tokens; 24 incl. unlisted, best +8.7 KOIN via KOIN→vUSDC→USDS→KOIN (unchanged since 21:37). Cross-chain 2.40% after pool fees (Ethereum vKOIN above native). LP 24h volume 78.8k KOIN, est 11.9%/yr.
  - Investigated why the USDS loop sits untaken: math verified against the contracts (all 8 decimals, orientation right, ~36.4 KOIN back for 27.7). The "bot" trades in those pools are old (KOIN/vUSDT showed KOIN at ~$0.01) and tiny (~0.12 KOIN, minOut = amountIn+1). Nobody is actively arbitraging these small pools right now; the loop is real but worth only ~$0.16.
  - Fixed: Buy button no longer offers trades whose extra VHP is under 0.01 ("No worthwhile edge right now"). Fixed the "new pool share" preview in Add liquidity (was approximate).
  - Reviewed: kondor-js sendTransaction returns {transaction, receipt} as used; reverted receipts throw before logging; loops use per-token decimals for screening and raw on-chain reserves for sizing; mana spend limit now 1.5 KOIN buffer. Smoke test clean.
- 2026-11-26 02:31 ET (check-in 2): VHP edge +0.001% (none). Cross-chain gap grew: Ethereum vKOIN 4.84% above native, 3.59% after pool fees (was 2.40%). LP 24h volume 67.0k KOIN.
  - BUG: the alert schedule had never fired (only manual runs) in ~11 h. Known GitHub behavior for new repos/schedules (delays of 8-14 h, dropped runs). Moved cron to minutes 7,17,27,... (off busy :00/:30), which also re-registers it, and dispatched a run by hand. Check next time whether scheduled runs appear.
  - Loop optimization measured on live data: listed-only = 0 loops; unlisted, 4 hops = 136 candidates, but they overlap heavily: the non-overlapping set is 4 loops worth ~14 KOIN total (best 8.7). 5 hops = 793 candidates, no extra profit (kept 4). VHP start adds ~1.09 VHP (VHP>DRUGS>67>KOIN>VHP).
  - Changed: scanner now lists only loops that don't share a pool with a better one (and says how many overlapping ones were folded), verifies top 40 instead of 24, and defaults to "KOIN or VHP".
  - Loops starting in vUSDC / vUSDT / vETH are the same USDS mispricing seen in another currency (~$0.14-0.16 each). Total Koinos loop opportunity right now is under $1, so growing USDC/ETH/BTC meaningfully needs other venues (see docs/scaling.md PR).
- Research PR opened: research/scaling (docs/scaling.md), not merged; 4 decisions for the user.
- 2026-11-26 05:15 ET (check-in 3): VHP edge +0.001% (none). Loops (listed tokens) 0. Cross-chain: Solana vKOIN now 5.00% above native, 3.75% after pool fees (Ethereum ~4.8%). LP est 10.1%/yr.
  - ALERT SCHEDULE STILL NEVER FIRED (only manual runs). A scheduled workflow's actor is the last user who changed the cron line; every change so far came from this session's app, which is the likely reason. Fix needs the user: edit the cron line once in the GitHub web editor (any tiny change) so the schedule is owned by their account. Put this in the morning summary.
  - UX pass (desktop + 375px mobile): no horizontal overflow. Fixed: panel title claimed "beats burning" at +0.001% (now needs >= 0.01 VHP gain); "Buy this amount" was clickable for amounts that get less than burning (now disabled with a clear label); mobile nav is now one swipeable row (two rows hid section headings); LP "measured growth" now waits for a full day of data instead of showing +0.000%.
  - Cross-chain monitor now shows gas per swap (publicnode Ethereum/Base RPCs, CORS works) and an estimated "max profit" per pool. Live: Ethereum USDT ≈$3.04, Ethereum WETH ≈$1.72, Solana ≈$1.41; gas ≈$0.01 on Ethereum, <$0.01 on Base/Solana. Gas isn't the blocker; the bridge is.
  - Research PR #1 updated with expected values and a value-per-effort ranking: VHP buy windows > LP fees > cross-chain inventory arb (a few $ per divergence) > loops (<$1) > 1% pool contract.

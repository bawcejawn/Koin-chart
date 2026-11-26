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

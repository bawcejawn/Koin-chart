# Scaling beyond Koinos: accumulating USDC, ETH and BTC

Draft research (overnight, Nov 26 2026). Goal: grow KOIN/VHP first, then USDC, ETH and BTC from other chains, and bring them onto Koinos through Vortex. Nothing here is built or merged; each option ends with what needs your decision.

## What we measured tonight

| Signal | Value | Note |
|---|---|---|
| Loops on Koinos (all KoinDX pools) | ~14 KOIN total across 4 separate loops | All through small unlisted pools (USDS, DRUGS). Under $1. |
| Loops that start/end in vUSDC / vUSDT / vETH | ~$0.14–0.16 each | Same USDS mispricing seen in another currency. |
| Bridged KOIN (vKOIN) on Ethereum vs native KOIN | +3.65% to +4.84% | 2.4–3.6% after the 1% Uniswap fee and 0.25% KoinDX fee. Persisted for hours. |
| VHP/KOIN pool edge vs burning | ~0% | Opens in bursts after big trades (5–30% windows seen in the last 7 weeks, median ~10 h). |

**Takeaway:** the Koinos-only loops are real but tiny. The biggest and most persistent gap tonight is between KOIN on Koinos and vKOIN on Ethereum. That is also the route that naturally accumulates USDT/USDC/ETH.

## Facts about the bridge

- Vortex is Koinos' native bridge. At launch it supported KOIN, USDT and ETH between Koinos and Ethereum.
- It is based on Wormhole, with 7 guardian nodes; 5 of 7 must validate each transfer.
- vKOIN on Ethereum is further bridged to Base and Solana through Wormhole.
- Vortex does not publish its fee schedule in its announcement posts. The bridge UI shows the cost per transfer; we need one real quote (see decisions).
- No meaningful BTC exists on Koinos (a "BTC" token there has about $4 of liquidity and isn't on KoinDX's list). BTC would have to be bought on another chain (for example WBTC on Ethereum or cbBTC on Base).

## Options, ranked

### 1. Inventory arbitrage of the KOIN / vKOIN gap (best fit for the goal)

Hold some KOIN on Koinos and some USDT (or ETH) on Ethereum/Base at the same time. When vKOIN on Ethereum trades above native KOIN:

1. Sell vKOIN for USDT on Uniswap (Ethereum or Base).
2. At the same time, buy the same amount of KOIN on KoinDX with vUSDT (feeless on Koinos).
3. Every so often, rebalance inventory with one Vortex transfer, instead of bridging each trade.

You end each cycle with the same KOIN and more USDT. Doing both legs at the same time removes the bridge from each trade, so the gap is captured right away and bridge costs are paid only occasionally.

- **Size:** the Ethereum vKOIN/USDT pool holds about $26k, so trades of a few hundred dollars move its price noticeably. A realistic edge is roughly 2–3% on $100–500 per window, i.e. $3–15 per window, minus Ethereum gas (cheaper on Base).
- **Scaling with fees in mind:** Ethereum L1 gas eats small trades. Base has the same pair (vKOIN/USDC) with much lower gas, so Base is the better venue for small, frequent trades.
- **What it needs:** an EVM wallet (MetaMask or similar) connected to the page alongside Kondor, a Uniswap quote/swap on Base/Ethereum, and inventory on both sides.
- **Risk:** prices can move between the two legs. Mitigate with minimum-output guards on both legs (same pattern we already use on Koinos).

### 2. Koinos loops in vUSDC / vUSDT / vETH (built, small)

The scanner can already start loops in any token. Today these are worth well under $1 combined. Low effort to expose as start options; they'll matter only after big lopsided trades.

### 3. A higher-fee (around 1%) pool on Koinos

KoinDX charges a fixed 0.25% on every pool, so a 1% pool needs either its own pool contract on Koinos (Uniswap-v2 style, written and audited by us or someone else) or another Koinos DEX that allows custom fees.

- It only earns if trades actually route through it. Routers pick the cheapest pool, so a 1% pool works best for pairs that don't already exist on KoinDX (for example VHP/vUSDT or VHP/vETH), where it would be the only venue.
- Income = volume × 1%. Volume on Koinos is small today (VHP/KOIN, the busiest pool, does about 70–100k KOIN a day, roughly $1.3–1.9k).
- Writing and auditing a new pool contract is a real project with real risk to deposited funds.

### 4. Fee-limited arbitrage on Ethereum in general

On Ethereum L1, small price gaps exist because gas makes them unprofitable, but professional bots take everything that is profitable after gas. A feeless chain only helps on its own side. The advantage we have is specifically the Koinos side of KOIN-related gaps (option 1), not general Ethereum arbitrage.

## Free, keyless data sources

- Koinos RPC `api.koinos.io` (on-chain state, already used)
- KoinDX API `api.koindx.com` and token list `tokens.koindx.com` (already used)
- GeckoTerminal API (DEX pool prices on Ethereum, Base, Solana; already used; about 30 requests a minute)
- Public EVM RPCs without keys (for gas prices and Uniswap pool state on Ethereum/Base), for example publicnode.com endpoints. Need to confirm CORS from the page.

## Decisions for you

1. **Option 1 (inventory arbitrage):** do you want to hold inventory on Base or Ethereum, and roughly how much? Do you have an EVM wallet you'd connect? Base is recommended for lower gas.
2. **Vortex cost:** could you get one real quote from the Vortex UI (for example, bridging 1,000 KOIN to Ethereum)? That decides how often rebalancing pays off.
3. **Option 3 (1% pool):** worth pursuing as a separate contract project, or park it?
4. **BTC:** OK to treat BTC as "buy WBTC/cbBTC on Ethereum/Base with the USDT gained" rather than bridging BTC itself to Koinos?

Next safe steps I can do without decisions: add an Ethereum/Base gas estimate and "net profit for $100 / $500" to the cross-chain monitor, so the page shows whether the gap beats real costs.

# Koin-chart

Free live price chart for the KoinDX **VHP/KOIN** pool on Koinos
(pair `1NqLghiFRwkXZR7NBFHHiCJkF5gLHyJap1`).

Live page: https://bawcejawn.github.io/Koin-chart/

## What's on the page

- **Buy VHP cheaper than burning**: live edge vs burning 1:1, best amount, and a one-click **Buy** button
- **Loop trades**: scans every KoinDX pool for routes that end with more KOIN or VHP than they start, re-checks them on-chain, and runs one as a single transaction with a minimum-return guard
- **Liquidity**: pool size, volume, fees, measured LP growth, your position, one-click add/remove
- **Cross-chain gaps**: bridged KOIN (vKOIN) on Ethereum, Base and Solana vs native KOIN (monitor only)
- **Price chart** with edge history, and **Your results** (what each trade actually changed in your wallet)
- **Email alerts** (GitHub Actions, every 10 min): VHP edge ≥ 5%, loop ≥ 25 KOIN, cross-chain gap ≥ 5%. Change the levels in `.github/workflows/vhp-alert.yml`.

## Wallet and safety

- Connects with the **Kondor** browser extension. This page never sees your private key; every transaction opens in Kondor for you to approve or reject.
- Every trade carries a minimum return. If prices move past it, the transaction cancels and nothing is traded (only some mana is used, and it recharges).
- Approvals are for the exact amount of each trade, never unlimited.
- `koilib` 9.4.1 and `kondor-js` 0.4.3 are vendored in `vendor/` (copied from npm) so no outside CDN can change the code that talks to your wallet.
- Data: Koinos RPC (`api.koinos.io`), KoinDX API, GeckoTerminal. No backend, no keys.

Charts by [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts).

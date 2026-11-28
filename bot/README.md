# Koin-chart trading bot (Windows)

What it does, every Koinos block (~3 seconds):

1. **Buys VHP below burn.** When the KoinDX VHP/KOIN pool gives at least **1% more VHP than burning**, it swaps the amount of KOIN that gives the **most extra VHP** (limited by what's available above the **100 KOIN reserve**). The trade carries a minimum: it can never get less VHP than burning would. Then it sends **all VHP to your producer address** `1DAHmrQJMAbn4FmMMrew78wPUizjVdbBrd`.
2. **Runs loop trades** through KoinDX (tokens on KoinDX's official list only, by default). Each loop is one transaction with a minimum return above what goes in. It either makes money or doesn't happen (a cancelled try only uses some mana, which recharges).
3. **Warns when the balance is low** (below 150 KOIN by default) in its log. The GitHub alert workflow also emails you (see the main README).

It starts in **paper mode**: it reads the real chain and logs what it *would* do, without signing anything.

## One-time setup

1. Install **Node.js 20 or newer** from https://nodejs.org (the LTS installer).
2. Download this repo (green **Code** button → **Download ZIP**, then unzip), or `git clone` it.
3. Open **Command Prompt** in the `bot` folder and run:
   ```
   npm install
   copy config.example.json config.json
   ```
4. Paper test (safe, no wallet needed):
   ```
   npm start
   ```
   Leave it running. Trades it would make go to `data\ledger.jsonl`, the full log to `data\bot.log`, and an hourly `data\summary.json`.

## Going live

1. Create the bot's own wallet (never use your main wallet):
   ```
   npm run keygen
   ```
   It prints the **bot address** and saves the private key in `bot.key`. **Back up `bot.key` somewhere safe.** Anyone with it controls the bot's KOIN. It's ignored by git and must never be shared.
2. Send KOIN to the bot address. Keep in mind KOIN can only move once its **mana is charged**, so newly received KOIN becomes spendable over time.
3. In `config.json` change `"mode": "paper"` to `"mode": "live"`.
4. `npm start`.

## Keep it running on Windows

Simplest: double-click `start-bot.bat`. It restarts the bot automatically if it ever stops. To start it when Windows boots, open **Task Scheduler** → Create Basic Task → "When the computer starts" → Start a program → `start-bot.bat` (set "Start in" to the `bot` folder).

## Settings (`config.json`)

| Setting | Default | Meaning |
|---|---|---|
| `reserveKoin` | 100 | KOIN always left in the bot wallet |
| `lowBalanceKoin` | 150 | Log a top-up warning below this |
| `vhp.minEdgePct` | 1.0 | Buy only when the pool beats burning by at least this % |
| `vhp.slippagePct` | 0.5 | How far the price may move before the trade cancels (never below burn) |
| `loops.minProfitKoin` | 0.5 | Smallest loop worth running |
| `loops.keepProfitPct` | 50 | A loop cancels unless it keeps at least this share of the expected profit |
| `loops.includeUnlisted` | false | Also route through tokens not on KoinDX's official list (riskier) |

## Safety

- The bot only ever holds what you send it, and VHP leaves for your producer right away.
- Approvals are for the exact amount of each trade.
- Every trade has a minimum return; if it isn't met, the transaction cancels and nothing is traded.

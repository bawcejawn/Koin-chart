# Koin-chart pools (Koinos smart contract)

Owner-created constant-product (x·y=k) pools with a fixed per-pool fee.

- **Only the owner creates pools.** Anyone can trade and add/remove liquidity.
- **Fee is set when the pool is created and never changes**: 1–300 bps (0.01%–3%).
- **Owner share = 10% of each fee** (a 1% pool pays the owner 0.1% of every trade). The other 90% stays in the pool for liquidity providers.
- Fees are rounded up, so the pool never loses to rounding. 1,000 shares are locked on the first deposit (stops share-price manipulation).
- Trades and deposits pull tokens with `transfer(from → pool)`, so the trader approves the pool for the exact amount in the same transaction (same pattern as KoinDX).
- Reentrancy lock on every state-changing call.

## Entry points
| method | who | what |
|---|---|---|
| `initialize(owner)` | contract key, once | sets the owner |
| `create_pool(token_a, token_b, fee_bps)` | owner | new pool, fee fixed forever |
| `add_liquidity(from, token_a, token_b, amount_a, amount_b, min_shares)` | anyone | first deposit sets the price; later ones use the pool ratio |
| `remove_liquidity(from, token_a, token_b, shares, min_a, min_b)` | share holder | burn shares, get both tokens (fees included) |
| `swap(from, token_in, token_out, amount_in, min_out, receiver)` | anyone | exact-in swap |
| `claim_owner_fees(token_a, token_b, to)` | owner | sends the owner's 10% |
| `get_quote`, `get_pool`, `get_shares`, `get_owner` | read-only | |

## Build and test
```
npm install
npm run build   # build/release/pool.wasm + build/pool-abi.json
npm test        # 10 unit tests on the Koinos mock VM
```

## Deploying (not done yet)
1. Make a fresh key for the contract (its address *is* the contract).
2. Upload `build/release/pool.wasm` with the ABI, signed by that key (your main wallet can pay the mana).
3. Call `initialize(owner = your address)` signed by the contract key.
4. `create_pool(...)`, then `add_liquidity(...)` from your wallet.

Test on Harbinger (testnet) first.

## Trust note
On Koinos the contract's key can upload new code to the same address. Keep that key offline after deploy (or give it to a multisig) and say so publicly, so LPs know who can change the code.

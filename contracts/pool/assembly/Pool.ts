// SPDX-License-Identifier: MIT
// Koin-chart Pool {{ version }}
//
// Constant-product (x*y=k) pools on Koinos.
// - Only the owner can create pools. Each pool's fee is fixed forever at creation (max 3%).
// - The owner keeps owner_share_bps of every fee (10% of the fee); the rest stays in the pool for liquidity providers.
// - Anyone can trade, add liquidity and remove their own liquidity. No function lets anyone take other people's deposits.
// - Users approve this contract on the token first (exact amount), like on KoinDX.

import { System, Storage, Protobuf, authority, u128, Arrays, StringBytes } from "@koinos/sdk-as";
import { pool } from "./proto/pool";

const OWNER_SPACE_ID = 0;
const POOLS_SPACE_ID = 1;
const SHARES_SPACE_ID = 2;
const LOCK_SPACE_ID = 3;

const MAX_FEE_BPS: u32 = 300; // 3%
const OWNER_SHARE_BPS: u32 = 1000; // 10% of the fee
const BPS: u64 = 10000;
const MINIMUM_SHARES: u64 = 1000; // locked forever on the first deposit (prevents share-price manipulation)
const TRANSFER_ENTRY: u32 = 0x27f576ca;

function fail(msg: string): void {
  System.revert(msg);
}

function lt(a: Uint8Array, b: Uint8Array): bool {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    if (a[i] != b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function mulDiv(a: u64, b: u64, c: u64): u64 {
  const r = u128.div(u128.mul(u128.fromU64(a), u128.fromU64(b)), u128.fromU64(c));
  if (r > u128.fromU64(u64.MAX_VALUE)) fail("overflow");
  return r.toU64();
}

// a*b/c rounded up
function mulDivUp(a: u64, b: u64, c: u64): u64 {
  const n = u128.mul(u128.fromU64(a), u128.fromU64(b));
  const r = u128.div(u128.add(n, u128.fromU64(c - 1)), u128.fromU64(c));
  if (r > u128.fromU64(u64.MAX_VALUE)) fail("overflow");
  return r.toU64();
}

function sqrt128(x: u128): u64 {
  if (x.isZero()) return 0;
  // integer Newton iteration
  let z = x;
  let y = u128.add(u128.div(x, u128.fromU64(2)), u128.One);
  while (y < z) {
    z = y;
    y = u128.div(u128.add(u128.div(x, y), y), u128.fromU64(2));
  }
  return z.toU64();
}

export class Pool {
  callArgs: System.getArgumentsReturn | null;

  contractId: Uint8Array = System.getContractId();

  owner: Storage.Obj<pool.address> = new Storage.Obj(
    this.contractId,
    OWNER_SPACE_ID,
    pool.address.decode,
    pool.address.encode,
    () => new pool.address()
  );

  pools: Storage.Map<Uint8Array, pool.pool_object> = new Storage.Map(
    this.contractId,
    POOLS_SPACE_ID,
    pool.pool_object.decode,
    pool.pool_object.encode,
    () => new pool.pool_object()
  );

  shares: Storage.Map<Uint8Array, pool.uint64> = new Storage.Map(
    this.contractId,
    SHARES_SPACE_ID,
    pool.uint64.decode,
    pool.uint64.encode,
    () => new pool.uint64(0)
  );

  lock: Storage.Obj<pool.uint64> = new Storage.Obj(
    this.contractId,
    LOCK_SPACE_ID,
    pool.uint64.decode,
    pool.uint64.encode,
    () => new pool.uint64(0)
  );

  // ---------- helpers ----------

  _enter(): void {
    if (this.lock.get()!.value != 0) fail("reentrancy");
    this.lock.put(new pool.uint64(1));
  }

  _exit(): void {
    this.lock.put(new pool.uint64(0));
  }

  _requireAuthority(account: Uint8Array): void {
    if (!System.checkAuthority(authority.authorization_type.contract_call, account)) fail("not authorized by " + "account");
  }

  _requireOwner(): void {
    const o = this.owner.get()!;
    if (!o.value || o.value!.length == 0) fail("not initialized");
    this._requireAuthority(o.value!);
  }

  // key for a pair, independent of argument order
  _key(t0: Uint8Array, t1: Uint8Array): Uint8Array {
    if (Arrays.equal(t0, t1)) fail("identical tokens");
    return lt(t0, t1) ? concat(t0, t1) : concat(t1, t0);
  }

  _getPool(t0: Uint8Array, t1: Uint8Array): pool.pool_object {
    const p = this.pools.get(this._key(t0, t1))!;
    if (!p.exists) fail("pool does not exist");
    return p;
  }

  _transfer(token: Uint8Array, from: Uint8Array, to: Uint8Array, value: u64): void {
    if (value == 0) return;
    const args = Protobuf.encode(new pool.token_transfer_arguments(from, to, value), pool.token_transfer_arguments.encode);
    const res = System.call(token, TRANSFER_ENTRY, args);
    if (res.code != 0) {
      const msg = res.res.error && res.res.error!.message ? res.res.error!.message : "unknown error";
      fail("token transfer failed: " + msg);
    }
  }

  _sync(p: pool.pool_object): void {
    System.event(
      "pool.sync_event",
      Protobuf.encode(new pool.sync_event(p.token_a, p.token_b, p.reserve_a, p.reserve_b), pool.sync_event.encode),
      [p.token_a!, p.token_b!]
    );
  }

  // ---------- owner ----------

  /**
   * Set the owner once. Must be signed by the contract's own key (at deployment).
   * @external
   */
  initialize(args: pool.initialize_arguments): pool.empty_object {
    const o = this.owner.get()!;
    if (o.value && o.value!.length > 0) fail("already initialized");
    if (!args.owner || args.owner!.length != 25) fail("invalid owner");
    this._requireAuthority(this.contractId);
    this.owner.put(new pool.address(args.owner));
    return new pool.empty_object();
  }

  /**
   * Get the owner
   * @external
   * @readonly
   */
  get_owner(): pool.address {
    return this.owner.get()!;
  }

  /**
   * Create a pool. Owner only. The fee is fixed forever (max 300 = 3%).
   * @external
   * @event pool.pool_created_event pool.pool_created_event
   */
  create_pool(args: pool.create_pool_arguments): pool.empty_object {
    this._requireOwner();
    if (args.fee_bps == 0 || args.fee_bps > MAX_FEE_BPS) fail("fee must be between 1 and 300 bps");
    const key = this._key(args.token_a!, args.token_b!);
    const existing = this.pools.get(key)!;
    if (existing.exists) fail("pool already exists");
    const a = lt(args.token_a!, args.token_b!) ? args.token_a! : args.token_b!;
    const b = lt(args.token_a!, args.token_b!) ? args.token_b! : args.token_a!;
    const p = new pool.pool_object(true, a, b, 0, 0, args.fee_bps, OWNER_SHARE_BPS, 0, 0, 0);
    this.pools.put(key, p);
    System.event(
      "pool.pool_created_event",
      Protobuf.encode(new pool.pool_created_event(a, b, args.fee_bps, OWNER_SHARE_BPS), pool.pool_created_event.encode),
      [a, b]
    );
    return new pool.empty_object();
  }

  /**
   * Send the owner's accumulated fees for a pool to an address. Owner only.
   * @external
   */
  claim_owner_fees(args: pool.claim_arguments): pool.empty_object {
    this._requireOwner();
    this._enter();
    const key = this._key(args.token_a!, args.token_b!);
    const p = this._getPool(args.token_a!, args.token_b!);
    const fa = p.owner_fees_a, fb = p.owner_fees_b;
    p.owner_fees_a = 0;
    p.owner_fees_b = 0;
    this.pools.put(key, p);
    this._transfer(p.token_a!, this.contractId, args.to!, fa);
    this._transfer(p.token_b!, this.contractId, args.to!, fb);
    this._exit();
    return new pool.empty_object();
  }

  // ---------- liquidity ----------

  /**
   * Add liquidity. Amounts are used in the pool's current ratio; any excess of one token is not taken.
   * @external
   * @event pool.liquidity_event pool.liquidity_event
   */
  add_liquidity(args: pool.add_liquidity_arguments): pool.add_liquidity_result {
    this._requireAuthority(args.from!);
    this._enter();
    const key = this._key(args.token_a!, args.token_b!);
    const p = this._getPool(args.token_a!, args.token_b!);
    // map caller's a/b to the pool's sorted a/b
    const sameOrder = Arrays.equal(args.token_a!, p.token_a!);
    let amountA = sameOrder ? args.amount_a : args.amount_b;
    let amountB = sameOrder ? args.amount_b : args.amount_a;
    if (amountA == 0 || amountB == 0) fail("amounts must be positive");

    let minted: u64 = 0;
    if (p.total_shares == 0) {
      const root = sqrt128(u128.mul(u128.fromU64(amountA), u128.fromU64(amountB)));
      if (root <= MINIMUM_SHARES) fail("first deposit too small");
      minted = root - MINIMUM_SHARES;
      p.total_shares = MINIMUM_SHARES; // locked, owned by nobody
    } else {
      const bOptimal = mulDiv(amountA, p.reserve_b, p.reserve_a);
      if (bOptimal <= amountB) {
        amountB = bOptimal;
      } else {
        amountA = mulDiv(amountB, p.reserve_a, p.reserve_b);
      }
      const sA = mulDiv(amountA, p.total_shares, p.reserve_a);
      const sB = mulDiv(amountB, p.total_shares, p.reserve_b);
      minted = sA < sB ? sA : sB;
    }
    if (minted == 0 || minted < args.min_shares) fail("not enough shares minted");

    this._transfer(p.token_a!, args.from!, this.contractId, amountA);
    this._transfer(p.token_b!, args.from!, this.contractId, amountB);

    p.reserve_a += amountA;
    p.reserve_b += amountB;
    p.total_shares += minted;
    this.pools.put(key, p);
    const skey = concat(key, args.from!);
    const s = this.shares.get(skey)!;
    s.value += minted;
    this.shares.put(skey, s);

    System.event(
      "pool.liquidity_event",
      Protobuf.encode(new pool.liquidity_event(args.from, p.token_a, p.token_b, amountA, amountB, minted, true), pool.liquidity_event.encode),
      [args.from!]
    );
    this._sync(p);
    this._exit();
    return new pool.add_liquidity_result(minted, sameOrder ? amountA : amountB, sameOrder ? amountB : amountA);
  }

  /**
   * Remove liquidity: burn shares and receive both tokens (fees included).
   * @external
   * @event pool.liquidity_event pool.liquidity_event
   */
  remove_liquidity(args: pool.remove_liquidity_arguments): pool.remove_liquidity_result {
    this._requireAuthority(args.from!);
    this._enter();
    const key = this._key(args.token_a!, args.token_b!);
    const p = this._getPool(args.token_a!, args.token_b!);
    const skey = concat(key, args.from!);
    const s = this.shares.get(skey)!;
    if (args.shares == 0 || args.shares > s.value) fail("not enough shares");
    const outA = mulDiv(args.shares, p.reserve_a, p.total_shares);
    const outB = mulDiv(args.shares, p.reserve_b, p.total_shares);
    const sameOrder = Arrays.equal(args.token_a!, p.token_a!);
    const minA = sameOrder ? args.min_a : args.min_b;
    const minB = sameOrder ? args.min_b : args.min_a;
    if (outA < minA || outB < minB) fail("below minimum amounts");

    s.value -= args.shares;
    this.shares.put(skey, s);
    p.total_shares -= args.shares;
    p.reserve_a -= outA;
    p.reserve_b -= outB;
    this.pools.put(key, p);

    this._transfer(p.token_a!, this.contractId, args.from!, outA);
    this._transfer(p.token_b!, this.contractId, args.from!, outB);

    System.event(
      "pool.liquidity_event",
      Protobuf.encode(new pool.liquidity_event(args.from, p.token_a, p.token_b, outA, outB, args.shares, false), pool.liquidity_event.encode),
      [args.from!]
    );
    this._sync(p);
    this._exit();
    return new pool.remove_liquidity_result(sameOrder ? outA : outB, sameOrder ? outB : outA);
  }

  // ---------- trading ----------

  // amount out for amount in, plus the fee split (pure)
  _quote(p: pool.pool_object, inIsA: bool, amountIn: u64): u64[] {
    const rin = inIsA ? p.reserve_a : p.reserve_b;
    const rout = inIsA ? p.reserve_b : p.reserve_a;
    if (rin == 0 || rout == 0) fail("pool has no liquidity");
    // fee rounded up so the pool never loses to rounding
    const fee = mulDivUp(amountIn, p.fee_bps as u64, BPS);
    const ownerFee = mulDiv(fee, p.owner_share_bps as u64, BPS);
    const inAfterFee = amountIn - fee;
    const out = mulDiv(inAfterFee, rout, rin + inAfterFee);
    return [out, fee, ownerFee];
  }

  /**
   * Quote: how much you would get for amount_in
   * @external
   * @readonly
   */
  get_quote(args: pool.quote_arguments): pool.uint64 {
    const p = this._getPool(args.token_in!, args.token_out!);
    const inIsA = Arrays.equal(args.token_in!, p.token_a!);
    return new pool.uint64(this._quote(p, inIsA, args.amount_in)[0]);
  }

  /**
   * Swap an exact amount in for at least min_out.
   * @external
   * @event pool.swap_event pool.swap_event
   */
  swap(args: pool.swap_arguments): pool.uint64 {
    this._requireAuthority(args.from!);
    this._enter();
    if (args.amount_in == 0) fail("amount_in must be positive");
    const key = this._key(args.token_in!, args.token_out!);
    const p = this._getPool(args.token_in!, args.token_out!);
    const inIsA = Arrays.equal(args.token_in!, p.token_a!);
    const q = this._quote(p, inIsA, args.amount_in);
    const out = q[0], fee = q[1], ownerFee = q[2];
    if (out == 0) fail("amount too small");
    if (out >= (inIsA ? p.reserve_b : p.reserve_a)) fail("not enough liquidity");
    if (out < args.min_out) fail("below min_out");
    const receiver = args.receiver && args.receiver!.length > 0 ? args.receiver! : args.from!;

    this._transfer(args.token_in!, args.from!, this.contractId, args.amount_in);

    // the LP part of the fee stays in the reserves; the owner part is set aside
    if (inIsA) {
      p.reserve_a += args.amount_in - ownerFee;
      p.reserve_b -= out;
      p.owner_fees_a += ownerFee;
    } else {
      p.reserve_b += args.amount_in - ownerFee;
      p.reserve_a -= out;
      p.owner_fees_b += ownerFee;
    }
    this.pools.put(key, p);

    this._transfer(args.token_out!, this.contractId, receiver, out);

    System.event(
      "pool.swap_event",
      Protobuf.encode(new pool.swap_event(args.from, args.token_in, args.token_out, args.amount_in, out, fee, ownerFee), pool.swap_event.encode),
      [args.from!, receiver]
    );
    this._sync(p);
    this._exit();
    return new pool.uint64(out);
  }

  // ---------- reads ----------

  /**
   * Get a pool
   * @external
   * @readonly
   */
  get_pool(args: pool.pair_arguments): pool.pool_object {
    return this.pools.get(this._key(args.token_a!, args.token_b!))!;
  }

  /**
   * Get an account's shares in a pool
   * @external
   * @readonly
   */
  get_shares(args: pool.shares_arguments): pool.uint64 {
    return this.shares.get(concat(this._key(args.token_a!, args.token_b!), args.account!))!;
  }
}

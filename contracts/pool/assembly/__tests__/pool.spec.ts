import { Base58, MockVM, Protobuf, System, authority, chain, system_calls, u128, value } from "@koinos/sdk-as";
import { Pool } from "../Pool";
import { pool } from "../proto/pool";

const CONTRACT_ID = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const OWNER = Base58.decode("1DAHmrQJMAbn4FmMMrew78wPUizjVdbBrd");
const USER = Base58.decode("1FkSxrCK6D3ELi2taw8QLgxPMBUnnoxfgy");
const OTHER = Base58.decode("19dG7aZ6oTVCmTPrLWAd3tbKeyG4jk1bAC");
const VETH = Base58.decode("1Tf1QKv3gVYLjq34yURSHw5ErTYbFjqTG");
const VUSDT = Base58.decode("12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh");

const E8: u64 = 100000000;

function okCalls(n: i32): void {
  const r = new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0)));
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < n; i++) list.push(r);
  MockVM.setCallContractResults(list);
}
function authorize(accounts: Uint8Array[]): void {
  const auths: MockVM.MockAuthority[] = [];
  for (let i = 0; i < accounts.length; i++) auths.push(new MockVM.MockAuthority(authority.authorization_type.contract_call, accounts[i], true));
  MockVM.setAuthorities(auths);
}
function remaining(): i32 {
  const l = System.getObject<string, value.list_type>(MockVM.METADATA_SPACE, "call_contract_results", value.list_type.decode);
  return l ? l.values.length : 0;
}
function setup(feeBps: u32): Pool {
  const p = new Pool();
  authorize([CONTRACT_ID]);
  p.initialize(new pool.initialize_arguments(OWNER));
  authorize([OWNER]);
  p.create_pool(new pool.create_pool_arguments(VETH, VUSDT, feeBps));
  return p;
}
function seed(p: Pool, a: u64, b: u64): pool.add_liquidity_result {
  authorize([OWNER]);
  okCalls(2);
  return p.add_liquidity(new pool.add_liquidity_arguments(OWNER, VETH, VUSDT, a, b, 0));
}

describe("Pool", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
    MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
  });

  it("initializes once, with the contract's own authority", () => {
    const p = new Pool();
    authorize([CONTRACT_ID]);
    p.initialize(new pool.initialize_arguments(OWNER));
    expect(Base58.encode(p.get_owner().value!)).toBe(Base58.encode(OWNER));
    expect(() => {
      const p2 = new Pool();
      p2.initialize(new pool.initialize_arguments(USER));
    }).toThrow();
  });

  it("refuses initialize without the contract's authority", () => {
    expect(() => {
      const p = new Pool();
      authorize([USER]);
      p.initialize(new pool.initialize_arguments(USER));
    }).toThrow();
  });

  it("only the owner can create pools, fee capped at 3%", () => {
    const p = setup(100);
    const info = p.get_pool(new pool.pair_arguments(VUSDT, VETH));
    expect(info.exists).toBe(true);
    expect(info.fee_bps).toBe(100);
    expect(info.owner_share_bps).toBe(1000);
    expect(() => {
      const p2 = new Pool();
      authorize([USER]);
      p2.create_pool(new pool.create_pool_arguments(VETH, OTHER, 100));
    }).toThrow();
    expect(() => {
      const p3 = new Pool();
      authorize([OWNER]);
      p3.create_pool(new pool.create_pool_arguments(VETH, OTHER, 301));
    }).toThrow();
    expect(() => {
      const p4 = new Pool();
      authorize([OWNER]);
      p4.create_pool(new pool.create_pool_arguments(VUSDT, VETH, 100));
    }).toThrow(); // duplicate, in either order
  });

  it("first deposit mints sqrt(a*b) - 1000 shares and pulls both tokens from the depositor", () => {
    const p = setup(100);
    const res = seed(p, 1 * E8, 3000 * E8);
    const expected: u64 = 5477225575 - 1000; // floor(sqrt(1e8 * 3000e8)) - locked
    expect(res.shares).toBe(expected);
    expect(remaining()).toBe(0); // both token transfers were made
    const info = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    expect(info.total_shares).toBe(expected + 1000);
  });

  it("swap: 1% fee, 10% of it to the owner, constant product never decreases, min_out enforced", () => {
    const p = setup(100);
    seed(p, 100 * E8, 300000 * E8); // 1 vETH = 3000 vUSDT (sorted order may differ; use quotes)
    const before = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    const kBefore = u128.mul(u128.fromU64(before.reserve_a), u128.fromU64(before.reserve_b));

    const amountIn: u64 = 3000 * E8; // swap vUSDT -> vETH
    const quote = p.get_quote(new pool.quote_arguments(VUSDT, VETH, amountIn)).value;
    // expected: (in - 1%) * rout / (rin + in - 1%)
    const inAfter = amountIn - amountIn / 100;
    const rin: u64 = 300000 * E8, rout: u64 = 100 * E8;
    const exp = u128.div(u128.mul(u128.fromU64(inAfter), u128.fromU64(rout)), u128.fromU64(rin + inAfter)).toU64();
    expect(quote).toBe(exp);

    authorize([USER]);
    okCalls(2);
    const out = p.swap(new pool.swap_arguments(USER, VUSDT, VETH, amountIn, quote, new Uint8Array(0))).value;
    expect(out).toBe(quote);
    expect(remaining()).toBe(0); // pulled the input, paid the output

    const after = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    const kAfter = u128.mul(u128.fromU64(after.reserve_a), u128.fromU64(after.reserve_b));
    expect(kAfter >= kBefore).toBe(true);
    const fee = amountIn / 100;
    const ownerFee = fee / 10;
    const ownerFees = after.owner_fees_a + after.owner_fees_b;
    expect(ownerFees).toBe(ownerFee);

    expect(() => {
      const p2 = new Pool();
      authorize([USER]);
      okCalls(2);
      p2.swap(new pool.swap_arguments(USER, VUSDT, VETH, 1000 * E8, 100 * E8, new Uint8Array(0)));
    }).toThrow(); // asks for far more than the pool gives
  });

  it("a second provider gets shares in proportion, and only the matching ratio is taken", () => {
    const p = setup(100);
    const first = seed(p, 100 * E8, 300000 * E8).shares;
    authorize([USER]);
    okCalls(2);
    // offers 10 vETH and 50000 vUSDT; only 30000 vUSDT matches the 1:3000 ratio
    const r = p.add_liquidity(new pool.add_liquidity_arguments(USER, VETH, VUSDT, 10 * E8, 50000 * E8, 0));
    expect(r.amount_a).toBe(10 * E8);
    expect(r.amount_b).toBe(30000 * E8);
    expect(r.shares).toBe((first + 1000) / 10);
    expect(p.get_shares(new pool.shares_arguments(VETH, VUSDT, USER)).value).toBe(r.shares);
  });

  it("small swaps still pay at least 1 unit of fee (rounded up)", () => {
    const p = setup(100);
    seed(p, 100 * E8, 300000 * E8);
    const q = p.get_quote(new pool.quote_arguments(VUSDT, VETH, 150)).value;
    // fee on 150 units at 1% = 1.5 -> 2, so 148 goes in
    const exp = u128.div(u128.mul(u128.fromU64(148), u128.fromU64(100 * E8)), u128.fromU64(300000 * E8 + 148)).toU64();
    expect(q).toBe(exp);
  });

  it("swap requires the trader's authority", () => {
    const p = setup(100);
    seed(p, 100 * E8, 300000 * E8);
    expect(() => {
      const p2 = new Pool();
      authorize([OTHER]);
      okCalls(2);
      p2.swap(new pool.swap_arguments(USER, VUSDT, VETH, 10 * E8, 0, new Uint8Array(0)));
    }).toThrow();
  });

  it("removing liquidity returns a fair share, fees included; nobody can take more than their shares", () => {
    const p = setup(100);
    const minted = seed(p, 100 * E8, 300000 * E8).shares;
    authorize([USER]);
    okCalls(2);
    p.swap(new pool.swap_arguments(USER, VUSDT, VETH, 30000 * E8, 0, new Uint8Array(0)));
    authorize([USER]);
    okCalls(2);
    p.swap(new pool.swap_arguments(USER, VETH, VUSDT, 10 * E8, 0, new Uint8Array(0)));


    const info = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    authorize([OWNER]);
    okCalls(2);
    const res = p.remove_liquidity(new pool.remove_liquidity_arguments(OWNER, VETH, VUSDT, minted, 0, 0));
    // owner gets everything except the 1000 locked shares' slice
    const sharesTotal = info.total_shares;
    const expA = u128.div(u128.mul(u128.fromU64(minted), u128.fromU64(info.reserve_a)), u128.fromU64(sharesTotal)).toU64();
    expect(res.amount_a + res.amount_b > 0).toBe(true);
    const after = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    expect(after.total_shares).toBe(1000);
    expect(info.reserve_a - after.reserve_a).toBe(expA);
    expect(() => {
      const p2 = new Pool();
      authorize([USER]);
      okCalls(2);
      p2.remove_liquidity(new pool.remove_liquidity_arguments(USER, VETH, VUSDT, 1, 0, 0));
    }).toThrow(); // USER has no shares
  });

  it("owner can claim the owner fees; others cannot", () => {
    const p = setup(300);
    seed(p, 100 * E8, 300000 * E8);
    authorize([USER]);
    okCalls(2);
    p.swap(new pool.swap_arguments(USER, VUSDT, VETH, 3000 * E8, 0, new Uint8Array(0)));
    const mid = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    expect(mid.owner_fees_a + mid.owner_fees_b).toBe((3000 * E8) * 3 / 100 / 10); // 3% fee, 10% of it
    authorize([OWNER]);
    okCalls(2);
    p.claim_owner_fees(new pool.claim_arguments(VETH, VUSDT, OWNER));
    expect(remaining()).toBe(1); // only one token (vUSDT) had fees, so one transfer
    const after = p.get_pool(new pool.pair_arguments(VETH, VUSDT));
    expect(after.owner_fees_a + after.owner_fees_b).toBe(0);
    expect(() => {
      const p2 = new Pool();
      authorize([USER]);
      okCalls(2);
      p2.claim_owner_fees(new pool.claim_arguments(VETH, VUSDT, USER));
    }).toThrow();
  });
});

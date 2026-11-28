import { Writer, Reader } from "as-proto";

export namespace pool {
  @unmanaged
  export class empty_object {
    static encode(message: empty_object, writer: Writer): void {}

    static decode(reader: Reader, length: i32): empty_object {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new empty_object();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class address {
    static encode(message: address, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_value);
      }
    }

    static decode(reader: Reader, length: i32): address {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new address();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: Uint8Array | null;

    constructor(value: Uint8Array | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class uint64 {
    static encode(message: uint64, writer: Writer): void {
      if (message.value != 0) {
        writer.uint32(8);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): uint64 {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new uint64();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: u64;

    constructor(value: u64 = 0) {
      this.value = value;
    }
  }

  export class pool_object {
    static encode(message: pool_object, writer: Writer): void {
      if (message.exists != false) {
        writer.uint32(8);
        writer.bool(message.exists);
      }

      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_b);
      }

      if (message.reserve_a != 0) {
        writer.uint32(32);
        writer.uint64(message.reserve_a);
      }

      if (message.reserve_b != 0) {
        writer.uint32(40);
        writer.uint64(message.reserve_b);
      }

      if (message.fee_bps != 0) {
        writer.uint32(48);
        writer.uint32(message.fee_bps);
      }

      if (message.owner_share_bps != 0) {
        writer.uint32(56);
        writer.uint32(message.owner_share_bps);
      }

      if (message.total_shares != 0) {
        writer.uint32(64);
        writer.uint64(message.total_shares);
      }

      if (message.owner_fees_a != 0) {
        writer.uint32(72);
        writer.uint64(message.owner_fees_a);
      }

      if (message.owner_fees_b != 0) {
        writer.uint32(80);
        writer.uint64(message.owner_fees_b);
      }
    }

    static decode(reader: Reader, length: i32): pool_object {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new pool_object();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.exists = reader.bool();
            break;

          case 2:
            message.token_a = reader.bytes();
            break;

          case 3:
            message.token_b = reader.bytes();
            break;

          case 4:
            message.reserve_a = reader.uint64();
            break;

          case 5:
            message.reserve_b = reader.uint64();
            break;

          case 6:
            message.fee_bps = reader.uint32();
            break;

          case 7:
            message.owner_share_bps = reader.uint32();
            break;

          case 8:
            message.total_shares = reader.uint64();
            break;

          case 9:
            message.owner_fees_a = reader.uint64();
            break;

          case 10:
            message.owner_fees_b = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    exists: bool;
    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    reserve_a: u64;
    reserve_b: u64;
    fee_bps: u32;
    owner_share_bps: u32;
    total_shares: u64;
    owner_fees_a: u64;
    owner_fees_b: u64;

    constructor(
      exists: bool = false,
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      reserve_a: u64 = 0,
      reserve_b: u64 = 0,
      fee_bps: u32 = 0,
      owner_share_bps: u32 = 0,
      total_shares: u64 = 0,
      owner_fees_a: u64 = 0,
      owner_fees_b: u64 = 0
    ) {
      this.exists = exists;
      this.token_a = token_a;
      this.token_b = token_b;
      this.reserve_a = reserve_a;
      this.reserve_b = reserve_b;
      this.fee_bps = fee_bps;
      this.owner_share_bps = owner_share_bps;
      this.total_shares = total_shares;
      this.owner_fees_a = owner_fees_a;
      this.owner_fees_b = owner_fees_b;
    }
  }

  export class initialize_arguments {
    static encode(message: initialize_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(reader: Reader, length: i32): initialize_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new initialize_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;

    constructor(owner: Uint8Array | null = null) {
      this.owner = owner;
    }
  }

  export class pair_arguments {
    static encode(message: pair_arguments, writer: Writer): void {
      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_b);
      }
    }

    static decode(reader: Reader, length: i32): pair_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new pair_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_a = reader.bytes();
            break;

          case 2:
            message.token_b = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_a: Uint8Array | null;
    token_b: Uint8Array | null;

    constructor(
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null
    ) {
      this.token_a = token_a;
      this.token_b = token_b;
    }
  }

  export class create_pool_arguments {
    static encode(message: create_pool_arguments, writer: Writer): void {
      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_b);
      }

      if (message.fee_bps != 0) {
        writer.uint32(24);
        writer.uint32(message.fee_bps);
      }
    }

    static decode(reader: Reader, length: i32): create_pool_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_pool_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_a = reader.bytes();
            break;

          case 2:
            message.token_b = reader.bytes();
            break;

          case 3:
            message.fee_bps = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    fee_bps: u32;

    constructor(
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      fee_bps: u32 = 0
    ) {
      this.token_a = token_a;
      this.token_b = token_b;
      this.fee_bps = fee_bps;
    }
  }

  export class add_liquidity_arguments {
    static encode(message: add_liquidity_arguments, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_b);
      }

      if (message.amount_a != 0) {
        writer.uint32(32);
        writer.uint64(message.amount_a);
      }

      if (message.amount_b != 0) {
        writer.uint32(40);
        writer.uint64(message.amount_b);
      }

      if (message.min_shares != 0) {
        writer.uint32(48);
        writer.uint64(message.min_shares);
      }

      const unique_name_shares_to = message.shares_to;
      if (unique_name_shares_to !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_shares_to);
      }
    }

    static decode(reader: Reader, length: i32): add_liquidity_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new add_liquidity_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.token_a = reader.bytes();
            break;

          case 3:
            message.token_b = reader.bytes();
            break;

          case 4:
            message.amount_a = reader.uint64();
            break;

          case 5:
            message.amount_b = reader.uint64();
            break;

          case 6:
            message.min_shares = reader.uint64();
            break;

          case 7:
            message.shares_to = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    from: Uint8Array | null;
    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    amount_a: u64;
    amount_b: u64;
    min_shares: u64;
    shares_to: Uint8Array | null;

    constructor(
      from: Uint8Array | null = null,
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      amount_a: u64 = 0,
      amount_b: u64 = 0,
      min_shares: u64 = 0,
      shares_to: Uint8Array | null = null
    ) {
      this.from = from;
      this.token_a = token_a;
      this.token_b = token_b;
      this.amount_a = amount_a;
      this.amount_b = amount_b;
      this.min_shares = min_shares;
      this.shares_to = shares_to;
    }
  }

  @unmanaged
  export class add_liquidity_result {
    static encode(message: add_liquidity_result, writer: Writer): void {
      if (message.shares != 0) {
        writer.uint32(8);
        writer.uint64(message.shares);
      }

      if (message.amount_a != 0) {
        writer.uint32(16);
        writer.uint64(message.amount_a);
      }

      if (message.amount_b != 0) {
        writer.uint32(24);
        writer.uint64(message.amount_b);
      }
    }

    static decode(reader: Reader, length: i32): add_liquidity_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new add_liquidity_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.shares = reader.uint64();
            break;

          case 2:
            message.amount_a = reader.uint64();
            break;

          case 3:
            message.amount_b = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    shares: u64;
    amount_a: u64;
    amount_b: u64;

    constructor(shares: u64 = 0, amount_a: u64 = 0, amount_b: u64 = 0) {
      this.shares = shares;
      this.amount_a = amount_a;
      this.amount_b = amount_b;
    }
  }

  export class remove_liquidity_arguments {
    static encode(message: remove_liquidity_arguments, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_b);
      }

      if (message.shares != 0) {
        writer.uint32(32);
        writer.uint64(message.shares);
      }

      if (message.min_a != 0) {
        writer.uint32(40);
        writer.uint64(message.min_a);
      }

      if (message.min_b != 0) {
        writer.uint32(48);
        writer.uint64(message.min_b);
      }
    }

    static decode(reader: Reader, length: i32): remove_liquidity_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new remove_liquidity_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.token_a = reader.bytes();
            break;

          case 3:
            message.token_b = reader.bytes();
            break;

          case 4:
            message.shares = reader.uint64();
            break;

          case 5:
            message.min_a = reader.uint64();
            break;

          case 6:
            message.min_b = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    from: Uint8Array | null;
    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    shares: u64;
    min_a: u64;
    min_b: u64;

    constructor(
      from: Uint8Array | null = null,
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      shares: u64 = 0,
      min_a: u64 = 0,
      min_b: u64 = 0
    ) {
      this.from = from;
      this.token_a = token_a;
      this.token_b = token_b;
      this.shares = shares;
      this.min_a = min_a;
      this.min_b = min_b;
    }
  }

  @unmanaged
  export class remove_liquidity_result {
    static encode(message: remove_liquidity_result, writer: Writer): void {
      if (message.amount_a != 0) {
        writer.uint32(8);
        writer.uint64(message.amount_a);
      }

      if (message.amount_b != 0) {
        writer.uint32(16);
        writer.uint64(message.amount_b);
      }
    }

    static decode(reader: Reader, length: i32): remove_liquidity_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new remove_liquidity_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.amount_a = reader.uint64();
            break;

          case 2:
            message.amount_b = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    amount_a: u64;
    amount_b: u64;

    constructor(amount_a: u64 = 0, amount_b: u64 = 0) {
      this.amount_a = amount_a;
      this.amount_b = amount_b;
    }
  }

  export class swap_arguments {
    static encode(message: swap_arguments, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_token_in = message.token_in;
      if (unique_name_token_in !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_in);
      }

      const unique_name_token_out = message.token_out;
      if (unique_name_token_out !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_out);
      }

      if (message.amount_in != 0) {
        writer.uint32(32);
        writer.uint64(message.amount_in);
      }

      if (message.min_out != 0) {
        writer.uint32(40);
        writer.uint64(message.min_out);
      }

      const unique_name_receiver = message.receiver;
      if (unique_name_receiver !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_receiver);
      }
    }

    static decode(reader: Reader, length: i32): swap_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new swap_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.token_in = reader.bytes();
            break;

          case 3:
            message.token_out = reader.bytes();
            break;

          case 4:
            message.amount_in = reader.uint64();
            break;

          case 5:
            message.min_out = reader.uint64();
            break;

          case 6:
            message.receiver = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    from: Uint8Array | null;
    token_in: Uint8Array | null;
    token_out: Uint8Array | null;
    amount_in: u64;
    min_out: u64;
    receiver: Uint8Array | null;

    constructor(
      from: Uint8Array | null = null,
      token_in: Uint8Array | null = null,
      token_out: Uint8Array | null = null,
      amount_in: u64 = 0,
      min_out: u64 = 0,
      receiver: Uint8Array | null = null
    ) {
      this.from = from;
      this.token_in = token_in;
      this.token_out = token_out;
      this.amount_in = amount_in;
      this.min_out = min_out;
      this.receiver = receiver;
    }
  }

  export class quote_arguments {
    static encode(message: quote_arguments, writer: Writer): void {
      const unique_name_token_in = message.token_in;
      if (unique_name_token_in !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_in);
      }

      const unique_name_token_out = message.token_out;
      if (unique_name_token_out !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_out);
      }

      if (message.amount_in != 0) {
        writer.uint32(24);
        writer.uint64(message.amount_in);
      }
    }

    static decode(reader: Reader, length: i32): quote_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new quote_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_in = reader.bytes();
            break;

          case 2:
            message.token_out = reader.bytes();
            break;

          case 3:
            message.amount_in = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_in: Uint8Array | null;
    token_out: Uint8Array | null;
    amount_in: u64;

    constructor(
      token_in: Uint8Array | null = null,
      token_out: Uint8Array | null = null,
      amount_in: u64 = 0
    ) {
      this.token_in = token_in;
      this.token_out = token_out;
      this.amount_in = amount_in;
    }
  }

  export class shares_arguments {
    static encode(message: shares_arguments, writer: Writer): void {
      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_b);
      }

      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): shares_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new shares_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_a = reader.bytes();
            break;

          case 2:
            message.token_b = reader.bytes();
            break;

          case 3:
            message.account = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    account: Uint8Array | null;

    constructor(
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      account: Uint8Array | null = null
    ) {
      this.token_a = token_a;
      this.token_b = token_b;
      this.account = account;
    }
  }

  export class fee_settings {
    static encode(message: fee_settings, writer: Writer): void {
      const unique_name_fee_to = message.fee_to;
      if (unique_name_fee_to !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_fee_to);
      }

      const unique_name_collector = message.collector;
      if (unique_name_collector !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_collector);
      }
    }

    static decode(reader: Reader, length: i32): fee_settings {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new fee_settings();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.fee_to = reader.bytes();
            break;

          case 2:
            message.collector = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    fee_to: Uint8Array | null;
    collector: Uint8Array | null;

    constructor(
      fee_to: Uint8Array | null = null,
      collector: Uint8Array | null = null
    ) {
      this.fee_to = fee_to;
      this.collector = collector;
    }
  }

  export class claim_arguments {
    static encode(message: claim_arguments, writer: Writer): void {
      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_b);
      }

      const unique_name_to = message.to;
      if (unique_name_to !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_to);
      }
    }

    static decode(reader: Reader, length: i32): claim_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new claim_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_a = reader.bytes();
            break;

          case 2:
            message.token_b = reader.bytes();
            break;

          case 3:
            message.to = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    to: Uint8Array | null;

    constructor(
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      to: Uint8Array | null = null
    ) {
      this.token_a = token_a;
      this.token_b = token_b;
      this.to = to;
    }
  }

  export class token_transfer_arguments {
    static encode(message: token_transfer_arguments, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_to = message.to;
      if (unique_name_to !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_to);
      }

      if (message.value != 0) {
        writer.uint32(24);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): token_transfer_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new token_transfer_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.to = reader.bytes();
            break;

          case 3:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    from: Uint8Array | null;
    to: Uint8Array | null;
    value: u64;

    constructor(
      from: Uint8Array | null = null,
      to: Uint8Array | null = null,
      value: u64 = 0
    ) {
      this.from = from;
      this.to = to;
      this.value = value;
    }
  }

  export class swap_event {
    static encode(message: swap_event, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_token_in = message.token_in;
      if (unique_name_token_in !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_in);
      }

      const unique_name_token_out = message.token_out;
      if (unique_name_token_out !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_out);
      }

      if (message.amount_in != 0) {
        writer.uint32(32);
        writer.uint64(message.amount_in);
      }

      if (message.amount_out != 0) {
        writer.uint32(40);
        writer.uint64(message.amount_out);
      }

      if (message.fee != 0) {
        writer.uint32(48);
        writer.uint64(message.fee);
      }

      if (message.owner_fee != 0) {
        writer.uint32(56);
        writer.uint64(message.owner_fee);
      }
    }

    static decode(reader: Reader, length: i32): swap_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new swap_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.token_in = reader.bytes();
            break;

          case 3:
            message.token_out = reader.bytes();
            break;

          case 4:
            message.amount_in = reader.uint64();
            break;

          case 5:
            message.amount_out = reader.uint64();
            break;

          case 6:
            message.fee = reader.uint64();
            break;

          case 7:
            message.owner_fee = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    from: Uint8Array | null;
    token_in: Uint8Array | null;
    token_out: Uint8Array | null;
    amount_in: u64;
    amount_out: u64;
    fee: u64;
    owner_fee: u64;

    constructor(
      from: Uint8Array | null = null,
      token_in: Uint8Array | null = null,
      token_out: Uint8Array | null = null,
      amount_in: u64 = 0,
      amount_out: u64 = 0,
      fee: u64 = 0,
      owner_fee: u64 = 0
    ) {
      this.from = from;
      this.token_in = token_in;
      this.token_out = token_out;
      this.amount_in = amount_in;
      this.amount_out = amount_out;
      this.fee = fee;
      this.owner_fee = owner_fee;
    }
  }

  export class sync_event {
    static encode(message: sync_event, writer: Writer): void {
      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_b);
      }

      if (message.reserve_a != 0) {
        writer.uint32(24);
        writer.uint64(message.reserve_a);
      }

      if (message.reserve_b != 0) {
        writer.uint32(32);
        writer.uint64(message.reserve_b);
      }
    }

    static decode(reader: Reader, length: i32): sync_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new sync_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_a = reader.bytes();
            break;

          case 2:
            message.token_b = reader.bytes();
            break;

          case 3:
            message.reserve_a = reader.uint64();
            break;

          case 4:
            message.reserve_b = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    reserve_a: u64;
    reserve_b: u64;

    constructor(
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      reserve_a: u64 = 0,
      reserve_b: u64 = 0
    ) {
      this.token_a = token_a;
      this.token_b = token_b;
      this.reserve_a = reserve_a;
      this.reserve_b = reserve_b;
    }
  }

  export class liquidity_event {
    static encode(message: liquidity_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token_b);
      }

      if (message.amount_a != 0) {
        writer.uint32(32);
        writer.uint64(message.amount_a);
      }

      if (message.amount_b != 0) {
        writer.uint32(40);
        writer.uint64(message.amount_b);
      }

      if (message.shares != 0) {
        writer.uint32(48);
        writer.uint64(message.shares);
      }

      if (message.added != false) {
        writer.uint32(56);
        writer.bool(message.added);
      }
    }

    static decode(reader: Reader, length: i32): liquidity_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new liquidity_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.token_a = reader.bytes();
            break;

          case 3:
            message.token_b = reader.bytes();
            break;

          case 4:
            message.amount_a = reader.uint64();
            break;

          case 5:
            message.amount_b = reader.uint64();
            break;

          case 6:
            message.shares = reader.uint64();
            break;

          case 7:
            message.added = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    amount_a: u64;
    amount_b: u64;
    shares: u64;
    added: bool;

    constructor(
      account: Uint8Array | null = null,
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      amount_a: u64 = 0,
      amount_b: u64 = 0,
      shares: u64 = 0,
      added: bool = false
    ) {
      this.account = account;
      this.token_a = token_a;
      this.token_b = token_b;
      this.amount_a = amount_a;
      this.amount_b = amount_b;
      this.shares = shares;
      this.added = added;
    }
  }

  export class pool_created_event {
    static encode(message: pool_created_event, writer: Writer): void {
      const unique_name_token_a = message.token_a;
      if (unique_name_token_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_token_a);
      }

      const unique_name_token_b = message.token_b;
      if (unique_name_token_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token_b);
      }

      if (message.fee_bps != 0) {
        writer.uint32(24);
        writer.uint32(message.fee_bps);
      }

      if (message.owner_share_bps != 0) {
        writer.uint32(32);
        writer.uint32(message.owner_share_bps);
      }
    }

    static decode(reader: Reader, length: i32): pool_created_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new pool_created_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.token_a = reader.bytes();
            break;

          case 2:
            message.token_b = reader.bytes();
            break;

          case 3:
            message.fee_bps = reader.uint32();
            break;

          case 4:
            message.owner_share_bps = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    token_a: Uint8Array | null;
    token_b: Uint8Array | null;
    fee_bps: u32;
    owner_share_bps: u32;

    constructor(
      token_a: Uint8Array | null = null,
      token_b: Uint8Array | null = null,
      fee_bps: u32 = 0,
      owner_share_bps: u32 = 0
    ) {
      this.token_a = token_a;
      this.token_b = token_b;
      this.fee_bps = fee_bps;
      this.owner_share_bps = owner_share_bps;
    }
  }
}

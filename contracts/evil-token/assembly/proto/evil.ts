import { Writer, Reader } from "as-proto";

export namespace evil {
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

  export class balance_of_args {
    static encode(message: balance_of_args, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(reader: Reader, length: i32): balance_of_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new balance_of_args();

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

  export class transfer_args {
    static encode(message: transfer_args, writer: Writer): void {
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

    static decode(reader: Reader, length: i32): transfer_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new transfer_args();

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

  export class mint_args {
    static encode(message: mint_args, writer: Writer): void {
      const unique_name_to = message.to;
      if (unique_name_to !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_to);
      }

      if (message.value != 0) {
        writer.uint32(16);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): mint_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new mint_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.to = reader.bytes();
            break;

          case 2:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    to: Uint8Array | null;
    value: u64;

    constructor(to: Uint8Array | null = null, value: u64 = 0) {
      this.to = to;
      this.value = value;
    }
  }

  export class approve_args {
    static encode(message: approve_args, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_spender = message.spender;
      if (unique_name_spender !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_spender);
      }

      if (message.value != 0) {
        writer.uint32(24);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): approve_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new approve_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.spender = reader.bytes();
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

    owner: Uint8Array | null;
    spender: Uint8Array | null;
    value: u64;

    constructor(
      owner: Uint8Array | null = null,
      spender: Uint8Array | null = null,
      value: u64 = 0
    ) {
      this.owner = owner;
      this.spender = spender;
      this.value = value;
    }
  }

  export class target_args {
    static encode(message: target_args, writer: Writer): void {
      const unique_name_victim = message.victim;
      if (unique_name_victim !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_victim);
      }

      const unique_name_thief = message.thief;
      if (unique_name_thief !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_thief);
      }

      const unique_name_koin = message.koin;
      if (unique_name_koin !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_koin);
      }

      const unique_name_other = message.other;
      if (unique_name_other !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_other);
      }

      const unique_name_pool = message.pool;
      if (unique_name_pool !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_pool);
      }

      const unique_name_pool_token = message.pool_token;
      if (unique_name_pool_token !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_pool_token);
      }
    }

    static decode(reader: Reader, length: i32): target_args {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new target_args();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.victim = reader.bytes();
            break;

          case 2:
            message.thief = reader.bytes();
            break;

          case 3:
            message.koin = reader.bytes();
            break;

          case 4:
            message.other = reader.bytes();
            break;

          case 5:
            message.pool = reader.bytes();
            break;

          case 6:
            message.pool_token = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    victim: Uint8Array | null;
    thief: Uint8Array | null;
    koin: Uint8Array | null;
    other: Uint8Array | null;
    pool: Uint8Array | null;
    pool_token: Uint8Array | null;

    constructor(
      victim: Uint8Array | null = null,
      thief: Uint8Array | null = null,
      koin: Uint8Array | null = null,
      other: Uint8Array | null = null,
      pool: Uint8Array | null = null,
      pool_token: Uint8Array | null = null
    ) {
      this.victim = victim;
      this.thief = thief;
      this.koin = koin;
      this.other = other;
      this.pool = pool;
      this.pool_token = pool_token;
    }
  }

  @unmanaged
  export class attempts {
    static encode(message: attempts, writer: Writer): void {
      if (message.tried != 0) {
        writer.uint32(8);
        writer.uint64(message.tried);
      }

      if (message.succeeded != 0) {
        writer.uint32(16);
        writer.uint64(message.succeeded);
      }
    }

    static decode(reader: Reader, length: i32): attempts {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new attempts();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.tried = reader.uint64();
            break;

          case 2:
            message.succeeded = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    tried: u64;
    succeeded: u64;

    constructor(tried: u64 = 0, succeeded: u64 = 0) {
      this.tried = tried;
      this.succeeded = succeeded;
    }
  }
}

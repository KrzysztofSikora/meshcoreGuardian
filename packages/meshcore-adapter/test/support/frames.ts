// Builds companion frames byte by byte from the firmware layouts (companion_radio/MyMesh.cpp),
// little-endian like the firmware's memcpy of native integers. No Node globals (see
// mesh-core-connection.int.test.ts), so text is written as char codes.

export class FrameBuilder {
  private readonly bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value).u8(value >> 8);
  }

  u32(value: number): this {
    return this.u16(value & 0xffff).u16(value >>> 16);
  }

  /** Two's complement, so negative values work for int16/int32 fields. */
  i16(value: number): this {
    return this.u16(value & 0xffff);
  }

  i32(value: number): this {
    return this.u32(value >>> 0);
  }

  raw(bytes: ArrayLike<number>): this {
    this.bytes.push(...Array.from(bytes));
    return this;
  }

  /** ASCII text in a zero-padded field of `size` bytes, or unpadded when `size` is omitted. */
  text(value: string, size?: number): this {
    const codes = Array.from(value, (char) => char.charCodeAt(0));
    this.raw(codes);
    if (size !== undefined) this.raw(new Array<number>(size - codes.length).fill(0));
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export const frame = (code: number) => new FrameBuilder().u8(code);

/** `count` bytes starting at `first`, incrementing: distinct values make field mix-ups visible. */
export const sequence = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => (first + index) & 0xff);

export const PUBLIC_KEY = sequence(0xa0, 32);
export const PUBLIC_KEY_HEX = PUBLIC_KEY.map((byte) => byte.toString(16).padStart(2, "0")).join("");
export const KEY_PREFIX = PUBLIC_KEY.slice(0, 6);
export const KEY_PREFIX_HEX = PUBLIC_KEY_HEX.slice(0, 12);

export interface DeviceInfoOptions {
  pin?: number;
  /** Bytes after the firmware version string: `repeat` (v9+) and `path_hash_mode` (v10+). */
  trailer?: number[];
}

/** RESP_CODE_DEVICE_INFO as firmware 1.17 sends it (82 bytes with both trailer bytes). */
export function deviceInfoFrame({ pin = 123456, trailer = [1, 2] }: DeviceInfoOptions = {}) {
  return frame(13)
    .u8(10) // FIRMWARE_VER_CODE
    .u8(175) // MAX_CONTACTS / 2
    .u8(40) // MAX_GROUP_CHANNELS
    .u32(pin) // ble_pin
    .text("11 Oct 2026", 12)
    .text("Heltec V3", 40)
    .text("v1.17.1", 20)
    .raw(trailer)
    .build();
}

export interface ContactOptions {
  type?: number;
  pathLen?: number;
  path?: number[];
  name?: string;
}

/** RESP_CODE_CONTACT (148 bytes). */
export function contactFrame({
  type = 2,
  pathLen = 0x42,
  path = sequence(0x11, 4),
  name = "Repeater K",
}: ContactOptions = {}) {
  const outPath = new Array<number>(64).fill(0);
  outPath.splice(0, path.length, ...path);
  return frame(3)
    .raw(PUBLIC_KEY)
    .u8(type)
    .u8(0x05) // flags
    .u8(pathLen)
    .raw(outPath)
    .text(name, 32)
    .u32(1_760_000_000) // last_advert_timestamp
    .i32(52_229_675) // gps_lat x 1e6
    .i32(-21_012_228) // gps_lon x 1e6
    .u32(1_760_000_100) // lastmod
    .build();
}

/** RESP_CODE_SELF_INFO with the node name at the end. */
export function selfInfoFrame(name = "Base") {
  return frame(5)
    .u8(1) // ADV_TYPE_CHAT
    .u8(22) // tx_power_dbm
    .u8(30) // MAX_LORA_TX_POWER
    .raw(PUBLIC_KEY)
    .i32(52_229_675)
    .i32(-21_012_228)
    .u8(1) // multi_acks
    .u8(2) // advert_loc_policy
    .u8(0x15) // telemetry modes
    .u8(1) // manual_add_contacts
    .u32(869_525) // freq x 1000
    .u32(250_000) // bw x 1000
    .u8(11) // sf
    .u8(5) // cr
    .text(name)
    .build();
}

export const STATS = {
  battMilliVolts: 4012,
  currTxQueueLen: 3,
  noiseFloor: -112,
  lastRssi: -97,
  nPacketsRecv: 70_001,
  nPacketsSent: 50_002,
  totalAirTimeSecs: 3_003,
  totalUpTimeSecs: 864_004,
  nSentFlood: 40_005,
  nSentDirect: 10_006,
  nRecvFlood: 60_007,
  nRecvDirect: 9_008,
  errEvents: 9,
  lastSnrX4: -26,
  nDirectDups: 11,
  nFloodDups: 1_212,
};

/** The 48-byte stats struct shared by repeater and room-server firmware. */
export function statsBytes(stats = STATS): Uint8Array {
  return new FrameBuilder()
    .u16(stats.battMilliVolts)
    .u16(stats.currTxQueueLen)
    .i16(stats.noiseFloor)
    .i16(stats.lastRssi)
    .u32(stats.nPacketsRecv)
    .u32(stats.nPacketsSent)
    .u32(stats.totalAirTimeSecs)
    .u32(stats.totalUpTimeSecs)
    .u32(stats.nSentFlood)
    .u32(stats.nSentDirect)
    .u32(stats.nRecvFlood)
    .u32(stats.nRecvDirect)
    .u16(stats.errEvents)
    .i16(stats.lastSnrX4)
    .u16(stats.nDirectDups)
    .u16(stats.nFloodDups)
    .build();
}

/** A push frame `[code, reserved, key prefix (6), payload]` (login, status, telemetry). */
export function pushFrame(code: number, payload: ArrayLike<number> = [], reserved = 0) {
  return frame(code).u8(reserved).raw(KEY_PREFIX).raw(payload).build();
}

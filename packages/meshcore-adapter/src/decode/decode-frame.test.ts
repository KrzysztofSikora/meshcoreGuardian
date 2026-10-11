import { describe, expect, it } from "vitest";

import {
  contactFrame,
  deviceInfoFrame,
  frame,
  KEY_PREFIX_HEX,
  PUBLIC_KEY_HEX,
  pushFrame,
  selfInfoFrame,
  STATS,
  statsBytes,
} from "../../test/support/frames";
import { decodeFrame } from "./decode-frame";
import { MalformedFrameError } from "./errors";

// CayenneLPP, big-endian: channel 1 voltage 4.05 V, channel 1 temperature -3.5 °C, channel 2 GPS.
const LPP = [
  ...[0x01, 116, 0x01, 0x95],
  ...[0x01, 103, 0xff, 0xdd],
  ...[0x02, 136, 0x07, 0xf8, 0x38, 0xff, 0xe0, 0xc0, 0x00, 0x27, 0x10],
];

const valid: [string, Uint8Array, unknown][] = [
  [
    "deviceInfo",
    deviceInfoFrame(),
    {
      kind: "deviceInfo",
      firmwareVerCode: 10,
      maxContacts: 350,
      maxChannels: 40,
      buildDate: "11 Oct 2026",
      manufacturer: "Heltec V3",
      firmwareVersion: "v1.17.1",
      repeatEnabled: true,
      pathHashMode: 2,
    },
  ],
  [
    "selfInfo",
    selfInfoFrame("Base K"),
    {
      kind: "selfInfo",
      advType: 1,
      txPower: 22,
      maxTxPower: 30,
      publicKey: PUBLIC_KEY_HEX,
      lat: 52.229675,
      lon: -21.012228,
      manualAddContacts: 1,
      radioFreq: 869_525,
      radioBw: 250_000,
      radioSf: 11,
      radioCr: 5,
      name: "Base K",
    },
  ],
  ["contactsStart", frame(2).u32(347).build(), { kind: "contactsStart", count: 347 }],
  [
    "contact",
    contactFrame(),
    {
      kind: "contact",
      publicKey: PUBLIC_KEY_HEX,
      type: 2,
      flags: 5,
      path: { raw: 0x42, kind: "known", hashSize: 2, hops: 2 },
      outPath: "11121314",
      name: "Repeater K",
      lastAdvert: 1_760_000_000,
      lat: 52.229675,
      lon: -21.012228,
      lastMod: 1_760_000_100,
    },
  ],
  [
    "endOfContacts",
    frame(4).u32(1_760_000_100).build(),
    { kind: "endOfContacts", mostRecentLastMod: 1_760_000_100 },
  ],
  [
    "sent (flood)",
    frame(6).u8(1).u32(0xdeadbeef).u32(12_345).build(),
    { kind: "sent", flood: true, tag: 0xdeadbeef, estTimeoutMs: 12_345 },
  ],
  [
    "sent (direct)",
    frame(6).u8(0).u32(7).u32(800).build(),
    { kind: "sent", flood: false, tag: 7, estTimeoutMs: 800 },
  ],
  ["ok", frame(0).build(), { kind: "ok" }],
  ["err with code", frame(1).u8(2).build(), { kind: "err", code: 2 }],
  ["err without code", frame(1).build(), { kind: "err" }],
  [
    "loginSuccess (legacy)",
    pushFrame(0x85, [], 0),
    { kind: "loginSuccess", keyPrefix: KEY_PREFIX_HEX, permissions: 0 },
  ],
  [
    "loginSuccess (new format)",
    pushFrame(0x85, [0x78, 0x56, 0x34, 0x12, 0x03, 0x09], 1),
    {
      kind: "loginSuccess",
      keyPrefix: KEY_PREFIX_HEX,
      permissions: 1,
      tag: 0x12345678,
      aclPermissions: 3,
      firmwareLevel: 9,
    },
  ],
  ["loginFail", pushFrame(0x86), { kind: "loginFail", keyPrefix: KEY_PREFIX_HEX }],
  [
    "statusResponse",
    pushFrame(0x87, [...statsBytes(), 0xaa, 0xbb]),
    { kind: "statusResponse", keyPrefix: KEY_PREFIX_HEX, stats: STATS, extraHex: "aabb" },
  ],
  [
    "telemetryResponse",
    pushFrame(0x8b, LPP),
    {
      kind: "telemetryResponse",
      keyPrefix: KEY_PREFIX_HEX,
      values: [
        { channel: 1, type: 116, value: 4.05 },
        { channel: 1, type: 103, value: -3.5 },
        { channel: 2, type: 136, value: { latitude: 52.2296, longitude: -0.8, altitude: 100 } },
      ],
      lppHex: LPP.map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    },
  ],
  [
    "other (advert push)",
    frame(0x80).raw(new Array(32).fill(1)).build(),
    { kind: "other", code: 0x80, length: 33 },
  ],
  ["other (unknown code)", frame(0x55).build(), { kind: "other", code: 0x55, length: 1 }],
];

describe("decodeFrame", () => {
  it.each(valid)("decodes %s", (_, bytes, expected) => {
    expect(decodeFrame(bytes)).toEqual(expected);
  });

  it("returns JSON-safe records (no byte arrays)", () => {
    for (const [, bytes, expected] of valid) {
      expect(JSON.parse(JSON.stringify(decodeFrame(bytes)))).toEqual(expected);
    }
  });

  it("reads out_path_len as unsigned, so 0xFF is an unknown path with no hashes", () => {
    expect(decodeFrame(contactFrame({ pathLen: 0xff, path: [9, 9] }))).toMatchObject({
      path: { raw: 0xff, kind: "unknown" },
      outPath: "",
    });
  });

  it("takes hash size x hops bytes of the stored path", () => {
    expect(
      decodeFrame(
        contactFrame({
          pathLen: 0x85,
          path: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        }),
      ),
    ).toMatchObject({
      path: { raw: 0x85, kind: "known", hashSize: 3, hops: 5 },
      outPath: "0102030405060708090a0b0c0d0e0f",
    });
    expect(decodeFrame(contactFrame({ pathLen: 0x80 }))).toMatchObject({ outPath: "" });
    // 0xBF claims 3 x 63 bytes; the stored path field holds 64, and the name follows it.
    const longest = decodeFrame(
      contactFrame({ pathLen: 0xbf, path: new Array<number>(64).fill(0x7e) }),
    );
    expect(longest).toMatchObject({ outPath: "7e".repeat(64), name: "Repeater K" });
  });

  it("keeps a 32-byte contact name that has no terminator", () => {
    const name = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    expect(decodeFrame(contactFrame({ name }))).toMatchObject({ name });
  });

  const truncated: [string, Uint8Array, number][] = [
    ["deviceInfo", deviceInfoFrame({ trailer: [] }).subarray(0, 79), 80],
    ["selfInfo", selfInfoFrame("").subarray(0, 57), 58],
    ["contactsStart", frame(2).u16(1).build(), 5],
    ["contact", contactFrame().subarray(0, 147), 148],
    ["endOfContacts", frame(4).u16(1).build(), 5],
    ["sent", frame(6).u8(0).u32(1).u16(1).build(), 10],
    ["loginSuccess", pushFrame(0x85).subarray(0, 7), 8],
    ["loginFail", pushFrame(0x86).subarray(0, 7), 8],
    ["statusResponse", pushFrame(0x87, statsBytes().subarray(0, 47)), 56],
    ["telemetryResponse", pushFrame(0x8b).subarray(0, 7), 8],
  ];

  it.each(truncated)("throws MalformedFrameError for a truncated %s frame", (_, bytes, needed) => {
    expect(() => decodeFrame(bytes)).toThrowError(MalformedFrameError);
    expect(() => decodeFrame(bytes)).toThrowError(
      expect.objectContaining({ code: bytes[0], length: bytes.length, needed }),
    );
  });

  it("throws MalformedFrameError for telemetry cut inside a value", () => {
    const bytes = pushFrame(0x8b, [0x01, 116, 0x01]);
    expect(() => decodeFrame(bytes)).toThrowError(
      expect.objectContaining({ code: 0x8b, length: 11, needed: 12 }),
    );
  });

  it("throws MalformedFrameError for an empty frame", () => {
    expect(() => decodeFrame(new Uint8Array(0))).toThrowError(
      expect.objectContaining({ code: null, length: 0, needed: 1 }),
    );
  });

  it("decodes a frame that is a view into a larger buffer", () => {
    const backing = Uint8Array.from([0xee, ...frame(2).u32(9).build(), 0xee]);
    expect(decodeFrame(backing.subarray(1, 6))).toEqual({ kind: "contactsStart", count: 9 });
  });
});

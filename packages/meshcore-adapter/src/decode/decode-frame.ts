// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the ambient module must travel with the source to consumers (plan-review #7)
/// <reference path="../types/meshcore-js.d.ts" />
import { CayenneLpp, Connection } from "@liamcottle/meshcore.js";

import { cString, requireLength, toHex, u32le, u8 } from "./bytes";
import { decodeDeviceInfo, type DeviceInfo } from "./device-info";
import { MalformedFrameError } from "./errors";
import { decodePathLen, type PathLen } from "./path";
import { decodeStats, type RemoteStats } from "./status";

/** CayenneLPP reading as meshcore.js parses it; GPS values are `{ latitude, longitude, altitude }`. */
export interface TelemetryValue {
  channel: number;
  type: number;
  value: number | { latitude: number; longitude: number; altitude: number };
}

/** A companion frame as a JSON-safe record: byte arrays are lower-case hex, positions degrees. */
export type DecodedFrame =
  | ({ kind: "deviceInfo" } & DeviceInfo)
  | {
      kind: "selfInfo";
      advType: number;
      txPower: number;
      maxTxPower: number;
      publicKey: string;
      lat: number;
      lon: number;
      manualAddContacts: number;
      radioFreq: number;
      radioBw: number;
      radioSf: number;
      radioCr: number;
      name: string;
    }
  | { kind: "contactsStart"; count: number }
  | {
      kind: "contact";
      publicKey: string;
      type: number;
      flags: number;
      path: PathLen;
      /** The `hashSize × hops` bytes of the stored path; empty when no path is known. */
      outPath: string;
      name: string;
      lastAdvert: number;
      lat: number;
      lon: number;
      lastMod: number;
    }
  | { kind: "endOfContacts"; mostRecentLastMod: number }
  | { kind: "sent"; flood: boolean; tag: number; estTimeoutMs: number }
  | { kind: "ok" }
  | { kind: "err"; code?: number }
  | {
      kind: "loginSuccess";
      keyPrefix: string;
      permissions: number;
      tag?: number;
      aclPermissions?: number;
      firmwareLevel?: number;
    }
  | { kind: "loginFail"; keyPrefix: string }
  | { kind: "statusResponse"; keyPrefix: string; stats: RemoteStats; extraHex: string }
  | { kind: "telemetryResponse"; keyPrefix: string; values: TelemetryValue[]; lppHex: string }
  | { kind: "other"; code: number; length: number };

// Codes from Constants.ResponseCodes / PushCodes (firmware 1.17 companion_radio/MyMesh.cpp).
const Code = {
  Ok: 0,
  Err: 1,
  ContactsStart: 2,
  Contact: 3,
  EndOfContacts: 4,
  SelfInfo: 5,
  Sent: 6,
  DeviceInfo: 13,
  LoginSuccess: 0x85,
  LoginFail: 0x86,
  StatusResponse: 0x87,
  TelemetryResponse: 0x8b,
} as const;

const SELF_INFO_MIN = 58;
const CONTACT_LENGTH = 148;
const CONTACT_PATH_AT = 36;
const CONTACT_NAME_AT = 100;
const NAME_LENGTH = 32;
/** `[code, reserved, pub_key prefix (6)]` before the payload of login, status and telemetry. */
const PUSH_HEADER = 8;
/** New login format (v7+): server tag (u32), ACL permissions, FIRMWARE_VER_LEVEL. */
const LOGIN_SUCCESS_EXTENDED = 14;
const DEGREES_E6 = 1e6;

/** meshcore.js event payloads, only the fields we take from the library. */
interface LibrarySelfInfo {
  type: number;
  txPower: number;
  maxTxPower: number;
  advLat: number;
  advLon: number;
  manualAddContacts: number;
  radioFreq: number;
  radioBw: number;
  radioSf: number;
  radioCr: number;
  name: string;
}
interface LibraryContact {
  type: number;
  flags: number;
  lastAdvert: number;
  advLat: number;
  advLon: number;
  lastMod: number;
}
interface LibrarySent {
  result: number;
  expectedAckCrc: number;
  estTimeout: number;
}

/**
 * A `Connection` used only for its per-code parsers. meshcore.js delivers events through
 * `setTimeout(0)`, so `emit` is overridden to capture the payload synchronously (D-1).
 */
class ParseOnlyConnection extends Connection {
  private captured: unknown;

  override emit(event: string | number, ...data: unknown[]): void {
    if (event !== "rx") this.captured = data[0];
  }

  parse<T>(frame: Uint8Array): T {
    this.captured = undefined;
    this.onFrameReceived(frame);
    return this.captured as T;
  }
}

const library = new ParseOnlyConnection();

const keyPrefix = (frame: Uint8Array) => toHex(frame.subarray(2, PUSH_HEADER));

/**
 * Decodes one complete companion frame. meshcore.js parses where it reads firmware 1.17
 * correctly; device info, contact path length and name, the extended login success, login fail
 * and the status struct are read from the raw bytes (D-1). Throws `MalformedFrameError` when the
 * frame is shorter than its layout.
 */
export function decodeFrame(frame: Uint8Array): DecodedFrame {
  requireLength(frame, 1);
  const code = u8(frame, 0);
  switch (code) {
    case Code.DeviceInfo:
      return { kind: "deviceInfo", ...decodeDeviceInfo(frame) };
    case Code.SelfInfo: {
      requireLength(frame, SELF_INFO_MIN);
      const self = library.parse<LibrarySelfInfo>(frame);
      return {
        kind: "selfInfo",
        advType: self.type,
        txPower: self.txPower,
        maxTxPower: self.maxTxPower,
        publicKey: toHex(frame.subarray(4, 36)),
        lat: self.advLat / DEGREES_E6,
        lon: self.advLon / DEGREES_E6,
        manualAddContacts: self.manualAddContacts,
        radioFreq: self.radioFreq,
        radioBw: self.radioBw,
        radioSf: self.radioSf,
        radioCr: self.radioCr,
        name: self.name,
      };
    }
    case Code.ContactsStart:
      requireLength(frame, 5);
      return { kind: "contactsStart", count: library.parse<{ count: number }>(frame).count };
    case Code.Contact:
      return decodeContact(frame);
    case Code.EndOfContacts:
      requireLength(frame, 5);
      return {
        kind: "endOfContacts",
        mostRecentLastMod: library.parse<{ mostRecentLastmod: number }>(frame).mostRecentLastmod,
      };
    case Code.Sent: {
      requireLength(frame, 10);
      const sent = library.parse<LibrarySent>(frame);
      return {
        kind: "sent",
        flood: sent.result === 1,
        tag: sent.expectedAckCrc,
        estTimeoutMs: sent.estTimeout,
      };
    }
    case Code.Ok:
      return { kind: "ok" };
    case Code.Err: {
      const { errCode } = library.parse<{ errCode: number | null }>(frame);
      return errCode === null ? { kind: "err" } : { kind: "err", code: errCode };
    }
    case Code.LoginSuccess:
      return decodeLoginSuccess(frame);
    case Code.LoginFail:
      // Not handled by meshcore.js 1.15.0.
      requireLength(frame, PUSH_HEADER);
      return { kind: "loginFail", keyPrefix: keyPrefix(frame) };
    case Code.StatusResponse:
      // meshcore.js parses the struct only inside getStatus(); the push carries it raw.
      return {
        kind: "statusResponse",
        keyPrefix: keyPrefix(frame),
        ...decodeStats(frame, PUSH_HEADER),
      };
    case Code.TelemetryResponse:
      return decodeTelemetry(frame);
    default:
      return { kind: "other", code, length: frame.length };
  }
}

function decodeContact(frame: Uint8Array): DecodedFrame {
  requireLength(frame, CONTACT_LENGTH);
  const contact = library.parse<LibraryContact>(frame);
  // meshcore.js reads out_path_len as int8 (0xFF → -1).
  const path = decodePathLen(u8(frame, CONTACT_PATH_AT - 1));
  const pathBytes = path.kind === "known" ? path.hashSize * path.hops : 0;
  return {
    kind: "contact",
    publicKey: toHex(frame.subarray(1, 33)),
    type: contact.type,
    flags: contact.flags,
    path,
    outPath: toHex(frame.subarray(CONTACT_PATH_AT, CONTACT_PATH_AT + Math.min(pathBytes, 64))),
    // meshcore.js returns undefined for a name that fills all 32 bytes.
    name: cString(frame, CONTACT_NAME_AT, NAME_LENGTH),
    lastAdvert: contact.lastAdvert,
    lat: contact.advLat / DEGREES_E6,
    lon: contact.advLon / DEGREES_E6,
    lastMod: contact.lastMod,
  };
}

function decodeLoginSuccess(frame: Uint8Array): DecodedFrame {
  requireLength(frame, PUSH_HEADER);
  const login = library.parse<{ reserved: number }>(frame);
  const base = {
    kind: "loginSuccess",
    keyPrefix: keyPrefix(frame),
    permissions: login.reserved,
  } as const;
  // meshcore.js stops after the prefix; firmware v7+ appends tag, ACL and firmware level.
  if (frame.length < LOGIN_SUCCESS_EXTENDED) return base;
  return {
    ...base,
    tag: u32le(frame, PUSH_HEADER),
    aclPermissions: u8(frame, PUSH_HEADER + 4),
    firmwareLevel: u8(frame, PUSH_HEADER + 5),
  };
}

function decodeTelemetry(frame: Uint8Array): DecodedFrame {
  requireLength(frame, PUSH_HEADER);
  const lpp = frame.subarray(PUSH_HEADER);
  let values: TelemetryValue[];
  try {
    values = CayenneLpp.parse(lpp) as TelemetryValue[];
  } catch (error) {
    // A value cut short makes meshcore.js read past the end (DataView RangeError).
    if (error instanceof RangeError)
      throw new MalformedFrameError(u8(frame, 0), frame.length, frame.length + 1);
    throw error;
  }
  return { kind: "telemetryResponse", keyPrefix: keyPrefix(frame), values, lppHex: toHex(lpp) };
}

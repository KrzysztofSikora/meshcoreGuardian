import type { GeoPoint } from "@guardian/domain";

import { CONTACTS_FRAMES } from "./contacts-script";
import type { ScriptFrame } from "./fake-transport";
import { HANDSHAKE_FRAMES } from "./handshake-script";

const DEGREES_E6 = 1_000_000;
const SELF_LAT_AT = 36;
const SELF_LON_AT = 40;
const CONTACT_PATH_LEN_AT = 35;
const CONTACT_LAT_AT = 136;
const CONTACT_LON_AT = 140;
const NO_PATH = 0xff;
const KEY_PREFIX_BYTES = 4;

export interface ContactGeo {
  /** Hop count with hash size 1, or `null` for an unknown path (0xFF). */
  hops: number | null;
  /** Advertised position, or `null` for 0,0 (never advertised). */
  position: GeoPoint | null;
}

function toBytes(hex: string): number[] {
  return hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [];
}

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function writeI32(bytes: number[], at: number, degrees: number): void {
  const value = Math.round(degrees * DEGREES_E6) >>> 0;
  for (let i = 0; i < 4; i += 1) bytes[at + i] = (value >>> (8 * i)) & 0xff;
}

/** Rewrites the position (self-info bytes 36–43) of every self-info frame (code 0x05). */
export function withSelfPosition(
  frames: readonly ScriptFrame[],
  point: GeoPoint,
): ScriptFrame[] {
  return frames.map((entry) => {
    if (entry.dir !== "rx" || !entry.hex.startsWith("05")) return entry;
    const bytes = toBytes(entry.hex);
    writeI32(bytes, SELF_LAT_AT, point.lat);
    writeI32(bytes, SELF_LON_AT, point.lon);
    return { ...entry, hex: toHex(bytes) };
  });
}

/**
 * Rewrites path length (byte 35) and advertised position (bytes 136–143) of the contact frames
 * (code 0x03) whose public key starts with a key of `edits` (8 hex characters). Others stay as
 * recorded.
 */
export function withContactGeo(
  frames: readonly ScriptFrame[],
  edits: Readonly<Record<string, ContactGeo>>,
): ScriptFrame[] {
  return frames.map((entry) => {
    if (entry.dir !== "rx" || !entry.hex.startsWith("03")) return entry;
    const edit = edits[entry.hex.slice(2, 2 + KEY_PREFIX_BYTES * 2)];
    if (edit === undefined) return entry;
    const bytes = toBytes(entry.hex);
    bytes[CONTACT_PATH_LEN_AT] = edit.hops ?? NO_PATH;
    writeI32(bytes, CONTACT_LAT_AT, edit.position?.lat ?? 0);
    writeI32(bytes, CONTACT_LON_AT, edit.position?.lon ?? 0);
    return { ...entry, hex: toHex(bytes) };
  });
}

/** The companion stands in Kraków (plan D-11 scenario `nearest`). */
export const NEAREST_COMPANION_POSITION: GeoPoint = { lat: 50.0647, lon: 19.945 };

/**
 * Seven repeaters with mixed paths and positions, keyed by the first 4 public-key bytes:
 * direct and near, 1 hop with and without position, 2 hops with and without, unknown path with
 * and without. The other recorded repeaters keep an unknown path and no position.
 */
export const NEAREST_CONTACT_GEO: Readonly<Record<string, ContactGeo>> = {
  "66b91ae6": { hops: 0, position: { lat: 50.07, lon: 19.96 } }, // PL-KR-WRBL-RPT
  "2fe5eea3": { hops: 1, position: { lat: 50.1, lon: 20.1 } }, // KWI Zabierzów B.|RPT*
  d7c747dc: { hops: 1, position: null }, // krotkofalowcy.pulawy.pl
  afe66fb9: { hops: 2, position: { lat: 49.95, lon: 19.8 } }, // PL-KLI Laskowa-Krb
  f6db508e: { hops: 2, position: null }, // TOS-Sarnowek(7PA)
  "4ade48a5": { hops: null, position: { lat: 50.3, lon: 19.2 } }, // PL-12-08-Kozlow_ADE
  "6183c924": { hops: null, position: null }, // PL-TSA Sandomierz
};

export const NEAREST_HANDSHAKE_FRAMES: readonly ScriptFrame[] = withSelfPosition(
  HANDSHAKE_FRAMES,
  NEAREST_COMPANION_POSITION,
);

export const NEAREST_CONTACTS_FRAMES: readonly ScriptFrame[] = withContactGeo(
  CONTACTS_FRAMES,
  NEAREST_CONTACT_GEO,
);

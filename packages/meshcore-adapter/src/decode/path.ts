/**
 * A contact's `out_path_len` byte (firmware `Packet.h`): bits 6–7 = hash size − 1, bits 0–5 = hop
 * count. 0xFF means no known path (flood). meshcore.js 1.15.0 reads the byte as int8. UNVERIFIED
 * until a capture confirms it.
 */
export type PathLen =
  { raw: number; kind: "unknown" } | { raw: number; kind: "known"; hashSize: number; hops: number };

const NO_KNOWN_PATH = 0xff;

export function decodePathLen(raw: number): PathLen {
  if (raw === NO_KNOWN_PATH) return { raw, kind: "unknown" };
  return { raw, kind: "known", hashSize: (raw >> 6) + 1, hops: raw & 0x3f };
}

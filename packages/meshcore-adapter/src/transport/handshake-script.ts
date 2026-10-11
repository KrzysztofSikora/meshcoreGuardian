import type { ScriptFrame } from "./fake-transport";

/**
 * Frames 0–3 of `fixtures/v1.17.1-d929643/handshake.json`: device query, device info, app start,
 * self info (plan D-3). `handshake-script.int.test.ts` keeps them equal to the capture.
 */
export const HANDSHAKE_FRAMES: readonly ScriptFrame[] = [
  { dir: "tx", tMs: 1.2, hex: "1603" },
  {
    dir: "rx",
    tMs: 96.2,
    hex: "0d0daf280000000031342d4175672d323032360048656c7465632056330000000000000000000000000000000000000000000000000000000000000076312e31372e312d6439323936343300000000000002",
  },
  { dir: "tx", tMs: 97.6, hex: "010100000000000074657374" },
  {
    dir: "rx",
    tMs: 193.3,
    hex: "0501161678ec1714b64eab24393ac527922b0f1798ecebf7449a9c5fb37cc9a41d6fa53e000000000000000000000000f2440d0024f400000805636f6d70616e696f6e",
  },
];

const VER_CODE_AT = 1;
const VERSION_AT = 60;
const VERSION_LENGTH = 20;

/**
 * Rewrites the firmware version code (byte 1) and version string (bytes 60–79, zero padded) of
 * every device-info frame (code 0x0d) and leaves everything else as recorded.
 */
export function withFirmware(
  frames: readonly ScriptFrame[],
  { verCode, version }: { verCode: number; version: string },
): ScriptFrame[] {
  if (version.length >= VERSION_LENGTH) throw new Error("Firmware version too long");
  return frames.map((entry) => {
    if (entry.dir !== "rx" || !entry.hex.startsWith("0d")) return entry;
    const bytes = entry.hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [];
    bytes[VER_CODE_AT] = verCode;
    for (let index = 0; index < VERSION_LENGTH; index += 1) {
      bytes[VERSION_AT + index] = version.charCodeAt(index) || 0;
    }
    return { ...entry, hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join("") };
  });
}

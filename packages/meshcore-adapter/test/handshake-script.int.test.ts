import { describe, expect, it } from "vitest";

import { decodeFrame } from "../src";
import { HANDSHAKE_FRAMES, withFirmware } from "../src/transport/handshake-script";

// Vite resolves this at transform time; the adapter compiles without Node or Vite client types.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?raw"; import: "default" },
    ): Record<string, string>;
  }
}

const files = import.meta.glob("../fixtures/v1.17.1-d929643/handshake.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
const fixture = JSON.parse(Object.values(files)[0] ?? "null") as {
  frames: { dir: string; tMs: number; hex: string }[];
};

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

describe("HANDSHAKE_FRAMES", () => {
  it("equals frames 0–3 of the recorded handshake byte for byte", () => {
    const recorded = fixture.frames.slice(0, 4).map(({ dir, tMs, hex }) => ({ dir, tMs, hex }));
    expect(HANDSHAKE_FRAMES).toEqual(recorded);
  });
});

describe("withFirmware", () => {
  it("changes only the version code and version string of device info", () => {
    const patched = withFirmware(HANDSHAKE_FRAMES, { verCode: 4, version: "v1.4.0" });
    const original = decodeFrame(fromHex(HANDSHAKE_FRAMES[1]!.hex));
    const changed = decodeFrame(fromHex(patched[1]!.hex));
    expect(changed).toEqual({ ...original, firmwareVerCode: 4, firmwareVersion: "v1.4.0" });
    expect(patched[0]).toEqual(HANDSHAKE_FRAMES[0]);
    expect(patched[2]).toEqual(HANDSHAKE_FRAMES[2]);
    expect(patched[3]).toEqual(HANDSHAKE_FRAMES[3]);
    expect(patched[1]!.hex).toHaveLength(HANDSHAKE_FRAMES[1]!.hex.length);
  });

  it("refuses a version that does not fit the field", () => {
    expect(() => withFirmware(HANDSHAKE_FRAMES, { verCode: 1, version: "x".repeat(20) })).toThrow();
  });
});

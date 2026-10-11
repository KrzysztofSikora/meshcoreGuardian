import { describe, expect, it } from "vitest";

import { decodeFrame, readFixture, type DecodedFrame, type Fixture } from "../src";

// Vite resolves this at transform time; the adapter compiles without Node or Vite client types.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?raw"; import: "default" },
    ): Record<string, string>;
  }
}

/** Every committed capture (TR-06, FR-00 AC3), as raw text so the leak check sees the file itself. */
const files = import.meta.glob("../fixtures/**/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

const fixtures = Object.entries(files).map(([path, text]) => ({
  path,
  text,
  fixture: readFixture(JSON.parse(text)),
}));

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

function decodedOf<K extends DecodedFrame["kind"]>(fixture: Fixture, kind: K) {
  return fixture.frames
    .filter((frame) => frame.dir === "rx" && frame.decoded?.kind === kind)
    .map((frame) => ({ frame, decoded: frame.decoded as Extract<DecodedFrame, { kind: K }> }));
}

/** The canary the capture tests use as a guest password (TR-09). */
const CANARY = "pw-LEAK-CANARY";
/** Push code 0x88: SNR, RSSI and the raw packet the companion heard; only the first two are kept. */
const RX_LOG = "88";
const asHex = (text: string) =>
  Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");

describe("committed fixtures", () => {
  it("has at least one capture", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(1);
  });

  describe.each(fixtures)("$path", ({ text, fixture }) => {
    it("decodes every rx frame to the recorded value", () => {
      for (const frame of fixture.frames.filter((frame) => frame.dir === "rx")) {
        const bytes = fromHex(frame.hex);
        if (frame.decodeError !== undefined) {
          expect(() => decodeFrame(bytes), `frame ${frame.seq}`).toThrow(
            frame.decodeError.slice(frame.decodeError.indexOf(": ") + 2),
          );
        } else {
          expect(decodeFrame(bytes), `frame ${frame.seq}`).toEqual(frame.decoded);
        }
      }
    });

    it("has a header firmware equal to the decoded device info", () => {
      const [first] = decodedOf(fixture, "deviceInfo");
      if (first === undefined) {
        expect(fixture.header.firmware).toBeNull();
        return;
      }
      expect(fixture.header.firmware).toEqual({
        version: first.decoded.firmwareVersion,
        buildDate: first.decoded.buildDate,
        verCode: first.decoded.firmwareVerCode,
        model: first.decoded.manufacturer,
      });
    });

    it("has summary counts that match its frames", () => {
      expect(fixture.summary.frames).toEqual({
        tx: fixture.frames.filter((frame) => frame.dir === "tx").length,
        rx: fixture.frames.filter((frame) => frame.dir === "rx").length,
        decodeErrors: fixture.frames.filter((frame) => frame.decodeError !== undefined).length,
      });
      const seqs = fixture.frames.map((frame) => frame.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      const times = fixture.frames.map((frame) => frame.tMs);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    // Decoder-independent facts (plan-review #1).
    it("announces as many contacts as it lists, when the sync completed", () => {
      const [start] = decodedOf(fixture, "contactsStart");
      if (start === undefined || decodedOf(fixture, "endOfContacts").length === 0) return;
      expect(decodedOf(fixture, "contact")).toHaveLength(start.decoded.count);
    });

    it("answers only from the target node", () => {
      const pushes = [
        ...decodedOf(fixture, "loginSuccess"),
        ...decodedOf(fixture, "loginFail"),
        ...decodedOf(fixture, "statusResponse"),
        ...decodedOf(fixture, "telemetryResponse"),
      ];
      if (pushes.length === 0) return;
      const target = fixture.header.targetKeyPrefix;
      expect(target).not.toBeNull();
      for (const { decoded } of pushes) {
        const shorter = Math.min(decoded.keyPrefix.length, target!.length);
        expect(decoded.keyPrefix.slice(0, shorter)).toBe(target!.slice(0, shorter));
      }
    });

    // Redaction, checked on the raw bytes (plan-review #2, D-4, D-13). The human grep stays.
    it("holds no guest password canary", () => {
      expect(text).not.toContain(CANARY);
      expect(text.toLowerCase()).not.toContain(asHex(CANARY));
    });

    it("holds no BLE PIN and no companion position or name", () => {
      for (const { frame } of decodedOf(fixture, "deviceInfo")) {
        expect(frame.hex.slice(8, 16), `frame ${frame.seq} ble_pin`).toBe("00000000");
      }
      for (const { frame, decoded } of decodedOf(fixture, "selfInfo")) {
        expect(frame.hex.slice(72, 88), `frame ${frame.seq} lat/lon`).toBe("0".repeat(16));
        expect(decoded.name).toBe("companion");
      }
    });

    it("holds no raw over-the-air packet from an RX log push (D-20)", () => {
      for (const frame of fixture.frames.filter((frame) => frame.dir === "rx")) {
        if (frame.hex.startsWith(RX_LOG)) expect(frame.hex, `frame ${frame.seq}`).toHaveLength(6);
      }
    });
  });
});

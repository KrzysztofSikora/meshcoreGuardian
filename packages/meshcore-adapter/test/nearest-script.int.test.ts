import { describe, expect, it } from "vitest";

import {
  CONTACTS_FRAMES,
  HANDSHAKE_FRAMES,
  NEAREST_COMPANION_POSITION,
  NEAREST_CONTACT_GEO,
  NEAREST_CONTACTS_FRAMES,
  NEAREST_HANDSHAKE_FRAMES,
  decodeFrame,
  withContactGeo,
  withSelfPosition,
} from "../src";

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

describe("NEAREST_HANDSHAKE_FRAMES", () => {
  it("sets the companion position and nothing else", () => {
    const self = NEAREST_HANDSHAKE_FRAMES[3]!;
    const decoded = decodeFrame(bytes(self.hex));
    expect(decoded).toMatchObject({
      kind: "selfInfo",
      lat: NEAREST_COMPANION_POSITION.lat,
      lon: NEAREST_COMPANION_POSITION.lon,
    });
    expect(NEAREST_HANDSHAKE_FRAMES.slice(0, 3)).toEqual(HANDSHAKE_FRAMES.slice(0, 3));
    expect(self.hex).toHaveLength(HANDSHAKE_FRAMES[3]!.hex.length);
    expect(self.hex.slice(0, 72)).toBe(HANDSHAKE_FRAMES[3]!.hex.slice(0, 72));
    expect(self.hex.slice(88)).toBe(HANDSHAKE_FRAMES[3]!.hex.slice(88));
  });

  it("handles negative coordinates", () => {
    const [, , , self] = withSelfPosition(HANDSHAKE_FRAMES, { lat: -33.8688, lon: -70.5 });
    expect(decodeFrame(bytes(self!.hex))).toMatchObject({ lat: -33.8688, lon: -70.5 });
  });
});

describe("NEAREST_CONTACTS_FRAMES", () => {
  it("keeps the frame count, directions and timings", () => {
    expect(NEAREST_CONTACTS_FRAMES.map(({ dir, tMs }) => ({ dir, tMs }))).toEqual(
      CONTACTS_FRAMES.map(({ dir, tMs }) => ({ dir, tMs })),
    );
  });

  it("applies each edit and leaves the other contacts as recorded", () => {
    let edited = 0;
    NEAREST_CONTACTS_FRAMES.forEach((entry, index) => {
      const original = CONTACTS_FRAMES[index]!;
      if (!entry.hex.startsWith("03")) {
        expect(entry).toEqual(original);
        return;
      }
      const decoded = decodeFrame(bytes(entry.hex));
      if (decoded.kind !== "contact") throw new Error("not a contact");
      const edit = NEAREST_CONTACT_GEO[decoded.publicKey.slice(0, 8)];
      if (edit === undefined) {
        expect(entry).toEqual(original);
        return;
      }
      edited += 1;
      expect(decoded.path).toEqual(
        edit.hops === null
          ? expect.objectContaining({ kind: "unknown" })
          : expect.objectContaining({ kind: "known", hops: edit.hops }),
      );
      expect(decoded.lat).toBeCloseTo(edit.position?.lat ?? 0, 6);
      expect(decoded.lon).toBeCloseTo(edit.position?.lon ?? 0, 6);
      const before = decodeFrame(bytes(original.hex));
      expect(decoded).toMatchObject({ name: (before as { name: string }).name });
      expect(entry.hex).toHaveLength(original.hex.length);
    });
    // The derived type-4 contact "Sensor test" shares the prefix of the first repeater.
    expect(edited).toBe(Object.keys(NEAREST_CONTACT_GEO).length + 1);
  });

  it("ignores frames that are not contacts", () => {
    expect(withContactGeo(CONTACTS_FRAMES.slice(0, 2), { "02000000": { hops: 1, position: null } }))
      .toEqual(CONTACTS_FRAMES.slice(0, 2));
  });
});

import { describe, expect, it } from "vitest";

import { CONTACTS_FRAMES, decodeFrame } from "../src";

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
  frames: { seq: number; dir: string; tMs: number; hex: string }[];
};
const recorded = (seq: number) => fixture.frames.find((f) => f.seq === seq)!;
const strip = ({ dir, tMs, hex }: { dir: string; tMs: number; hex: string }) => ({
  dir,
  tMs,
  hex,
});
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

describe("CONTACTS_FRAMES", () => {
  const contacts = CONTACTS_FRAMES.slice(2, -1);

  it("writes once, then only receives", () => {
    expect(CONTACTS_FRAMES.map((f) => f.dir)).toEqual([
      "tx",
      ...Array.from({ length: CONTACTS_FRAMES.length - 1 }, () => "rx"),
    ]);
  });

  it("starts with the recorded get-contacts write", () => {
    expect(CONTACTS_FRAMES[0]).toEqual(strip(recorded(4)));
  });

  it("holds the recorded contact frames 6–35 byte for byte, with their timing", () => {
    expect(contacts.slice(0, 30)).toEqual(
      Array.from({ length: 30 }, (_, index) => strip(recorded(6 + index))),
    );
  });

  it("rewrites only the count in contactsStart", () => {
    const start = CONTACTS_FRAMES[1]!;
    expect(start.dir).toBe(recorded(5).dir);
    expect(start.tMs).toBe(recorded(5).tMs);
    expect(decodeFrame(bytes(start.hex))).toEqual({ kind: "contactsStart", count: 31 });
    expect(start.hex.slice(0, 2)).toBe(recorded(5).hex.slice(0, 2));
  });

  it("derives a type-4 contact that differs from seq 6 only in type, name and last key byte", () => {
    const derived = decodeFrame(bytes(contacts[30]!.hex));
    const base = decodeFrame(bytes(recorded(6).hex));
    if (derived.kind !== "contact" || base.kind !== "contact") throw new Error("not contacts");
    expect(derived.type).toBe(4);
    expect(derived.name).toBe("Sensor test");
    expect(derived.publicKey.slice(0, 62)).toBe(base.publicKey.slice(0, 62));
    expect(derived.publicKey).not.toBe(base.publicKey);
    expect({ ...derived, type: 0, name: "", publicKey: "" }).toEqual({
      ...base,
      type: 0,
      name: "",
      publicKey: "",
    });
  });

  it("announces as many contacts as it lists", () => {
    expect(contacts).toHaveLength(31);
    for (const entry of contacts) expect(decodeFrame(bytes(entry.hex)).kind).toBe("contact");
  });

  it("ends with the recorded endOfContacts, moved to just after the last contact", () => {
    const end = CONTACTS_FRAMES.at(-1)!;
    expect(end.hex).toBe(recorded(359).hex);
    expect(end.tMs).toBeGreaterThan(CONTACTS_FRAMES.at(-2)!.tMs);
    expect(end.tMs - CONTACTS_FRAMES[0]!.tMs).toBeLessThan(2_500);
  });

  it("keeps every timestamp non-decreasing", () => {
    const times = CONTACTS_FRAMES.map((f) => f.tMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

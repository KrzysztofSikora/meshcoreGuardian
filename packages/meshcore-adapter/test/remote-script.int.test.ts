import { describe, expect, it } from "vitest";

import {
  CONTACTS_FRAMES,
  DIAG_CONTACTS_FRAMES,
  REMOTE_FRAMES,
  decodeFrame,
  remoteScript,
} from "../src";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?raw"; import: "default" },
    ): Record<string, string>;
  }
}

const files = import.meta.glob("../fixtures/v1.17.1-d929643/remote.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
const fixture = JSON.parse(Object.values(files)[0] ?? "null") as {
  frames: { seq: number; dir: string; tMs: number; hex: string }[];
};
const recorded = (seq: number) => {
  const { dir, tMs, hex } = fixture.frames.find((f) => f.seq === seq)!;
  return { dir, tMs, hex };
};
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

describe("REMOTE_FRAMES", () => {
  it("holds the recorded login, status and telemetry exchanges byte for byte", () => {
    expect(REMOTE_FRAMES).toEqual([362, 363, 365, 368, 369, 371, 375, 376, 378].map(recorded));
  });

  it("is what remoteScript() builds with every step ok", () => {
    expect(remoteScript({})).toEqual(REMOTE_FRAMES);
  });
});

describe("remoteScript", () => {
  const [loginTx, loginSent, loginPush, statusTx, statusSent, statusPush, telTx, telSent] = [
    362, 363, 365, 368, 369, 371, 375, 376,
  ].map(recorded);

  it("no-reply keeps the request and its sent frame and drops the push", () => {
    expect(remoteScript({ status: "no-reply" })).toEqual([
      loginTx,
      loginSent,
      loginPush,
      statusTx,
      statusSent,
      telTx,
      telSent,
      recorded(378),
    ]);
  });

  it("err replaces sent by an error frame at the same time", () => {
    const frames = remoteScript({ login: "err" });
    expect(frames.slice(0, 2)).toEqual([loginTx, { ...loginSent, hex: "0102" }]);
    expect(frames).toHaveLength(2 + 6);
    expect(decodeFrame(bytes(frames[1]!.hex))).toEqual({ kind: "err", code: 2 });
  });

  it("malformed cuts only the push to two bytes", () => {
    const frames = remoteScript({ status: "malformed" });
    expect(frames.slice(3, 6)).toEqual([
      statusTx,
      statusSent,
      { ...statusPush, hex: statusPush!.hex.slice(0, 4) },
    ]);
    expect(() => decodeFrame(bytes(frames[5]!.hex))).toThrow();
  });

  it("keeps timestamps non-decreasing", () => {
    for (const spec of [{}, { login: "err" }, { status: "no-reply" }] as const) {
      const times = remoteScript(spec).map((f) => f.tMs);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });
});

describe("DIAG_CONTACTS_FRAMES", () => {
  it("adds Room K and announces 32 contacts", () => {
    expect(DIAG_CONTACTS_FRAMES).toHaveLength(CONTACTS_FRAMES.length + 1);
    expect(decodeFrame(bytes(DIAG_CONTACTS_FRAMES[1]!.hex))).toEqual({
      kind: "contactsStart",
      count: 32,
    });
    const roomK = DIAG_CONTACTS_FRAMES.at(-2)!;
    expect(roomK.hex).toBe(recorded(219).hex);
    expect(decodeFrame(bytes(roomK.hex))).toMatchObject({
      kind: "contact",
      name: "Room K",
      type: 3,
    });
    expect(DIAG_CONTACTS_FRAMES.at(-1)).toEqual(CONTACTS_FRAMES.at(-1));
  });

  it("keeps every timestamp non-decreasing", () => {
    const times = DIAG_CONTACTS_FRAMES.map((f) => f.tMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

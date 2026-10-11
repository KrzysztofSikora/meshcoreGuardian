import { MeshCoreConnection, readFixture } from "@guardian/meshcore-adapter";
import { describe, expect, it } from "vitest";

import { FakeTransport } from "../test/support/fake-transport";
import {
  contactFrame,
  deviceInfoFrame,
  PIN,
  publicKey,
  selfInfoFrame,
  toHex,
} from "../test/support/frames";
import { RecordingTransport, redecodeFixture, type FixtureMeta } from "./recorder";

const CANARY = "pw-LEAK-CANARY";
const canaryHex = toHex(Array.from(CANARY, (char) => char.charCodeAt(0)));
const pinHex = toHex([PIN & 0xff, (PIN >> 8) & 0xff, (PIN >> 16) & 0xff, PIN >>> 24]);

const meta: FixtureMeta = {
  captureDate: "2026-10-11T12:00:00.000Z",
  tool: "@guardian/capture",
  libraries: { "@liamcottle/meshcore.js": "1.15.0" },
  scenario: "remote",
  targetKeyPrefix: "a0a1a2a3a4a5",
  requests: [{ kind: "login", outcome: "responded", estTimeoutMs: 3000, latencyMs: 2100 }],
};

/** A clock that returns the given times in order, then keeps the last. */
function times(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function setup(now?: () => number) {
  const inner = new FakeTransport();
  const recorder = new RecordingTransport(inner, now);
  return { inner, recorder };
}

describe("RecordingTransport (TR-09)", () => {
  it("keeps the login password out of the fixture JSON as text and as hex", async () => {
    const { recorder } = setup();
    const connection = new MeshCoreConnection(recorder);

    await connection.sendCommandSendLogin(Uint8Array.from(publicKey(0xa0)), CANARY);
    const json = JSON.stringify(recorder.fixture(meta));

    expect(json).not.toContain(CANARY);
    expect(json.toLowerCase()).not.toContain(canaryHex);
    expect(recorder.fixture(meta).header.redactions).toEqual(["sendLogin.password"]);
  });

  it("sends the unredacted login to the companion", async () => {
    const { inner, recorder } = setup();
    const connection = new MeshCoreConnection(recorder);

    await connection.sendCommandSendLogin(Uint8Array.from(publicKey(0xa0)), CANARY);

    expect(inner.writes).toHaveLength(1);
    expect(toHex(inner.writes[0] ?? [])).toContain(canaryHex);
    expect(recorder.recorded[0]?.hex).toBe(toHex([26, ...publicKey(0xa0)]));
  });

  it("keeps the BLE PIN and the companion's position out of the fixture", () => {
    const { inner, recorder } = setup();
    inner.push(deviceInfoFrame());
    inner.push(selfInfoFrame());

    const fixture = recorder.fixture(meta);
    expect(JSON.stringify(fixture)).not.toContain(pinHex);
    expect(fixture.frames[1]?.decoded).toMatchObject({ lat: 0, lon: 0, name: "companion" });
  });

  it("passes the original rx frame to listeners and the redacted one to the fixture", () => {
    const { inner, recorder } = setup();
    const received: Uint8Array[] = [];
    recorder.onFrame((frame) => received.push(frame));

    const info = deviceInfoFrame();
    inner.push(info);

    expect(received).toEqual([info]);
    expect(recorder.recorded[0]?.hex.slice(8, 16)).toBe("00000000");
  });

  it("records rx frames with their decoded value and tx frames without", async () => {
    const { inner, recorder } = setup(times(1000, 1003.25, 1010.04));
    await recorder.write(Uint8Array.from([22, 3]));
    inner.push(Uint8Array.from([0]));

    expect(recorder.recorded).toEqual([
      { seq: 0, dir: "tx", tMs: 3.3, hex: "1603" },
      { seq: 1, dir: "rx", tMs: 10, hex: "00", decoded: { kind: "ok" } },
    ]);
  });

  it("records a malformed rx frame with its decode error and keeps recording", () => {
    const { inner, recorder } = setup();
    inner.push(Uint8Array.from([2, 1])); // contacts start without the count
    inner.push(Uint8Array.from([0]));

    const [malformed, ok] = recorder.recorded;
    expect(malformed).toEqual({
      seq: 0,
      dir: "rx",
      tMs: expect.any(Number),
      hex: "0201",
      decodeError: "MalformedFrameError: Malformed frame (code 2): 2 bytes, needs 5",
    });
    expect(ok?.decoded).toEqual({ kind: "ok" });
    expect(recorder.fixture(meta).summary.frames).toEqual({ tx: 0, rx: 2, decodeErrors: 1 });
  });

  it("records an empty rx frame as a decode error", () => {
    const { inner, recorder } = setup();
    inner.push(new Uint8Array());
    expect(recorder.recorded[0]?.decodeError).toBe(
      "MalformedFrameError: Malformed frame (code none): 0 bytes, needs 1",
    );
  });

  it("builds a fixture that readFixture accepts, with the firmware from device info", async () => {
    const { inner, recorder } = setup();
    await recorder.write(Uint8Array.from([22, 3]));
    inner.push(deviceInfoFrame());
    inner.push(contactFrame({ type: 1, name: "Alice" }));

    const fixture = recorder.fixture({ ...meta, aborted: "transport_disconnected" });

    expect(readFixture(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
    expect(fixture.header).toEqual({
      firmware: { version: "v1.17.1", buildDate: "11 Oct 2026", verCode: 10, model: "Heltec V3" },
      captureDate: meta.captureDate,
      tool: meta.tool,
      libraries: meta.libraries,
      scenario: "remote",
      targetKeyPrefix: "a0a1a2a3a4a5",
      redactions: ["chatContact.latLon", "chatContact.name", "deviceInfo.blePin"],
    });
    expect(fixture.summary).toEqual({
      frames: { tx: 1, rx: 2, decodeErrors: 0 },
      requests: meta.requests,
      aborted: "transport_disconnected",
    });
    expect(JSON.stringify(fixture)).not.toContain("Alice");
  });

  it("has no firmware and no abort reason when neither happened", () => {
    const { recorder } = setup();
    const fixture = recorder.fixture({ ...meta, targetKeyPrefix: null, requests: [] });
    expect(fixture.header.firmware).toBeNull();
    expect(fixture.header.redactions).toEqual([]);
    expect(fixture.summary).toEqual({ frames: { tx: 0, rx: 0, decodeErrors: 0 }, requests: [] });
  });

  it("forwards disconnects and stops recording and delivering after close", async () => {
    const { inner, recorder } = setup();
    let disconnected = 0;
    const received: Uint8Array[] = [];
    recorder.onDisconnect(() => (disconnected += 1));
    recorder.onFrame((frame) => received.push(frame));

    inner.drop();
    await recorder.close();
    inner.push(Uint8Array.from([0]));

    expect(disconnected).toBe(1);
    expect(inner.closed).toBe(true);
    expect(inner.frameListenerCount).toBe(0);
    expect(received).toEqual([]);
    expect(recorder.recorded).toEqual([]);
  });

  it("unsubscribes a single listener", () => {
    const { inner, recorder } = setup();
    const received: Uint8Array[] = [];
    const unsubscribe = recorder.onFrame((frame) => received.push(frame));
    unsubscribe();
    inner.push(Uint8Array.from([0]));
    expect(received).toEqual([]);
    expect(recorder.recorded).toHaveLength(1);
  });
});

describe("redecodeFixture (plan-review #1)", () => {
  async function recorded() {
    const { inner, recorder } = setup();
    await recorder.write(Uint8Array.from([22, 3]));
    inner.push(deviceInfoFrame());
    inner.push(Uint8Array.from([2, 1]));
    inner.push(contactFrame({ type: 2, name: "Room K" }));
    return recorder.fixture(meta);
  }

  it("gives the same fixture when the decoders have not changed", async () => {
    const fixture = await recorded();
    expect(redecodeFixture(fixture)).toEqual(fixture);
  });

  it("replaces stale decoded values, errors and firmware from the recorded hex", async () => {
    const fixture = await recorded();
    const [tx, info, malformed, contact] = fixture.frames;
    const stale = {
      ...fixture,
      header: { ...fixture.header, firmware: null },
      frames: [
        tx,
        { ...info, decoded: { kind: "ok" } },
        { ...malformed, decodeError: undefined, decoded: { kind: "ok" } },
        { ...contact, decoded: undefined, decodeError: "Error: old decoder" },
      ],
      summary: { ...fixture.summary, frames: { tx: 1, rx: 3, decodeErrors: 7 } },
    } as typeof fixture;

    const redecoded = redecodeFixture(JSON.parse(JSON.stringify(stale)));

    expect(redecoded).toEqual(fixture);
    expect(Object.keys(redecoded.frames[2] ?? {})).not.toContain("decoded");
    expect(Object.keys(redecoded.frames[3] ?? {})).not.toContain("decodeError");
  });

  it("keeps tx frames, bytes, redactions and requests as recorded", async () => {
    const fixture = await recorded();
    const redecoded = redecodeFixture(fixture);
    expect(redecoded.frames.map(({ seq, dir, tMs, hex }) => ({ seq, dir, tMs, hex }))).toEqual(
      fixture.frames.map(({ seq, dir, tMs, hex }) => ({ seq, dir, tMs, hex })),
    );
    expect(redecoded.header.redactions).toEqual(fixture.header.redactions);
    expect(redecoded.summary.requests).toBe(fixture.summary.requests);
    expect(redecoded.frames[0]).toEqual({
      seq: 0,
      dir: "tx",
      tMs: expect.any(Number),
      hex: "1603",
    });
  });
});

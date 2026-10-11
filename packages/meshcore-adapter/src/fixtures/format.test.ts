import { describe, expect, it } from "vitest";

import { FixtureFormatError, readFixture, type Fixture } from "./format";

const valid = (): Fixture => ({
  formatVersion: 1,
  header: {
    firmware: { version: "v1.17.1", buildDate: "11 Oct 2026", verCode: 10, model: "Heltec V3" },
    captureDate: "2026-10-11T12:00:00.000Z",
    tool: "@guardian/capture",
    libraries: { "@liamcottle/meshcore.js": "1.15.0" },
    scenario: "remote",
    targetKeyPrefix: "a0a1a2a3a4a5",
    redactions: ["deviceInfo.blePin"],
  },
  frames: [
    { seq: 0, dir: "tx", tMs: 0, hex: "1603" },
    { seq: 1, dir: "rx", tMs: 12, hex: "00", decoded: { kind: "ok" } },
    { seq: 2, dir: "rx", tMs: 15, hex: "05", decodeError: "Malformed frame" },
  ],
  summary: {
    frames: { tx: 1, rx: 2, decodeErrors: 1 },
    requests: [
      { kind: "login", outcome: "responded", estTimeoutMs: 3000, latencyMs: 2100 },
      { kind: "login", outcome: "rejected" },
      { kind: "status", outcome: "no_response" },
    ],
    aborted: "transport_disconnected",
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- edits poke at untyped JSON
type JsonEdit = (json: any) => void;

/** Round-trips through JSON text like a committed file, then applies `edit` to the parsed copy. */
function withEdit(edit: JsonEdit): unknown {
  const json: unknown = JSON.parse(JSON.stringify(valid()));
  edit(json);
  return json;
}

describe("readFixture", () => {
  it("returns a valid fixture unchanged", () => {
    expect(readFixture(JSON.parse(JSON.stringify(valid())))).toEqual(valid());
  });

  it("accepts a run without device info, target or optional fields", () => {
    const json = withEdit((fixture) => {
      fixture.header.firmware = null;
      fixture.header.targetKeyPrefix = null;
      fixture.header.libraries = {};
      fixture.header.redactions = [];
      fixture.frames = [];
      fixture.summary.requests = [{ kind: "telemetry", outcome: "error" }];
      delete fixture.summary.aborted;
    });
    const fixture = readFixture(json);
    expect(fixture.header.firmware).toBeNull();
    expect(fixture.summary).toEqual({
      frames: { tx: 1, rx: 2, decodeErrors: 1 },
      requests: [{ kind: "telemetry", outcome: "error" }],
    });
  });

  it("drops fields the format does not define", () => {
    const fixture = readFixture(withEdit((json) => (json.frames[0].note = "x")));
    expect(fixture.frames[0]).toEqual({ seq: 0, dir: "tx", tMs: 0, hex: "1603" });
  });

  it.each<[string, JsonEdit, string]>([
    ["another format version", (json) => (json.formatVersion = 2), "formatVersion"],
    ["a missing header", (json) => delete json.header, "header: expected an object"],
    ["an array header", (json) => (json.header = []), "header: expected an object"],
    ["a string firmware", (json) => (json.header.firmware = "v1"), "header.firmware: expected an"],
    ["missing libraries", (json) => delete json.header.libraries, "header.libraries: expected an"],
    ["a string redaction list", (json) => (json.header.redactions = "x"), "header.redactions: exp"],
    ["a numeric firmware version", (json) => (json.header.firmware.version = 1), "version"],
    ["a string verCode", (json) => (json.header.firmware.verCode = "10"), "verCode"],
    ["a missing model", (json) => delete json.header.firmware.model, "firmware.model"],
    ["a missing build date", (json) => delete json.header.firmware.buildDate, "buildDate"],
    ["a missing capture date", (json) => delete json.header.captureDate, "captureDate"],
    ["a missing tool", (json) => delete json.header.tool, "header.tool"],
    ["a library without version", (json) => (json.header.libraries.x = 1), "libraries.x"],
    ["a missing scenario", (json) => delete json.header.scenario, "header.scenario"],
    ["a numeric target", (json) => (json.header.targetKeyPrefix = 5), "targetKeyPrefix"],
    ["a numeric redaction", (json) => (json.header.redactions = [1]), "redactions[0]"],
    ["frames as an object", (json) => (json.frames = {}), "frames: expected an array"],
    ["a frame that is not an object", (json) => (json.frames[1] = 1), "frames[1]"],
    ["a missing seq", (json) => delete json.frames[0].seq, "frames[0].seq"],
    ["an unknown direction", (json) => (json.frames[0].dir = "up"), "frames[0].dir"],
    ["a NaN-like time", (json) => (json.frames[0].tMs = null), "frames[0].tMs"],
    ["a numeric hex", (json) => (json.frames[0].hex = 16), "frames[0].hex: expected a string"],
    ["upper-case hex", (json) => (json.frames[0].hex = "AB"), "frames[0].hex"],
    ["a half byte of hex", (json) => (json.frames[0].hex = "abc"), "frames[0].hex"],
    ["non-hex characters", (json) => (json.frames[0].hex = "zz"), "frames[0].hex"],
    ["a string decoded", (json) => (json.frames[1].decoded = "ok"), "frames[1].decoded"],
    ["a numeric decodeError", (json) => (json.frames[2].decodeError = 1), "decodeError"],
    ["a missing summary", (json) => delete json.summary, "summary: expected an object"],
    ["missing frame counts", (json) => delete json.summary.frames, "summary.frames"],
    ["a string tx count", (json) => (json.summary.frames.tx = "1"), "summary.frames.tx"],
    ["a missing rx count", (json) => delete json.summary.frames.rx, "summary.frames.rx"],
    ["a missing error count", (json) => delete json.summary.frames.decodeErrors, "decodeErrors"],
    ["requests as an object", (json) => (json.summary.requests = {}), "summary.requests"],
    ["a request that is not an object", (json) => (json.summary.requests[1] = 1), "requests[1]: "],
    ["an unknown request kind", (json) => (json.summary.requests[0].kind = "ping"), "kind"],
    ["an unknown outcome", (json) => (json.summary.requests[0].outcome = "ok"), "outcome"],
    ["a string estimate", (json) => (json.summary.requests[0].estTimeoutMs = "1"), "estTimeout"],
    ["a string latency", (json) => (json.summary.requests[0].latencyMs = "1"), "latencyMs"],
    ["a numeric abort reason", (json) => (json.summary.aborted = 1), "summary.aborted"],
  ])("rejects %s", (_, edit, field) => {
    expect(() => readFixture(withEdit(edit))).toThrow(FixtureFormatError);
    expect(() => readFixture(withEdit(edit))).toThrow(field);
  });

  it.each([null, [], "fixture", 1])("rejects the root %j", (json) => {
    expect(() => readFixture(json)).toThrow("Fixture root: expected an object");
  });
});

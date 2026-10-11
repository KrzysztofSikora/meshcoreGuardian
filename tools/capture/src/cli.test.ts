import { MeshCoreConnection } from "@guardian/meshcore-adapter";
import { describe, expect, it } from "vitest";

import { FakeTransport } from "../test/support/fake-transport";
import { contactFrame, deviceInfoFrame, publicKey, toHex } from "../test/support/frames";
import {
  assertRemoteRunAllowed,
  CliUsageError,
  firmwareDir,
  fixtureFileName,
  formatSummary,
  parseCliArgs,
} from "./cli";
import { RecordingTransport } from "./recorder";

describe("parseCliArgs", () => {
  it.each(["handshake", "remote"] as const)("reads --scenario %s", (scenario) => {
    expect(parseCliArgs(["--scenario", scenario])).toEqual({ mode: "capture", scenario });
    expect(parseCliArgs([`--scenario=${scenario}`])).toEqual({ mode: "capture", scenario });
  });

  it("reads --redecode with a file", () => {
    expect(parseCliArgs(["--redecode", "fixtures/v1/remote.json"])).toEqual({
      mode: "redecode",
      file: "fixtures/v1/remote.json",
    });
  });

  it.each([
    [[], "Unknown or missing scenario undefined"],
    [["--scenario", "status-ok"], 'Unknown or missing scenario "status-ok"'],
    [["--scenario", "remote", "--redecode", "x.json"], "Use either --scenario or --redecode"],
    [["--target", "a0"], "Unknown option '--target'"],
    [["remote"], "Unexpected argument 'remote'"],
  ])("refuses %j with the usage", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(CliUsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
    expect(() => parseCliArgs(argv)).toThrow("Usage: pnpm capture --scenario handshake|remote");
  });
});

describe("assertRemoteRunAllowed (D-6)", () => {
  it("allows the first and second remote capture", () => {
    expect(() => assertRemoteRunAllowed([])).not.toThrow();
    expect(() => assertRemoteRunAllowed(["handshake.json", "remote.json"])).not.toThrow();
  });

  it("refuses a third, counting every firmware directory", () => {
    expect(() => assertRemoteRunAllowed(["remote.json", "handshake.json", "remote.json"])).toThrow(
      "2 remote captures exist already; the gate allows 2 (plan D-6)",
    );
    expect(() => assertRemoteRunAllowed(["remote.json", "remote-2.json"])).toThrow(CliUsageError);
  });

  it("does not count other files", () => {
    expect(() =>
      assertRemoteRunAllowed(["remote.txt", "remote-x.json", "my-remote.json"]),
    ).not.toThrow();
  });
});

describe("fixture file names (D-8)", () => {
  it("overwrites the handshake", () => {
    expect(fixtureFileName("handshake", ["handshake.json"])).toBe("handshake.json");
  });

  it("never overwrites a remote capture", () => {
    expect(fixtureFileName("remote", [])).toBe("remote.json");
    expect(fixtureFileName("remote", ["handshake.json", "remote.json"])).toBe("remote-2.json");
    expect(fixtureFileName("remote", ["remote.json", "remote-2.json"])).toBe("remote-3.json");
  });

  it.each([
    ["v1.17.1", "v1.17.1"],
    ["1.17.1-abc (dev)", "1.17.1-abc__dev_"],
    ["../x", ".._x"],
    ["", "unknown"],
    [undefined, "unknown"],
  ])("puts firmware %j in directory %j", (version, dir) => {
    expect(firmwareDir(version)).toBe(dir);
  });
});

describe("formatSummary", () => {
  const CANARY = "pw-LEAK-CANARY";

  async function fixtureAfterLogin() {
    const inner = new FakeTransport();
    const recorder = new RecordingTransport(inner);
    await new MeshCoreConnection(recorder).sendCommandSendLogin(
      Uint8Array.from(publicKey(0xa0)),
      CANARY,
    );
    inner.push(deviceInfoFrame());
    inner.push(contactFrame({ type: 1, name: "Alice" }));
    inner.push(contactFrame({ type: 3, key: publicKey(0xa0), name: "Room K" }));
    return recorder.fixture({
      captureDate: "2026-10-11T12:00:00.000Z",
      tool: "@guardian/capture",
      libraries: {},
      scenario: "remote",
      targetKeyPrefix: "a0a1a2",
      requests: [
        { kind: "login", outcome: "responded", estTimeoutMs: 3000, latencyMs: 2100 },
        { kind: "status", outcome: "no_response", estTimeoutMs: 3000 },
        { kind: "telemetry", outcome: "error" },
      ],
      aborted: "transport_disconnected",
    });
  }

  it("prints firmware, frame counts, the longest frame, requests and the abort reason", async () => {
    const fixture = await fixtureAfterLogin();
    expect(formatSummary(fixture, "fixtures/v1.17.1/remote.json")).toBe(
      [
        "fixture: fixtures/v1.17.1/remote.json",
        "scenario: remote, target: a0a1a2",
        "firmware: Heltec V3 v1.17.1 (11 Oct 2026), protocol 10",
        "frames: 1 tx, 3 rx, 0 decode errors, longest rx 148 bytes",
        "contacts: 2",
        "redactions: chatContact.latLon, chatContact.name, deviceInfo.blePin, sendLogin.password",
        "login: responded, estTimeout 3000 ms, latency 2100 ms",
        "status: No response — cause unknown, estTimeout 3000 ms",
        "telemetry: error",
        "aborted: transport_disconnected",
      ].join("\n"),
    );
  });

  it("never prints the password, as text or hex (TR-09)", async () => {
    const text = formatSummary(await fixtureAfterLogin(), "remote.json");
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(toHex(Array.from(CANARY, (char) => char.charCodeAt(0))));
  });

  it("says when no device info arrived", () => {
    const recorder = new RecordingTransport(new FakeTransport());
    const fixture = recorder.fixture({
      captureDate: "2026-10-11T12:00:00.000Z",
      tool: "@guardian/capture",
      libraries: {},
      scenario: "handshake",
      targetKeyPrefix: null,
      requests: [],
    });
    expect(formatSummary(fixture, "handshake.json").split("\n")).toEqual([
      "fixture: handshake.json",
      "scenario: handshake, target: none",
      "firmware: unknown (no device info)",
      "frames: 0 tx, 0 rx, 0 decode errors, longest rx 0 bytes",
      "contacts: 0",
      "redactions: none",
    ]);
  });
});

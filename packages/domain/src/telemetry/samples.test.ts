import { describe, expect, it } from "vitest";

import type { CheckEvidence, CheckOutcome } from "../diagnostics/check";
import { samplesFromChecks } from "./samples";

type Status = Extract<CheckEvidence, { kind: "status" }>;
type Telemetry = Extract<CheckEvidence, { kind: "telemetry" }>;

const status = (over: Partial<Status> = {}): Status => ({
  kind: "status",
  battMilliVolts: 3353,
  currTxQueueLen: 0,
  noiseFloor: -110,
  lastRssi: -34,
  nPacketsRecv: 5,
  nPacketsSent: 4,
  totalAirTimeSecs: 1,
  totalUpTimeSecs: 2837,
  nSentFlood: 0,
  nSentDirect: 0,
  nRecvFlood: 0,
  nRecvDirect: 0,
  errEvents: 0,
  lastSnrX4: 53,
  nDirectDups: 0,
  nFloodDups: 0,
  ...over,
});

const telemetry = (values: Telemetry["values"]): Telemetry => ({
  kind: "telemetry",
  values,
  lppHex: "",
});

const check = (
  kind: CheckOutcome["kind"],
  evidence: CheckEvidence | null,
  over: Partial<CheckOutcome> = {},
): CheckOutcome => ({
  kind,
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 5000,
  timeoutSource: "default",
  startedAt: 1000,
  durationMs: 250,
  evidence,
  ...over,
});

const FALLBACK = 99_000;

describe("samplesFromChecks: status", () => {
  it("maps the Room K status reply", () => {
    const [sample] = samplesFromChecks([check("status", status())], FALLBACK);
    expect(sample).toEqual({
      runId: null,
      checkSeq: 0,
      source: "status",
      measuredAt: 1250,
      voltageV: 3.353,
      uptimeS: 2837,
      rssiDbm: { value: -34, scope: "last_hop" },
      snrDb: { value: 13.25, scope: "last_hop" },
      extra: [{ name: "noise_floor", value: -110, unit: "dBm", channel: null }],
    });
  });

  it("reads 0 mV as not measured, never 0 V", () => {
    const [sample] = samplesFromChecks([check("status", status({ battMilliVolts: 0 }))], FALLBACK);
    expect(sample?.voltageV).toBeNull();
  });

  it("keeps a 1 mV reading", () => {
    const [sample] = samplesFromChecks([check("status", status({ battMilliVolts: 1 }))], FALLBACK);
    expect(sample?.voltageV).toBe(0.001);
  });

  it("keeps a zero uptime and drops a negative or non-finite one", () => {
    const up = (n: number) =>
      samplesFromChecks([check("status", status({ totalUpTimeSecs: n }))], FALLBACK)[0]?.uptimeS;
    expect(up(0)).toBe(0);
    expect(up(-1)).toBeNull();
    expect(up(Number.NaN)).toBeNull();
    expect(up(10.9)).toBe(10);
  });

  it("drops non-finite signal values and noise floor", () => {
    const [sample] = samplesFromChecks(
      [
        check(
          "status",
          status({
            lastRssi: Number.NaN,
            lastSnrX4: Number.POSITIVE_INFINITY,
            noiseFloor: Number.NaN,
          }),
        ),
      ],
      FALLBACK,
    );
    expect(sample?.rssiDbm).toBeNull();
    expect(sample?.snrDb).toBeNull();
    expect(sample?.extra).toEqual([]);
  });

  it("keeps a zero RSSI", () => {
    const [sample] = samplesFromChecks([check("status", status({ lastRssi: 0 }))], FALLBACK);
    expect(sample?.rssiDbm).toEqual({ value: 0, scope: "last_hop" });
  });
});

describe("samplesFromChecks: telemetry", () => {
  it("maps the Room K telemetry reply: channel 1 voltage and temperature", () => {
    const [sample] = samplesFromChecks(
      [
        check(
          "telemetry",
          telemetry([
            { channel: 1, type: 116, value: 3.35 },
            { channel: 1, type: 103, value: 30 },
          ]),
        ),
      ],
      FALLBACK,
    );
    expect(sample).toEqual({
      runId: null,
      checkSeq: 0,
      source: "telemetry",
      measuredAt: 1250,
      voltageV: 3.35,
      uptimeS: null,
      rssiDbm: null,
      snrDb: null,
      extra: [{ name: "temperature", value: 30, unit: "°C", channel: 1 }],
    });
  });

  it("keeps a voltage on another channel, or a second one, as an extra", () => {
    const [sample] = samplesFromChecks(
      [
        check(
          "telemetry",
          telemetry([
            { channel: 2, type: 116, value: 5 },
            { channel: 1, type: 116, value: 3.3 },
            { channel: 1, type: 116, value: 4 },
          ]),
        ),
      ],
      FALLBACK,
    );
    expect(sample?.voltageV).toBe(3.3);
    expect(sample?.extra).toEqual([
      { name: "voltage", value: 5, unit: "V", channel: 2 },
      { name: "voltage", value: 4, unit: "V", channel: 1 },
    ]);
  });

  it("splits GPS into latitude, longitude and altitude", () => {
    const [sample] = samplesFromChecks(
      [
        check(
          "telemetry",
          telemetry([
            { channel: 3, type: 136, value: { latitude: 52.1, longitude: 21, altitude: 90 } },
          ]),
        ),
      ],
      FALLBACK,
    );
    expect(sample?.extra).toEqual([
      { name: "latitude", value: 52.1, unit: "°", channel: 3 },
      { name: "longitude", value: 21, unit: "°", channel: 3 },
      { name: "altitude", value: 90, unit: "m", channel: 3 },
    ]);
  });

  it("gives an unknown LPP type no unit", () => {
    const [sample] = samplesFromChecks(
      [check("telemetry", telemetry([{ channel: 4, type: 200, value: 7 }]))],
      FALLBACK,
    );
    expect(sample?.extra).toEqual([{ name: "lpp_200", value: 7, unit: null, channel: 4 }]);
  });

  it("skips a non-finite value", () => {
    const [sample] = samplesFromChecks(
      [
        check(
          "telemetry",
          telemetry([
            { channel: 1, type: 116, value: Number.NaN },
            { channel: 1, type: 103, value: Number.NaN },
          ]),
        ),
      ],
      FALLBACK,
    );
    expect(sample?.voltageV).toBeNull();
    expect(sample?.extra).toEqual([]);
  });

  it("stores an empty telemetry reply as a sample with no values", () => {
    const samples = samplesFromChecks([check("telemetry", telemetry([]))], FALLBACK);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ voltageV: null, extra: [] });
  });
});

describe("samplesFromChecks: selection and timing", () => {
  it("uses the index in the run as checkSeq and skips login and unanswered checks", () => {
    const samples = samplesFromChecks(
      [
        check("login", {
          kind: "login",
          permissions: 0,
          aclPermissions: null,
          firmwareLevel: null,
        }),
        check("status", status()),
        check("telemetry", null, { result: "NO_RESPONSE", reason: "NO_REPLY" }),
      ],
      FALLBACK,
    );
    expect(samples.map((s) => [s.checkSeq, s.source])).toEqual([[1, "status"]]);
  });

  it("numbers a telemetry check after a login and a status at 2", () => {
    const samples = samplesFromChecks(
      [check("login", null), check("status", status()), check("telemetry", telemetry([]))],
      FALLBACK,
    );
    expect(samples.map((s) => s.checkSeq)).toEqual([1, 2]);
  });

  it("makes no sample from a responded check without evidence or with another kind of evidence", () => {
    expect(samplesFromChecks([check("status", null)], FALLBACK)).toEqual([]);
    expect(
      samplesFromChecks(
        [check("status", { kind: "malformed", code: 1, length: 2, hex: "00" })],
        FALLBACK,
      ),
    ).toEqual([]);
    expect(samplesFromChecks([check("status", telemetry([]))], FALLBACK)).toEqual([]);
    expect(samplesFromChecks([check("telemetry", status())], FALLBACK)).toEqual([]);
  });

  it("falls back to the run time when a check has no timing", () => {
    const at = (over: Partial<CheckOutcome>) =>
      samplesFromChecks([check("status", status(), over)], FALLBACK)[0]?.measuredAt;
    expect(at({ startedAt: null })).toBe(FALLBACK);
    expect(at({ durationMs: null })).toBe(FALLBACK);
    expect(at({ startedAt: 0, durationMs: 0 })).toBe(0);
  });

  it("returns nothing for no checks", () => {
    expect(samplesFromChecks([], FALLBACK)).toEqual([]);
  });
});

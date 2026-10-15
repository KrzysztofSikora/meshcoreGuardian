import { describe, expect, it } from "vitest";

import type { TelemetrySample } from "@guardian/domain";

import { tr } from "../../components/translate";
import { i18n } from "../../i18n";
import {
  lastResponseText,
  recentRunRow,
  telemetryCard,
  uptimeText,
  type TelemetryCardModel,
  type TelemetryGroup,
} from "./history-presenter";
import { statusText } from "../diagnostics/presenter";
import type { Text } from "./presenter";

const fmt = (ms: number) => `T${ms}`;
const render = (text: Text) => tr(i18n.t, text);

const status = (over: Partial<TelemetrySample> = {}): TelemetrySample => ({
  runId: 1,
  checkSeq: 1,
  source: "status",
  measuredAt: 1000,
  voltageV: 3.353,
  uptimeS: 2837,
  rssiDbm: { value: -34, scope: "last_hop" },
  snrDb: { value: 13.25, scope: "last_hop" },
  extra: [{ name: "noise_floor", value: -110, unit: "dBm", channel: null }],
  ...over,
});
const telemetry = (over: Partial<TelemetrySample> = {}): TelemetrySample => ({
  runId: 1,
  checkSeq: 2,
  source: "telemetry",
  measuredAt: 2000,
  voltageV: 3.35,
  uptimeS: null,
  rssiDbm: null,
  snrDb: null,
  extra: [{ name: "temperature", value: 30, unit: "°C", channel: 1 }],
  ...over,
});

function groups(model: TelemetryCardModel): TelemetryGroup[] {
  if ("empty" in model) throw new Error("empty");
  return model.groups;
}
const rows = (g: TelemetryGroup) => g.rows.map((r) => [render(r.label), render(r.value)]);

describe("telemetryCard", () => {
  it("shows values with units, the measured time and the run time (FR-07 AC1)", () => {
    const model = telemetryCard([status(), telemetry()], fmt, 5000);
    if ("empty" in model) throw new Error("empty");
    expect(render(model.fromRun)).toBe("From the run of T5000");
    const [s, t] = model.groups;
    expect(render(s!.measured!)).toBe("Measured T1000");
    expect(rows(s!)).toEqual([
      ["Battery voltage", "3.35 V"],
      ["Uptime", "0 d 0 h 47 min"],
      ["RSSI, last hop into the node", "-34 dBm"],
      ["SNR, last hop into the node", "13.25 dB"],
      ["Noise floor", "-110 dBm"],
    ]);
    expect(render(t!.measured!)).toBe("Measured T2000");
    expect(rows(t!)).toEqual([
      ["Battery voltage", "3.35 V"],
      ["Temperature · channel 1", "30 °C"],
    ]);
  });

  it("falls back to the earliest measured time when the run time is unknown", () => {
    const model = telemetryCard([telemetry(), status()], fmt);
    if ("empty" in model) throw new Error("empty");
    expect(render(model.fromRun)).toBe("From the run of T1000");
  });

  it.each([
    ["voltageV", "Battery voltage"],
    ["uptimeS", "Uptime"],
    ["rssiDbm", "RSSI"],
    ["snrDb", "SNR"],
  ] as const)("a missing %s is N/A, never 0 (FR-07 AC2)", (field, label) => {
    const [s] = groups(telemetryCard([status({ [field]: null })], fmt));
    const row = rows(s!).find(([l]) => l === label)!;
    expect(row[1]).toBe("N/A");
    expect(JSON.stringify(rows(s!).filter(([l]) => l === label))).not.toContain('"0');
  });

  it("an all-empty status sample is N/A on every row", () => {
    const [s] = groups(
      telemetryCard(
        [status({ voltageV: null, uptimeS: null, rssiDbm: null, snrDb: null, extra: [] })],
        fmt,
      ),
    );
    expect(rows(s!).map(([, v]) => v)).toEqual(["N/A", "N/A", "N/A", "N/A"]);
  });

  it("names the last hop and says it is not end-to-end quality (FR-07 AC3)", () => {
    const model = telemetryCard([status()], fmt);
    if ("empty" in model) throw new Error("empty");
    expect(render(model.note!)).toBe(
      "Measured by the node on the last packet it received. Not end-to-end link quality.",
    );
  });

  it("has no last-hop note when no RSSI or SNR is shown", () => {
    const model = telemetryCard([status({ rssiDbm: null, snrDb: null }), telemetry()], fmt);
    if ("empty" in model) throw new Error("empty");
    expect(model.note).toBeNull();
  });

  it("words an unknown scope as packet unknown", () => {
    const [s] = groups(telemetryCard([status({ rssiDbm: { value: -90, scope: "unknown" } })], fmt));
    expect(rows(s!)[2]).toEqual(["RSSI, packet unknown", "-90 dBm"]);
  });

  it("shows a value of an unknown unit as such", () => {
    const [, t] = groups(
      telemetryCard(
        [
          status(),
          telemetry({
            voltageV: null,
            extra: [{ name: "lpp_200", value: 7, unit: null, channel: 3 }],
          }),
        ],
        fmt,
      ),
    );
    expect(rows(t!)).toEqual([["Sensor type 200 · channel 3", "7 (unit unknown)"]]);
  });

  it("a telemetry reply without values says so instead of showing 0", () => {
    const [, t] = groups(telemetryCard([telemetry({ voltageV: null, extra: [] })], fmt));
    expect(rows(t!)).toEqual([["Values", "No values in the reply"]]);
  });

  it("rounds long decimals to two places", () => {
    const [, t] = groups(
      telemetryCard(
        [telemetry({ extra: [{ name: "humidity", value: 45.678, unit: "%", channel: 2 }] })],
        fmt,
      ),
    );
    expect(rows(t!)[1]).toEqual(["Humidity · channel 2", "45.68 %"]);
  });

  it("states a source the run got no reply for instead of dropping its group (R3)", () => {
    const noStatus = groups(telemetryCard([telemetry()], fmt));
    expect(noStatus.map((g) => render(g.title))).toEqual(["Status reply", "Telemetry reply"]);
    expect(noStatus[0]!.measured).toBeNull();
    expect(rows(noStatus[0]!)).toEqual([["Reply", "No reply in this run"]]);
    const noTelemetry = groups(telemetryCard([status()], fmt));
    expect(noTelemetry.map((g) => render(g.title))).toEqual(["Status reply", "Telemetry reply"]);
    expect(noTelemetry[1]!.measured).toBeNull();
    expect(rows(noTelemetry[1]!)).toEqual([["Reply", "No reply in this run"]]);
  });

  it.each([
    ["RSSI only", { snrDb: null }, true],
    ["SNR only", { rssiDbm: null }, true],
    ["neither", { rssiDbm: null, snrDb: null }, false],
  ] as const)("last-hop note with %s: %s", (_name, over, shown) => {
    const model = telemetryCard([status(over)], fmt);
    if ("empty" in model) throw new Error("empty");
    expect(model.note !== null).toBe(shown);
  });

  it("names only lpp_<type> as an unknown sensor and omits the channel when there is none", () => {
    const extra = (name: string, channel: number | null) =>
      rows(
        groups(
          telemetryCard(
            [telemetry({ voltageV: null, extra: [{ name, value: 1, unit: "x", channel }] })],
            fmt,
          ),
        )[1]!,
      )[0]![0];
    expect(extra("lpp_7", null)).toBe("Sensor type 7");
    expect(extra("xlpp_7", null)).not.toContain("Sensor type");
    expect(extra("lpp_7x", null)).not.toContain("Sensor type");
  });

  it("has an empty state without samples", () => {
    const model = telemetryCard([], fmt);
    expect("empty" in model && render(model.empty)).toContain("No telemetry recorded");
  });
});

describe("uptimeText", () => {
  it.each([
    [0, "0 d 0 h 0 min"],
    [2837, "0 d 0 h 47 min"],
    [90_061, "1 d 1 h 1 min"],
    [-5, "0 d 0 h 0 min"],
  ])("%i s", (seconds, expected) => {
    expect(render(uptimeText(seconds))).toBe(expected);
  });
});

describe("lastResponseText", () => {
  it("says when, or that none is recorded", () => {
    expect(render(lastResponseText(7, fmt))).toBe("Last response: T7");
    expect(render(lastResponseText(null, fmt))).toBe("No response recorded");
  });
});

describe("recentRunRow", () => {
  const run = {
    result: "NO_RESPONSE",
    reason: "NO_REPLY",
    finishedAt: 9,
    durationMs: 65_400,
  } as const;
  it("carries the result as a status word source, the time and the duration", () => {
    const row = recentRunRow(run, fmt, 9);
    expect(row.status.kind).toBe("no_reply");
    expect(render(row.time)).toBe("T9");
    expect(render(row.duration)).toBe("1 min 5 s");
  });
  it("words the age of a stored responded run from the real now, not 'just now' (R1)", () => {
    const responded = { ...run, result: "RESPONDED", reason: "ALL_CHECKS_REPLIED" } as const;
    const days3 = 3 * 86_400_000;
    const old = recentRunRow(responded, fmt, responded.finishedAt + days3);
    expect(statusText(old.status)).toEqual({
      key: "diagnostic.status.responded.day",
      params: { count: 3 },
    });
    expect(render(statusText(old.status))).toBe("Responded 3 days ago");
    expect(render(statusText(recentRunRow(responded, fmt, responded.finishedAt).status))).toBe(
      "Responded just now",
    );
  });
  it("shows short durations in seconds", () => {
    expect(render(recentRunRow({ ...run, durationMs: 4200 }, fmt, 9).duration)).toBe("4 s");
    expect(render(recentRunRow({ ...run, durationMs: 59_000 }, fmt, 9).duration)).toBe("59 s");
    expect(render(recentRunRow({ ...run, durationMs: 60_000 }, fmt, 9).duration)).toBe("1 min 0 s");
  });
});

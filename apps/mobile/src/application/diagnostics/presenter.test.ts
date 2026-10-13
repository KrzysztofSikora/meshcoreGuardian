import { describe, expect, it } from "vitest";

import {
  deriveCapabilities,
  ruleFor,
  type CheckOutcome,
  type DiagnosticRun,
  type StatusKind,
} from "@guardian/domain";

import { tr } from "../../components/translate";
import { i18n } from "../../i18n";
import type { Text } from "../nodes/presenter";
import {
  adminSessionLimitation,
  connectionLook,
  progressText,
  runButton,
  runDetails,
  statusLook,
  statusText,
} from "./presenter";

const sayText = (text: Text) => tr(i18n.t, text);

const caps = (verCode: number) =>
  deriveCapabilities({ firmwareVerCode: verCode, firmwareVersion: `v${verCode}` });
const base = {
  connected: true,
  capabilities: caps(13),
  running: false,
  inContacts: true,
  cooldownMs: 0,
};

const say = sayText;

describe("runButton", () => {
  it("is enabled when nothing blocks it", () => {
    expect(runButton(base)).toEqual({ enabled: true, reason: null });
  });

  it.each([
    [{ connected: false }, "diagnostic.needConnection"],
    [{ capabilities: null }, "diagnostic.needConnection"],
    [{ running: true }, "diagnostic.refusal.busy"],
    [{ inContacts: false }, "diagnostic.notInContacts"],
    [{ capabilities: caps(0) }, "capability.unsupported"],
    [{ cooldownMs: 1 }, "diagnostic.cooldown"],
  ])("is disabled by %j with %s", (override, key) => {
    const model = runButton({ ...base, ...override });
    expect(model.enabled).toBe(false);
    expect(model.reason?.key).toBe(key);
  });

  it("gives the reasons in priority order", () => {
    const all = { ...base, connected: false, running: true, inContacts: false, cooldownMs: 5 };
    expect(runButton(all).reason?.key).toBe("diagnostic.needConnection");
    expect(runButton({ ...all, connected: true }).reason?.key).toBe("diagnostic.refusal.busy");
    expect(runButton({ ...all, connected: true, running: false }).reason?.key).toBe(
      "diagnostic.notInContacts",
    );
    expect(
      runButton({ ...all, connected: true, running: false, inContacts: true }).reason?.key,
    ).toBe("diagnostic.cooldown");
  });

  it("rounds the countdown up to whole seconds (FR-10 AC2)", () => {
    expect(runButton({ ...base, cooldownMs: 59_001 }).reason?.params).toEqual({ seconds: 60 });
    expect(runButton({ ...base, cooldownMs: 1_000 }).reason?.params).toEqual({ seconds: 1 });
    expect(say(runButton({ ...base, cooldownMs: 12_000 }).reason!)).toBe("Available again in 12 s");
  });
});

describe("progressText", () => {
  const active = { publicKey: "k", step: "status", attempt: 1, of: 2, startedAt: 0 } as const;

  it("names the step and the attempt (FR-05 AC1)", () => {
    const text = progressText(active);
    expect(say(text)).toBe("Step: Status · Attempt 1 of 2");
  });

  it("names only the step before the first write", () => {
    const text = progressText({ ...active, attempt: 0 });
    expect(say(text)).toBe("Step: Status");
  });
});

describe("statusText", () => {
  const say = (kind: StatusKind, ageMs: number | null) => sayText(statusText({ kind, ageMs }));

  it.each([
    ["not_tested", null, "Not tested"],
    ["no_reply", 5_000, "No reply in last test"],
    ["transport_error", 5_000, "Transport error in last test"],
    ["unsupported", 5_000, "Unsupported in last test"],
    ["cancelled", 5_000, "Last test cancelled"],
    ["incomplete", 5_000, "Last test incomplete"],
    ["responded", 0, "Responded just now"],
    ["responded", 59_999, "Responded just now"],
    ["responded", 60_000, "Responded 1 minute ago"],
    ["responded", 3_540_000, "Responded 59 minutes ago"],
    ["responded", 3_600_000, "Responded 1 hour ago"],
    ["responded", 23 * 3_600_000, "Responded 23 hours ago"],
    ["responded", 24 * 3_600_000, "Responded 1 day ago"],
    ["responded", 3 * 24 * 3_600_000, "Responded 3 days ago"],
  ] as const)("%s at %s ms reads %s", (kind, ageMs, expected) => {
    expect(say(kind, ageMs)).toBe(expected);
  });

  it("gives every status an icon and a tone next to its words (D-9)", () => {
    const kinds: StatusKind[] = [
      "not_tested",
      "responded",
      "no_reply",
      "transport_error",
      "unsupported",
      "cancelled",
      "incomplete",
    ];
    for (const kind of kinds) {
      expect(statusLook({ kind, ageMs: null }).icon).toBeTruthy();
      expect(say(kind, 1_000).length).toBeGreaterThan(3);
    }
  });
});

const check = (over: Partial<CheckOutcome>): CheckOutcome => ({
  kind: "status",
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 5388,
  timeoutSource: "estimate",
  startedAt: 1,
  durationMs: 1300,
  evidence: null,
  ...over,
});

const run = (over: Partial<DiagnosticRun>): DiagnosticRun => ({
  nodePublicKey: "7c".repeat(32),
  companion: { publicKey: "aa".repeat(32), name: "Companion", firmwareVersion: "v1.17.1" },
  startedAt: 0,
  finishedAt: 4_200,
  durationMs: 4_200,
  attemptsUsed: 1,
  attemptsPerCheck: 2,
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  limitations: [],
  checks: [],
  ...over,
});

describe("runDetails", () => {
  it("lists the checks with outcome, attempts, timeout and decoded evidence (FR-09 AC2)", () => {
    const details = runDetails(
      run({
        checks: [
          check({
            evidence: {
              kind: "status",
              battMilliVolts: 3350,
              currTxQueueLen: 0,
              noiseFloor: -117,
              lastRssi: -33,
              nPacketsRecv: 10,
              nPacketsSent: 5,
              totalAirTimeSecs: 1,
              totalUpTimeSecs: 3_600,
              nSentFlood: 0,
              nSentDirect: 0,
              nRecvFlood: 0,
              nRecvDirect: 0,
              errEvents: 0,
              lastSnrX4: 26,
              nDirectDups: 0,
              nFloodDups: 0,
            },
          }),
          check({
            kind: "telemetry",
            result: "UNSUPPORTED",
            reason: "CAPABILITY_MISSING",
            attempts: 0,
            timeoutMs: null,
            timeoutSource: null,
          }),
        ],
      }),
    );
    expect(details.checks.map((c) => say(c.name))).toEqual(["Status", "Telemetry"]);
    expect(details.checks.map((c) => say(c.outcome))).toEqual([
      "Replied",
      "Not supported by the companion firmware",
    ]);
    const status = details.checks[0]!;
    expect(say(status.attempts)).toBe("1 attempt");
    expect(say(status.timeout!)).toBe("Waited 5.4 s (companion estimate)");
    const lines = status.evidence.map(say);
    expect(lines).toContain("Battery: 3.35 V");
    expect(lines).toContain("Signal of last hop (RSSI): -33 dBm");
    expect(lines).toContain("Signal-to-noise of last hop: 6.50 dB");
    expect(details.checks[1]!.timeout).toBeNull();
    expect(details.checks[1]!.evidence).toEqual([]);
    expect(details.facts.map(say)).toEqual([
      "Duration: 4.2 s",
      "Companion: Companion (v1.17.1)",
      "Requests sent: 1 (up to 2 per check)",
    ]);
  });

  it("gives the result banner the look of the run's status (NFR-09)", () => {
    const noReply = runDetails(run({ result: "NO_RESPONSE", reason: "NO_REPLY" }));
    expect(noReply.look).toEqual({ icon: "question", tone: "warn" });
    const responded = runDetails(run({ result: "RESPONDED", reason: "ALL_CHECKS_REPLIED" }));
    expect(responded.look).toEqual({ icon: "check", tone: "ok" });
  });

  it("says no response with unknown cause and lists unconfirmed causes and next steps (FR-09 AC3)", () => {
    const details = runDetails(
      run({
        result: "NO_RESPONSE",
        reason: "NO_REPLY",
        checks: [check({ kind: "login", result: "NO_RESPONSE", reason: "NO_REPLY", attempts: 2 })],
      }),
    );
    expect(say(details.summary)).toBe("No response — cause unknown");
    expect(say(details.causesNote!)).toContain("None of them is confirmed");
    expect(details.causes).toHaveLength(3);
    expect(details.nextSteps.length).toBeGreaterThan(0);
    expect(details.limitations.length).toBeGreaterThan(0);
    for (const text of [...details.causes, ...details.nextSteps, ...details.limitations]) {
      expect(i18n.exists(text.key)).toBe(true);
    }
  });

  it("lists each check that did not reply under limitations, before the rule's own (R5)", () => {
    const details = runDetails(
      run({
        limitations: [{ check: "telemetry", result: "UNSUPPORTED", reason: "CAPABILITY_MISSING" }],
      }),
    );
    expect(say(details.limitations[0]!)).toBe("Telemetry: Not supported by the companion firmware");
    expect(details.limitations).toHaveLength(
      1 + (ruleFor("RESPONDED", "ALL_CHECKS_REPLIED")?.limitations.length ?? 0),
    );
  });

  it("shows a malformed reply as raw bytes and a rejection with its code", () => {
    const details = runDetails(
      run({
        result: "UNSUPPORTED",
        reason: "MALFORMED_RESPONSE",
        checks: [
          check({
            result: "UNSUPPORTED",
            reason: "MALFORMED_RESPONSE",
            evidence: { kind: "malformed", code: 0x87, length: 2, hex: "8700" },
          }),
          check({
            kind: "login",
            result: "UNSUPPORTED",
            reason: "COMMAND_REJECTED",
            evidence: { kind: "rejected", code: 2 },
          }),
          check({
            kind: "login",
            result: "UNSUPPORTED",
            reason: "COMMAND_REJECTED",
            evidence: { kind: "rejected", code: null },
          }),
        ],
      }),
    );
    const [raw, code, none] = details.checks.map((c) => c.evidence.map(say));
    expect(raw).toEqual(["Raw reply (code 87, 2 bytes): 8700"]);
    expect(code).toEqual(["Refused with code 2"]);
    expect(none).toEqual(["Refused without a code"]);
  });

  it("renders telemetry values, including a position", () => {
    const details = runDetails(
      run({
        checks: [
          check({
            kind: "telemetry",
            evidence: {
              kind: "telemetry",
              lppHex: "",
              values: [
                { channel: 1, type: 116, value: 3.35 },
                { channel: 2, type: 136, value: { latitude: 1, longitude: 2, altitude: 3 } },
              ],
            },
          }),
          check({ kind: "telemetry", evidence: { kind: "telemetry", lppHex: "", values: [] } }),
        ],
      }),
    );
    expect(details.checks[0]!.evidence.map(say)).toEqual([
      "Channel 1, type 116: 3.35",
      "Channel 2, type 136: 1, 2, 3",
    ]);
    expect(details.checks[1]!.evidence.map(say)).toEqual(["No telemetry values"]);
  });

  const login = (
    permissions: number,
    aclPermissions: number | null,
    extra: { passwordSent?: boolean; firmwareLevel?: number | null } = {},
  ) =>
    check({
      kind: "login",
      evidence: { kind: "login", permissions, aclPermissions, firmwareLevel: null, ...extra },
    });

  it("renders the session role from the ACL byte, not the raw value", () => {
    const details = runDetails(
      run({
        checks: [
          check({
            kind: "login",
            evidence: { kind: "login", permissions: 1, aclPermissions: 3, firmwareLevel: 2 },
          }),
          login(0, 0),
          login(0, 1),
          login(0, 2),
          login(0, null),
        ],
      }),
    );
    expect(details.checks.map((c) => c.evidence.map(say))).toEqual([
      ["Session role: administrator", "Node firmware level: 2"],
      ["Session role: guest"],
      ["Session role: read-only"],
      ["Session role: read-write"],
      ["Session role: unknown"],
    ]);
  });

  it("adds a limitation for an admin session, worded by where the rights came from", () => {
    const limitation = (passwordSent?: boolean) =>
      adminSessionLimitation({
        checks: [login(1, 3, passwordSent === undefined ? {} : { passwordSent })],
      });
    expect(say(limitation(true)!)).toMatch(/password you saved gives administrator rights/);
    expect(say(limitation(false)!)).toMatch(/from its own access list/);
    expect(say(limitation()!)).toMatch(/administrator session/);
    expect(adminSessionLimitation({ checks: [login(0, 0)] })).toBeNull();
    const details = runDetails(run({ checks: [login(1, 3, { passwordSent: false })] }));
    expect(details.limitations.map(say).join(" ")).toMatch(/access list/);
  });

  it("falls back to a neutral text for a result the app does not know", () => {
    const details = runDetails(run({ result: "RESPONDED", reason: "NO_REPLY" }));
    expect(say(details.summary)).toBe("Result not recognised");
    expect(details.nextSteps.map(say)).toEqual(["Run the diagnostic again."]);
    expect(details.causesNote).toBeNull();
  });
});

describe("status and connection looks (plan D-9)", () => {
  it("maps each run status to its icon and tone", () => {
    const look = (kind: StatusKind) => statusLook({ kind, ageMs: null });
    expect(look("responded")).toEqual({ icon: "check", tone: "ok" });
    expect(look("no_reply")).toEqual({ icon: "question", tone: "warn" });
    expect(look("transport_error")).toEqual({ icon: "alert", tone: "warn" });
    expect(look("unsupported")).toEqual({ icon: "slash", tone: "unsupported" });
    for (const kind of ["not_tested", "cancelled", "incomplete"] as const) {
      expect(look(kind)).toEqual({ icon: "dash", tone: "neutral" });
    }
  });

  it("maps each connection state to its icon and tone", () => {
    expect(connectionLook("connected")).toEqual({ icon: "check", tone: "ok" });
    expect(connectionLook("connecting")).toEqual({ icon: "clock", tone: "info" });
    expect(connectionLook("failed")).toEqual({ icon: "alert", tone: "warn" });
    expect(connectionLook("disconnected")).toEqual({ icon: "circle", tone: "neutral" });
  });
});

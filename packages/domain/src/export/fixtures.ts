import type { CheckOutcome } from "../diagnostics/check";
import type { DiagnosticRun } from "../diagnostics/run";
import type { Node } from "../nodes/node";
import type { TelemetrySample } from "../telemetry/samples";
import type { ExportInput } from "./report";

/** Test support: a fixed node, three runs and their samples (golden files are built from these). */
export const NODE_KEY = `ab12cd34${"e5f60718".repeat(7)}`;
export const COMPANION_KEY = `c0ffee11${"22334455".repeat(7)}`;

const T0 = Date.UTC(2026, 8, 1, 10, 0, 0);
const MIN = 60_000;

export const node: Node = {
  publicKey: NODE_KEY,
  reportedName: '=Hill, "North"',
  reportedRole: "repeater",
  reportedType: 2,
  userLabel: "+Roof relay",
  userRole: null,
  lastHeardAt: T0 - MIN,
  pathHops: 2,
  position: { lat: 52.1, lon: 21.2 },
  pathCompanionKey: COMPANION_KEY,
  inContacts: true,
  dashboardPinned: false,
  createdAt: T0 - 1000 * MIN,
  syncedAt: T0 - MIN,
};

const check = (over: Partial<CheckOutcome> & Pick<CheckOutcome, "kind">): CheckOutcome => ({
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 5000,
  timeoutSource: "default",
  startedAt: T0,
  durationMs: 400,
  evidence: null,
  ...over,
});

const companion = { publicKey: COMPANION_KEY, name: "Desk companion", firmwareVersion: "1.9.0" };

export const runResponded: DiagnosticRun = {
  id: 1,
  nodePublicKey: NODE_KEY,
  companion,
  startedAt: T0,
  finishedAt: T0 + 20_000,
  durationMs: 20_000,
  attemptsUsed: 3,
  attemptsPerCheck: 2,
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  limitations: [],
  checks: [
    check({
      kind: "login",
      evidence: {
        kind: "login",
        permissions: 1,
        aclPermissions: 1,
        firmwareLevel: 8,
        passwordSent: true,
      },
    }),
    check({
      kind: "status",
      startedAt: T0 + 5000,
      evidence: {
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
      },
    }),
    check({
      kind: "telemetry",
      startedAt: T0 + 10_000,
      evidence: {
        kind: "telemetry",
        values: [{ channel: 1, type: 103, value: 30 }],
        lppHex: "0167011e",
      },
    }),
  ],
};

export const runNoResponse: DiagnosticRun = {
  id: 2,
  nodePublicKey: NODE_KEY,
  companion,
  startedAt: T0 + 60 * MIN,
  finishedAt: T0 + 60 * MIN + 15_000,
  durationMs: 15_000,
  attemptsUsed: 2,
  attemptsPerCheck: 2,
  result: "NO_RESPONSE",
  reason: "NO_REPLY",
  limitations: [],
  checks: [
    check({
      kind: "login",
      result: "NO_RESPONSE",
      reason: "NO_REPLY",
      attempts: 2,
      startedAt: T0 + 60 * MIN,
      durationMs: null,
    }),
  ],
};

/** A run stored without a companion identity (the link dropped before it was captured). */
export const runNoCompanion: DiagnosticRun = {
  id: 3,
  nodePublicKey: NODE_KEY,
  companion: { publicKey: "", name: "", firmwareVersion: "" },
  startedAt: T0 + 120 * MIN,
  finishedAt: T0 + 120 * MIN + 8000,
  durationMs: 8000,
  attemptsUsed: 2,
  attemptsPerCheck: 2,
  result: "RESPONDED",
  reason: "PARTIAL_REPLY",
  limitations: [{ check: "telemetry", result: "NO_RESPONSE", reason: "NO_REPLY" }],
  checks: [
    check({
      kind: "status",
      startedAt: T0 + 120 * MIN,
      evidence: {
        kind: "status",
        battMilliVolts: 3301,
        currTxQueueLen: 0,
        noiseFloor: -108,
        lastRssi: -40,
        nPacketsRecv: 9,
        nPacketsSent: 8,
        totalAirTimeSecs: 2,
        totalUpTimeSecs: 9000,
        nSentFlood: 0,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
        errEvents: 0,
        lastSnrX4: 41,
        nDirectDups: 0,
        nFloodDups: 0,
      },
    }),
    check({
      kind: "telemetry",
      result: "NO_RESPONSE",
      reason: "NO_REPLY",
      attempts: 1,
      startedAt: T0 + 120 * MIN + 4000,
      timeoutSource: "estimate",
      durationMs: null,
    }),
  ],
};

const sample = (over: Partial<TelemetrySample>): TelemetrySample => ({
  runId: 1,
  checkSeq: 0,
  source: "status",
  measuredAt: T0 + 5400,
  voltageV: null,
  uptimeS: null,
  rssiDbm: null,
  snrDb: null,
  extra: [],
  ...over,
});

export const samples: TelemetrySample[] = [
  sample({
    runId: 1,
    checkSeq: 1,
    voltageV: 3.353,
    uptimeS: 2837,
    rssiDbm: { value: -34, scope: "last_hop" },
    snrDb: { value: 13.25, scope: "last_hop" },
    extra: [{ name: "noise_floor", value: -110, unit: "dBm", channel: null }],
  }),
  sample({
    runId: 1,
    checkSeq: 2,
    source: "telemetry",
    measuredAt: T0 + 10_400,
    extra: [{ name: "temperature", value: 30, unit: "°C", channel: 1 }],
  }),
  sample({
    runId: 3,
    checkSeq: 0,
    measuredAt: T0 + 120 * MIN + 400,
    voltageV: 3.301,
    uptimeS: 9000,
    rssiDbm: { value: -40, scope: "last_hop" },
    snrDb: { value: 10.25, scope: "last_hop" },
    extra: [{ name: "noise_floor", value: -108, unit: "dBm", channel: null }],
  }),
];

/** Out of order on purpose: the report must sort. */
export const input: ExportInput = {
  node,
  runs: [runNoCompanion, runResponded, runNoResponse],
  samples,
  range: { from: T0 - 24 * 60 * MIN, to: T0 + 200 * MIN },
  generatedAt: T0 + 210 * MIN,
  generatedBy: "MeshCore Guardian 0.0.0",
};

import {
  actionAvailability,
  ageBucket,
  loginEvidence,
  lastRunStatus,
  ruleFor,
  sessionRole,
  type Capabilities,
  type CheckEvidence,
  type CheckOutcome,
  type ConnectionState,
  type DiagnosticRun,
  type RunStatus,
} from "@guardian/domain";

import type { Text } from "../nodes/presenter";
import type { ActiveRun } from "./run-controller";

export interface RunButtonModel {
  enabled: boolean;
  /** Why the button is disabled, or what to wait for. */
  reason: Text | null;
}

/** Why "Run diagnostic" is off, in priority order (plan D-13). */
export function runButton(input: {
  connected: boolean;
  capabilities: Capabilities | null;
  running: boolean;
  inContacts: boolean;
  cooldownMs: number;
}): RunButtonModel {
  const off = (reason: Text): RunButtonModel => ({ enabled: false, reason });
  if (!input.connected || input.capabilities === null) {
    return off({ key: "diagnostic.needConnection" });
  }
  if (input.running) return off({ key: "diagnostic.refusal.busy" });
  if (!input.inContacts) return off({ key: "diagnostic.notInContacts" });
  const availability = actionAvailability(input.capabilities, "status");
  if (!availability.enabled) {
    return off({
      key: "capability.unsupported",
      params: { version: availability.firmwareVersion },
    });
  }
  if (input.cooldownMs > 0) {
    return off({
      key: "diagnostic.cooldown",
      params: { seconds: Math.ceil(input.cooldownMs / 1000) },
    });
  }
  return { enabled: true, reason: null };
}

/** "Status · Attempt 1 of 2"; before the first write it only names the step. */
export function progressText(active: ActiveRun): Text {
  return active.attempt === 0
    ? { key: `diagnostic.progress.start.${active.step}` }
    : {
        key: `diagnostic.progress.${active.step}`,
        params: { attempt: active.attempt, of: active.of },
      };
}

/** The FR-11 status line: relative text for a response, fixed words for the rest. */
export function statusText(status: RunStatus): Text {
  if (status.kind === "responded" && status.ageMs !== null) {
    const age = ageBucket(status.ageMs);
    return age.unit === "now"
      ? { key: "diagnostic.status.responded.now" }
      : { key: `diagnostic.status.responded.${age.unit}`, params: { count: age.count } };
  }
  return { key: `diagnostic.status.${status.kind}` };
}

export type IconName =
  | "check"
  | "question"
  | "alert"
  | "slash"
  | "dash"
  | "circle"
  | "clock"
  | "sync"
  | "play"
  | "bluetooth"
  | "grid"
  | "sliders"
  | "compass"
  | "info"
  | "search"
  | "download";

export type Tone = "ok" | "warn" | "unsupported" | "info" | "neutral";

export interface Look {
  icon: IconName;
  tone: Tone;
}

const STATUS_LOOK = {
  not_tested: { icon: "dash", tone: "neutral" },
  responded: { icon: "check", tone: "ok" },
  no_reply: { icon: "question", tone: "warn" },
  transport_error: { icon: "alert", tone: "warn" },
  unsupported: { icon: "slash", tone: "unsupported" },
  cancelled: { icon: "dash", tone: "neutral" },
  incomplete: { icon: "dash", tone: "neutral" },
} as const satisfies Record<RunStatus["kind"], Look>;

/** Icon and tone for the status chip; decoration only, the words carry the meaning (plan D-9, NFR-05). */
export function statusLook(status: RunStatus): Look {
  return STATUS_LOOK[status.kind];
}

const CONNECTION_LOOK = {
  disconnected: { icon: "circle", tone: "neutral" },
  connecting: { icon: "clock", tone: "info" },
  connected: { icon: "check", tone: "ok" },
  failed: { icon: "alert", tone: "warn" },
} as const satisfies Record<ConnectionState["kind"], Look>;

export function connectionLook(kind: ConnectionState["kind"]): Look {
  return CONNECTION_LOOK[kind];
}

export function statusOf(run: DiagnosticRun | null | undefined, now: number): RunStatus {
  return lastRunStatus(run ?? null, now);
}

export interface CheckDetails {
  name: Text;
  outcome: Text;
  attempts: Text;
  timeout: Text | null;
  evidence: Text[];
}

export interface RunDetails {
  summary: Text;
  explanation: Text;
  /** Icon and tone for the result banner; decoration, the summary words carry the meaning. */
  look: Look;
  checks: CheckDetails[];
  limitations: Text[];
  causesNote: Text | null;
  causes: Text[];
  nextSteps: Text[];
  /** Run header facts: how long it took and which companion ran it. */
  facts: Text[];
}

const text = (key: string, params?: Record<string, string | number>): Text =>
  params === undefined ? { key } : { key, params };

function evidenceLines(evidence: CheckEvidence | null): Text[] {
  if (evidence === null) return [];
  switch (evidence.kind) {
    case "login":
      return [
        text(`diagnostic.evidence.login.role.${sessionRole(evidence)}`),
        ...(evidence.firmwareLevel === null
          ? []
          : [text("diagnostic.evidence.login.firmwareLevel", { value: evidence.firmwareLevel })]),
      ];
    case "status":
      return [
        text("diagnostic.evidence.status.battery", {
          volts: (evidence.battMilliVolts / 1000).toFixed(2),
        }),
        text("diagnostic.evidence.status.uptime", { seconds: evidence.totalUpTimeSecs }),
        text("diagnostic.evidence.status.noiseFloor", { dbm: evidence.noiseFloor }),
        text("diagnostic.evidence.status.lastRssi", { dbm: evidence.lastRssi }),
        text("diagnostic.evidence.status.lastSnr", { db: (evidence.lastSnrX4 / 4).toFixed(2) }),
        text("diagnostic.evidence.status.packets", {
          received: evidence.nPacketsRecv,
          sent: evidence.nPacketsSent,
        }),
        text("diagnostic.evidence.status.queue", { count: evidence.currTxQueueLen }),
      ];
    case "telemetry":
      return evidence.values.length === 0
        ? [text("diagnostic.evidence.telemetry.none")]
        : evidence.values.map((v) =>
            text("diagnostic.evidence.telemetry.value", {
              channel: v.channel,
              type: v.type,
              value:
                typeof v.value === "number"
                  ? v.value
                  : `${v.value.latitude}, ${v.value.longitude}, ${v.value.altitude}`,
            }),
          );
    case "malformed":
      return [
        text("diagnostic.evidence.malformed", {
          code: evidence.code.toString(16).padStart(2, "0"),
          length: evidence.length,
          hex: evidence.hex,
        }),
      ];
    case "rejected":
      return [
        evidence.code === null
          ? text("diagnostic.evidence.rejected.unknown")
          : text("diagnostic.evidence.rejected.code", { code: evidence.code }),
      ];
  }
}

/**
 * The admin-session limitation (PR #22): the node replied, but the session was an admin one.
 * Guardian takes only a guest password and sent only read requests either way.
 */
export function adminSessionLimitation(run: Pick<DiagnosticRun, "checks">): Text | null {
  const login = loginEvidence(run.checks);
  if (login === null || sessionRole(login) !== "admin") return null;
  const source =
    login.passwordSent === true ? "password" : login.passwordSent === false ? "acl" : "unknown";
  return text(`diagnostic.limitation.adminSession.${source}`);
}

function checkDetails(check: CheckOutcome): CheckDetails {
  return {
    name: text(`diagnostic.check.${check.kind}`),
    outcome: text(`diagnostic.outcome.${check.reason}`),
    attempts: text("diagnostic.attempts", { count: check.attempts }),
    timeout:
      check.timeoutMs === null || check.timeoutSource === null
        ? null
        : text(`diagnostic.timeout.${check.timeoutSource}`, {
            seconds: (check.timeoutMs / 1000).toFixed(1),
          }),
    evidence: evidenceLines(check.evidence),
  };
}

/** The run screen (FR-09): checks, evidence, limitations, possible causes and next steps. */
export function runDetails(run: DiagnosticRun): RunDetails {
  const rule = ruleFor(run.result, run.reason);
  const key = (value: string): Text => ({ key: value });
  const adminLimitation = adminSessionLimitation(run);
  return {
    summary: key(rule?.summary ?? "diagnostic.rule.unknown.summary"),
    explanation: key(rule?.explanation ?? "diagnostic.rule.unknown.explanation"),
    look: statusLook(lastRunStatus(run, run.finishedAt)),
    checks: run.checks.map(checkDetails),
    limitations: [
      ...run.limitations.map((item) =>
        text(`diagnostic.limitation.${item.check}`, { reason: item.reason }),
      ),
      ...(rule?.limitations ?? []).map(key),
      ...(adminLimitation === null ? [] : [adminLimitation]),
    ],
    causesNote: rule?.causesNote ? key(rule.causesNote) : null,
    causes: (rule?.causes ?? []).map(key),
    nextSteps: (rule?.nextSteps ?? ["diagnostic.rule.unknown.nextSteps.again"]).map(key),
    facts: [
      text("diagnostic.facts.duration", { seconds: (run.durationMs / 1000).toFixed(1) }),
      text("diagnostic.facts.companion", {
        name: run.companion.name,
        version: run.companion.firmwareVersion,
      }),
      text("diagnostic.facts.attempts", { used: run.attemptsUsed, per: run.attemptsPerCheck }),
    ],
  };
}

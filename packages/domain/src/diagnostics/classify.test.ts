import { describe, expect, it } from "vitest";

import type { CheckKind, CheckOutcome } from "./check";
import { classifyRun } from "./classify";
import type { ReasonCode } from "./reason-code";
import type { ResultCode } from "./result-code";

const out = (
  kind: CheckKind,
  result: ResultCode,
  reason: ReasonCode,
  attempts = 1,
): CheckOutcome => ({
  kind,
  result,
  reason,
  attempts,
  timeoutMs: 5000,
  timeoutSource: "estimate",
  startedAt: 1,
  durationMs: 10,
  evidence: null,
});
const ok = (kind: CheckKind) => out(kind, "RESPONDED", "ALL_CHECKS_REPLIED");
const silent = (kind: CheckKind) => out(kind, "NO_RESPONSE", "NO_REPLY", 2);
const skipped = () => out("telemetry", "UNSUPPORTED", "CAPABILITY_MISSING", 0);
const live = { cancelled: false };

describe("classifyRun", () => {
  const cases: [string, CheckOutcome[], { result: ResultCode; reason: ReasonCode; lim: number }][] =
    [
      [
        "all replied",
        [ok("login"), ok("status"), ok("telemetry")],
        { result: "RESPONDED", reason: "ALL_CHECKS_REPLIED", lim: 0 },
      ],
      [
        "all executed replied, telemetry skipped",
        [ok("login"), ok("status"), skipped()],
        { result: "RESPONDED", reason: "ALL_CHECKS_REPLIED", lim: 1 },
      ],
      [
        "login only replied",
        [ok("login"), silent("status")],
        { result: "RESPONDED", reason: "PARTIAL_REPLY", lim: 1 },
      ],
      [
        "login rejected",
        [out("login", "RESPONDED", "LOGIN_REJECTED")],
        { result: "RESPONDED", reason: "LOGIN_REJECTED", lim: 0 },
      ],
      [
        "login reply then link lost",
        [ok("login"), out("status", "TRANSPORT_UNAVAILABLE", "LINK_LOST")],
        { result: "RESPONDED", reason: "PARTIAL_REPLY", lim: 1 },
      ],
      [
        "no reply anywhere",
        [silent("login")],
        { result: "NO_RESPONSE", reason: "NO_REPLY", lim: 1 },
      ],
      [
        "no reply with skipped telemetry stays NO_RESPONSE",
        [silent("login"), skipped()],
        { result: "NO_RESPONSE", reason: "NO_REPLY", lim: 2 },
      ],
      [
        "malformed first",
        [out("login", "UNSUPPORTED", "MALFORMED_RESPONSE")],
        { result: "UNSUPPORTED", reason: "MALFORMED_RESPONSE", lim: 1 },
      ],
      [
        "err first",
        [out("login", "UNSUPPORTED", "COMMAND_REJECTED")],
        { result: "UNSUPPORTED", reason: "COMMAND_REJECTED", lim: 1 },
      ],
      [
        "no ack",
        [out("login", "TRANSPORT_UNAVAILABLE", "COMPANION_NO_ACK")],
        { result: "TRANSPORT_UNAVAILABLE", reason: "COMPANION_NO_ACK", lim: 1 },
      ],
      [
        "link lost first",
        [out("login", "TRANSPORT_UNAVAILABLE", "LINK_LOST")],
        { result: "TRANSPORT_UNAVAILABLE", reason: "LINK_LOST", lim: 1 },
      ],
      [
        "only skipped checks",
        [skipped()],
        { result: "UNSUPPORTED", reason: "CAPABILITY_MISSING", lim: 1 },
      ],
      ["no outcomes", [], { result: "NOT_TESTED", reason: "UNEXPECTED_ERROR", lim: 0 }],
      [
        "a rejected login wins over a later reply",
        [out("login", "RESPONDED", "LOGIN_REJECTED"), ok("status")],
        { result: "RESPONDED", reason: "LOGIN_REJECTED", lim: 0 },
      ],
      [
        "no reply next to an untested check is still NO_RESPONSE",
        [silent("login"), out("status", "NOT_TESTED", "UNEXPECTED_ERROR")],
        { result: "NO_RESPONSE", reason: "NO_REPLY", lim: 2 },
      ],
      [
        "unexpected outcome only",
        [out("login", "NOT_TESTED", "UNEXPECTED_ERROR")],
        { result: "NOT_TESTED", reason: "UNEXPECTED_ERROR", lim: 1 },
      ],
    ];

  it.each(cases)("%s", (_name, outcomes, expected) => {
    const run = classifyRun(outcomes, live);
    expect(run.result).toBe(expected.result);
    expect(run.reason).toBe(expected.reason);
    expect(run.limitations).toHaveLength(expected.lim);
  });

  it("lists non-replying checks as limitations with their reason", () => {
    expect(classifyRun([ok("login"), silent("status")], live).limitations).toEqual([
      { check: "status", result: "NO_RESPONSE", reason: "NO_REPLY" },
    ]);
  });

  it("makes a cancel win even after a reply (D-3)", () => {
    const run = classifyRun([ok("login"), out("status", "NOT_TESTED", "CANCELLED")], {
      cancelled: true,
    });
    expect(run).toMatchObject({ result: "NOT_TESTED", reason: "CANCELLED" });
    expect(run.limitations).toEqual([
      { check: "status", result: "NOT_TESTED", reason: "CANCELLED" },
    ]);
  });

  it("classifies a cancel before any check", () => {
    expect(classifyRun([], { cancelled: true })).toEqual({
      result: "NOT_TESTED",
      reason: "CANCELLED",
      limitations: [],
    });
  });

  it.each([
    ["NOT_CONNECTED", "TRANSPORT_UNAVAILABLE"],
    ["CAPABILITY_MISSING", "UNSUPPORTED"],
    ["UNEXPECTED_ERROR", "NOT_TESTED"],
  ] as const)("a %s preflight overrides everything", (preflight, result) => {
    expect(classifyRun([ok("login")], { cancelled: true, preflight })).toEqual({
      result,
      reason: preflight,
      limitations: [],
    });
  });
});

import { describe, expect, it } from "vitest";

import type { ReasonCode } from "./reason-code";
import type { ResultCode } from "./result-code";
import { ageBucket, lastRunStatus } from "./status";

const run = (result: ResultCode, reason: ReasonCode, finishedAt = 1000) => ({
  result,
  reason,
  finishedAt,
});

describe("lastRunStatus", () => {
  it("reads a node without runs as not tested", () => {
    expect(lastRunStatus(null, 5)).toEqual({ kind: "not_tested", ageMs: null });
  });

  it.each([
    ["RESPONDED", "ALL_CHECKS_REPLIED", "responded"],
    ["RESPONDED", "PARTIAL_REPLY", "responded"],
    ["RESPONDED", "LOGIN_REJECTED", "responded"],
    ["NO_RESPONSE", "NO_REPLY", "no_reply"],
    ["TRANSPORT_UNAVAILABLE", "LINK_LOST", "transport_error"],
    ["UNSUPPORTED", "MALFORMED_RESPONSE", "unsupported"],
    ["NOT_TESTED", "CANCELLED", "cancelled"],
    ["NOT_TESTED", "UNEXPECTED_ERROR", "incomplete"],
  ] as const)("%s/%s is %s", (result, reason, kind) => {
    expect(lastRunStatus(run(result, reason), 4000)).toEqual({ kind, ageMs: 3000 });
  });

  it("does not report a negative age", () => {
    expect(lastRunStatus(run("NO_RESPONSE", "NO_REPLY", 9000), 1000).ageMs).toBe(0);
  });
});

describe("ageBucket", () => {
  const m = 60_000;
  const h = 60 * m;
  it.each([
    [0, "now", 0],
    [59_999, "now", 0],
    [m, "minute", 1],
    [59 * m + 59_999, "minute", 59],
    [60 * m, "hour", 1],
    [23 * h + 59 * m, "hour", 23],
    [24 * h, "day", 1],
    [50 * h, "day", 2],
  ] as const)("%d ms is %s %d", (ms, unit, count) => {
    expect(ageBucket(ms)).toEqual({ unit, count });
  });
});

import { describe, expect, it } from "vitest";

import { REASONS_BY_RESULT } from "./reason-code";
import { RULES, ruleFor } from "./rules";
import { RESULT_CODES } from "./result-code";

describe("RULES", () => {
  const pairs = RESULT_CODES.flatMap((result) =>
    REASONS_BY_RESULT[result].map((reason) => [result, reason] as const),
  );

  it.each(pairs)("%s/%s has a complete rule", (result, reason) => {
    const rule = ruleFor(result, reason);
    expect(rule).not.toBeNull();
    expect(rule!.summary).toBe(`diagnostic.rule.${result}.${reason}.summary`);
    expect(rule!.explanation).toBe(`diagnostic.rule.${result}.${reason}.explanation`);
    expect(rule!.nextSteps.length).toBeGreaterThan(0);
    for (const key of [...rule!.causes, ...rule!.nextSteps, ...rule!.limitations]) {
      expect(key.startsWith(`diagnostic.rule.${result}.${reason}.`)).toBe(true);
    }
  });

  // The FR-09 table: which causes, next steps and limitations each result × reason lists.
  const PARTS: [string, string, string[], string[], string[]][] = [
    ["RESPONDED", "ALL_CHECKS_REPLIED", [], ["review"], []],
    ["RESPONDED", "PARTIAL_REPLY", ["route", "congestion"], ["retry"], ["unanswered"]],
    [
      "RESPONDED",
      "LOGIN_REJECTED",
      ["password", "permissions"],
      ["credentials", "other"],
      ["noSession"],
    ],
    [
      "NO_RESPONSE",
      "NO_REPLY",
      ["route", "congestion", "device"],
      ["wait", "closer"],
      ["unknownCause"],
    ],
    ["TRANSPORT_UNAVAILABLE", "NOT_CONNECTED", [], ["connect"], []],
    ["TRANSPORT_UNAVAILABLE", "LINK_LOST", ["range", "companion"], ["reconnect"], ["notSent"]],
    ["TRANSPORT_UNAVAILABLE", "COMPANION_NO_ACK", ["companion"], ["reconnect"], ["notSent"]],
    ["UNSUPPORTED", "CAPABILITY_MISSING", [], ["update"], ["firmware"]],
    ["UNSUPPORTED", "COMMAND_REJECTED", ["firmware", "contact"], ["sync", "update"], ["rejected"]],
    [
      "UNSUPPORTED",
      "MALFORMED_RESPONSE",
      ["firmware", "corrupt"],
      ["retry", "report"],
      ["unreadable"],
    ],
    ["NOT_TESTED", "CANCELLED", [], ["again"], []],
    ["NOT_TESTED", "UNEXPECTED_ERROR", [], ["again"], ["unknown"]],
  ];
  const names = (keys: string[]) => keys.map((key) => key.split(".").slice(4).join("."));

  it("covers every declared pair in the table below", () => {
    expect(PARTS.map(([result, reason]) => `${result}/${reason}`).sort()).toEqual(
      pairs.map(([result, reason]) => `${result}/${reason}`).sort(),
    );
  });

  it.each(PARTS)(
    "%s/%s lists its causes, next steps and limitations",
    (result, reason, causes, steps, limits) => {
      const rule = ruleFor(result as never, reason)!;
      expect(names(rule.causes)).toEqual(causes.map((name) => `causes.${name}`));
      expect(names(rule.nextSteps)).toEqual(steps.map((name) => `nextSteps.${name}`));
      expect(names(rule.limitations)).toEqual(limits.map((name) => `limitations.${name}`));
    },
  );

  it("has no rules beyond the declared pairs", () => {
    const count = Object.values(RULES).reduce((n, byReason) => n + Object.keys(byReason).length, 0);
    expect(count).toBe(pairs.length);
  });

  it("returns null for an invalid pair, including prototype names", () => {
    expect(ruleFor("NO_RESPONSE", "LINK_LOST")).toBeNull();
    expect(ruleFor("NO_RESPONSE", "toString")).toBeNull();
  });

  it("lists route, congestion and device as unconfirmed causes of no reply", () => {
    const rule = RULES.NO_RESPONSE.NO_REPLY;
    expect(rule.causes.map((k) => k.split(".").pop())).toEqual(["route", "congestion", "device"]);
    expect(rule.causesNote).toBe("diagnostic.rule.NO_RESPONSE.NO_REPLY.causesNote");
  });

  it("gives a causes note whenever there are guessed causes", () => {
    for (const [result, reason] of pairs) {
      const rule = ruleFor(result, reason)!;
      if (result !== "RESPONDED" || reason === "PARTIAL_REPLY") {
        expect(rule.causesNote !== null, `${result}/${reason}`).toBe(rule.causes.length > 0);
      }
    }
  });
});

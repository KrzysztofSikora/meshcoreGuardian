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

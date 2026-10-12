import { describe, expect, it } from "vitest";

import { deriveCapabilities } from "../companion/capabilities";
import { CHECK_KINDS, continuesAfter, planChecks } from "./check";
import { REASONS_BY_RESULT } from "./reason-code";
import { RESULT_CODES } from "./result-code";

const caps = (firmwareVerCode: number) =>
  deriveCapabilities({ firmwareVerCode, firmwareVersion: "v1.4.0" });

describe("planChecks", () => {
  it("runs login, status and telemetry on a current firmware", () => {
    expect(planChecks(caps(13))).toEqual({ run: ["login", "status", "telemetry"], skipped: [] });
  });

  it("stores telemetry as unsupported without running it below the telemetry version", () => {
    expect(planChecks(caps(5))).toEqual({ run: ["login", "status", "telemetry"], skipped: [] });
    const plan = planChecks(caps(4));
    expect(plan).toEqual({
      run: ["login", "status"],
      skipped: [
        {
          kind: "telemetry",
          result: "UNSUPPORTED",
          reason: "CAPABILITY_MISSING",
          attempts: 0,
          timeoutMs: null,
          timeoutSource: null,
          startedAt: null,
          durationMs: null,
          evidence: null,
        },
      ],
    });
  });

  it("reports the whole run unsupported when status is missing", () => {
    const capabilities = { ...caps(13), status: caps(0).status };
    expect(planChecks(capabilities)).toEqual({
      unsupported: expect.objectContaining({
        kind: "status",
        result: "UNSUPPORTED",
        reason: "CAPABILITY_MISSING",
        attempts: 0,
      }),
    });
  });

  it("leaves login out when it is unsupported", () => {
    const capabilities = { ...caps(13), login: caps(0).login };
    expect(planChecks(capabilities)).toEqual({ run: ["status", "telemetry"], skipped: [] });
  });
});

describe("continuesAfter", () => {
  it("continues only after a reply that is not a rejected login", () => {
    for (const result of RESULT_CODES) {
      for (const reason of REASONS_BY_RESULT[result]) {
        const expected = result === "RESPONDED" && reason !== "LOGIN_REJECTED";
        expect(continuesAfter({ result, reason }), `${result}/${reason}`).toBe(expected);
      }
    }
  });
});

describe("CHECK_KINDS", () => {
  it("lists the checks in send order", () => {
    expect(CHECK_KINDS).toEqual(["login", "status", "telemetry"]);
  });
});

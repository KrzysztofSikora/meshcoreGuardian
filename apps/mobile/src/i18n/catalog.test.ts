import {
  CAPABILITIES,
  CONNECT_FAILURE_REASONS,
  CONTACT_SYNC_FAILURES,
  NODE_ROLES,
  REASONS_BY_RESULT,
  RULES,
  type StatusKind,
} from "@guardian/domain";
import { describe, expect, it } from "vitest";

import { statusText } from "../application/diagnostics/presenter";
import { reportedAsText, roleText, syncLine } from "../application/nodes/presenter";
import { tr } from "../components/translate";
import en from "./en.json";
import { i18n } from "./index";

const screens = ["dashboard", "node", "run", "settings"] as const;

function values(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node !== null && typeof node === "object") return Object.values(node).flatMap(values);
  return [];
}

describe("en catalog", () => {
  it.each(screens)("%s has a non-empty title and placeholder", (screen) => {
    expect(en[screen].title.trim()).not.toBe("");
    expect(en[screen].placeholder.trim()).not.toBe("");
  });

  it("connect has a title", () => {
    expect(en.connect.title.trim()).not.toBe("");
  });

  it.each(CONNECT_FAILURE_REASONS)("has a text for failure reason %s", (reason) => {
    expect(en.connection.reason[reason].trim()).not.toBe("");
  });

  it.each(CAPABILITIES)("has a label for capability %s", (capability) => {
    expect(en.capability[capability].trim()).not.toBe("");
  });

  it.each(NODE_ROLES)("has role and reported-as texts for %s", (role) => {
    expect(i18n.exists(roleText(role).key)).toBe(true);
    const reported = reportedAsText({
      publicKey: "a".repeat(64),
      reportedName: "n",
      reportedRole: role,
      reportedType: 4,
      userLabel: "x",
      userRole: null,
      lastHeardAt: null,
      inContacts: true,
      dashboardPinned: false,
      createdAt: 0,
      syncedAt: 0,
    });
    expect(i18n.exists(reported?.key ?? "")).toBe(true);
  });

  it.each(CONTACT_SYNC_FAILURES)("has a sync failure text for %s", (reason) => {
    const line = syncLine({ kind: "failed", reason });
    expect(i18n.exists(line?.key ?? "")).toBe(true);
  });

  it("has every rule text the table points at (FR-09 AC1)", () => {
    for (const byReason of Object.values(RULES)) {
      for (const rule of Object.values(byReason)) {
        const keys = [
          rule.summary,
          rule.explanation,
          ...(rule.causesNote === null ? [] : [rule.causesNote]),
          ...rule.causes,
          ...rule.nextSteps,
          ...rule.limitations,
        ];
        for (const key of keys) expect(i18n.exists(key), key).toBe(true);
      }
    }
  });

  it("has a check outcome text for every reason", () => {
    for (const reasons of Object.values(REASONS_BY_RESULT)) {
      for (const reason of reasons)
        expect(i18n.exists(`diagnostic.outcome.${reason}`), reason).toBe(true);
    }
  });

  it("says 'No response — cause unknown' for a missing reply (TR-01)", () => {
    expect(tr(i18n.t, { key: RULES.NO_RESPONSE.NO_REPLY.summary })).toBe(
      "No response — cause unknown",
    );
  });

  it.each([
    "not_tested",
    "responded",
    "no_reply",
    "transport_error",
    "unsupported",
    "cancelled",
    "incomplete",
  ] as StatusKind[])("resolves the status text for %s", (kind) => {
    const text = statusText({ kind, ageMs: 120_000 });
    expect(i18n.exists(text.key, { count: 2 }), text.key).toBe(true);
  });

  it("never says offline, down or dead (a timeout is NO_RESPONSE, not a verdict)", () => {
    for (const value of values(en)) expect(value).not.toMatch(/\b(offline|down|dead)\b/i);
  });

  it.each([
    ["ble", "Transport: BLE"],
    ["fake", "Transport: Fake (development)"],
  ] as const)("interpolates the %s transport label", (mode, expected) => {
    expect(i18n.t("settings.transport", { mode: i18n.t(`transport.${mode}`) })).toBe(expected);
  });
});

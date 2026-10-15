import {
  CAPABILITIES,
  COMPASS_POINTS,
  CONNECT_FAILURE_REASONS,
  CONTACT_SYNC_FAILURES,
  NODE_ROLES,
  REASONS_BY_RESULT,
  RULES,
  type StatusKind,
} from "@guardian/domain";
import { describe, expect, it } from "vitest";

import { statusText } from "../application/diagnostics/presenter";
import {
  lastResponseText,
  recentRunRow,
  telemetryCard,
} from "../application/nodes/history-presenter";
import { nearestCard } from "../application/nodes/nearest-presenter";
import { reportedAsText, roleText, syncLine } from "../application/nodes/presenter";
import { tr } from "../components/translate";
import en from "./en.json";
import { i18n } from "./index";

const screens = ["dashboard", "run", "settings"] as const;

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

  it("node has a title", () => {
    expect(en.node.title.trim()).not.toBe("");
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
      pathHops: null,
      position: null,
      pathCompanionKey: null,
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

  it.each(COMPASS_POINTS)("has a compass word for %s", (point) => {
    expect(en.nearest.compass[point].trim()).not.toBe("");
  });

  it("resolves every text the nearest card can produce", () => {
    const node = (
      publicKey: string,
      pathHops: number | null,
      position: { lat: number; lon: number } | null,
    ) => ({
      publicKey,
      reportedName: publicKey,
      reportedRole: "repeater" as const,
      reportedType: 2,
      userLabel: null,
      userRole: null,
      lastHeardAt: null,
      pathHops,
      position,
      pathCompanionKey: "c",
      inContacts: true,
      dashboardPinned: true,
      createdAt: 0,
      syncedAt: 1,
    });
    const origin = { companionPublicKey: "c", position: { lat: 50, lon: 20 }, at: 1 };
    const cards = [
      nearestCard([], null, String),
      nearestCard(
        [
          node("a", 0, { lat: 50, lon: 20 }),
          node("b", 1, null),
          node("c", 3, { lat: 51, lon: 20 }),
        ],
        origin,
        String,
      ),
      nearestCard([node("a", null, null)], { ...origin, position: null }, String),
    ];
    for (const card of cards) {
      const texts =
        card.kind === "empty"
          ? [card.text, card.syncHint]
          : [
              card.asOf,
              ...[card.nearest, ...card.others].flatMap((c) => [
                c.name,
                c.role,
                c.path,
                c.position,
                c.lastHeard,
              ]),
            ];
      for (const text of texts) {
        if (text === null) continue;
        expect(i18n.exists(text.key, { count: 2 }), text.key).toBe(true);
      }
    }
  });

  it("never claims range, presence or reachability in the nearest texts (FR-21 AC4)", () => {
    for (const value of values(en.nearest)) {
      expect(value).not.toMatch(/\b(in range|online|reachable|available)\b/i);
    }
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

  it("resolves every text the telemetry card, last response and run rows can produce", () => {
    const sample = (source: "status" | "telemetry", over: object) => ({
      runId: 1,
      checkSeq: 1,
      source,
      measuredAt: 1,
      voltageV: null,
      uptimeS: null,
      rssiDbm: null,
      snrDb: null,
      extra: [],
      ...over,
    });
    const texts: { key: string; params?: Record<string, string | number> }[] = [];
    const collect = (model: ReturnType<typeof telemetryCard>) => {
      if ("empty" in model) return void texts.push(model.empty);
      texts.push(model.heading, model.fromRun);
      if (model.note !== null) texts.push(model.note);
      for (const g of model.groups) {
        texts.push(g.title);
        if (g.measured !== null) texts.push(g.measured);
        for (const r of g.rows) texts.push(r.label, r.value);
      }
    };
    const fmt = String;
    collect(telemetryCard([], fmt));
    const extras = [
      ...[
        "noise_floor",
        "generic",
        "illuminance",
        "presence",
        "temperature",
        "humidity",
        "pressure",
        "voltage",
        "current",
        "percentage",
        "concentration",
        "power",
        "gps",
        "latitude",
        "longitude",
        "altitude",
        "lpp_200",
      ].flatMap((name) => [
        { name, value: 1, unit: "x", channel: null },
        { name, value: 1, unit: null, channel: 2 },
      ]),
    ];
    for (const scope of ["last_hop", "unknown"] as const) {
      collect(
        telemetryCard(
          [
            sample("status", {
              voltageV: 3.3,
              uptimeS: 5,
              rssiDbm: { value: -1, scope },
              snrDb: { value: 1, scope },
              extra: extras,
            }),
            sample("telemetry", { extra: extras }),
          ] as never,
          fmt,
        ),
      );
    }
    collect(telemetryCard([sample("status", {}), sample("telemetry", {})] as never, fmt));
    collect(telemetryCard([sample("status", {})] as never, fmt));
    collect(telemetryCard([sample("telemetry", {})] as never, fmt));
    texts.push(lastResponseText(null, fmt), lastResponseText(1, fmt));
    for (const ms of [1000, 90_000]) {
      const row = recentRunRow(
        { result: "RESPONDED", reason: "ALL_CHECKS_REPLIED", finishedAt: 1, durationMs: ms },
        fmt,
        1,
      );
      texts.push(row.time, row.duration);
    }
    for (const text of texts) {
      expect(i18n.exists(text.key), text.key).toBe(true);
      const rendered = tr(i18n.t, text);
      expect(rendered, text.key).not.toMatch(/\{\{|\$t\(|undefined|telemetry\.name/);
    }
  });
});

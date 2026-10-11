import type { Scenario } from "../platform/fake/fake-ble-platform";

const COMPANION = { id: "AA:BB:CC:DD:EE:01", name: "MeshCore-companion" };

const base: Scenario = {
  permission: "granted",
  bluetooth: "on",
  devices: [COMPANION],
  attempts: ["ok"],
};

/** Fake-build scenarios selected by `guardian://debug/scenario/<name>` (plan D-14). */
export const SCENARIOS = {
  "connect-ok": base,
  "permission-denied": { ...base, permission: "denied" },
  "bluetooth-off": { ...base, bluetooth: "off" },
  "connect-fail": { ...base, attempts: ["connect-error", "ok"] },
  "link-drop": { ...base, attempts: [{ dropAfterMs: 3000 }, "ok"] },
  "unsupported-capability": {
    ...base,
    attempts: [{ firmware: { verCode: 4, version: "v1.4.0" } }],
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;

export function isScenarioName(value: string): value is ScenarioName {
  return Object.hasOwn(SCENARIOS, value);
}

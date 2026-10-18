import { keyPrefix, type Node } from "@guardian/domain";

import type { RunState } from "../diagnostics/run-controller";
import type { NodesState } from "../nodes/nodes-controller";
import { nameText } from "../nodes/presenter";
import type { DeletionResult } from "./data-deletion";
import type { SessionState } from "../connection/companion-session";
import type { Text } from "../nodes/presenter";
import type { SaveResult, SettingsState } from "./settings-controller";

export interface SettingsView {
  /** While true nothing about the saved values is claimed (lesson on loading states). */
  loading: boolean;
  /** Saved settings could not be read; defaults are in use until the next save (D-2). */
  unreadableNote: Text | null;
  timeout: Text;
  attempts: number;
  redactKeys: boolean;
  appVersion: Text;
  companion:
    | { kind: "none"; text: Text }
    | { kind: "info"; name: string; lines: Text[]; untested: boolean };
}

/** Texts as catalog keys for the preferences and about sections (FR-15 AC1). */
export function settingsView(
  state: SettingsState,
  session: Pick<SessionState, "connection" | "firmwareTested">,
  appVersion: string,
): SettingsView {
  const { settings } = state;
  const { connection } = session;
  return {
    loading: state.status === "loading",
    unreadableNote: state.unreadable ? { key: "settings.unreadable" } : null,
    timeout:
      settings.timeoutOverrideS === null
        ? { key: "settings.timeoutAuto" }
        : { key: "settings.timeoutValue", params: { seconds: settings.timeoutOverrideS } },
    attempts: settings.attempts,
    redactKeys: settings.redactKeys,
    appVersion: { key: "settings.appVersion", params: { version: appVersion } },
    companion:
      connection.kind === "connected"
        ? {
            kind: "info",
            name: connection.companion.name,
            lines: [
              { key: "connect.model", params: { model: connection.companion.model } },
              { key: "connect.firmware", params: { version: connection.companion.firmwareVersion } },
              { key: "connect.build", params: { date: connection.companion.buildDate } },
            ],
            untested: session.firmwareTested === false,
          }
        : { kind: "none", text: { key: "settings.noCompanion" } },
  };
}

/** The message under a field after a save, or null when it went through. */
export function saveProblem(result: SaveResult): Text | null {
  if (result.ok) return null;
  if (result.reason === "OUT_OF_RANGE") {
    const key = result.field === "attempts" ? "settings.attemptsRange" : "settings.timeoutRange";
    return { key, params: { min: result.range[0], max: result.range[1] } };
  }
  return { key: "settings.saveFailed" };
}

export interface DeletionRow {
  publicKey: string;
  /** Short key prefix, used for the button id. */
  prefix: string;
  name: Text;
}

export interface DataView {
  rows: DeletionRow[];
  /** Shown only when both stores loaded without error and no node has history (D-13). */
  empty: Text | null;
  /** Both actions are disabled while a run or a sync is active (D-11). */
  busyNote: Text | null;
}

const hasHistory = (node: Node, latest: RunState["latest"]) =>
  latest[node.publicKey] !== undefined || node.userLabel !== null || node.userRole !== null;

/** The "Delete history" list: nodes with a stored run, label or role, in dashboard order (D-13). */
export function dataView(
  runs: Pick<RunState, "latest" | "loaded" | "active" | "storage">,
  nodes: Pick<NodesState, "nodes" | "loaded" | "storage" | "sync">,
): DataView {
  const rows = nodes.nodes
    .filter((node) => hasHistory(node, runs.latest))
    .map((node) => ({ publicKey: node.publicKey, prefix: keyPrefix(node.publicKey), name: nameText(node) }));
  const loadedOk = runs.loaded && nodes.loaded && runs.storage === "ok" && nodes.storage === "ok";
  const busy = runs.active !== null || nodes.sync.kind === "syncing";
  return {
    rows,
    empty: loadedOk && rows.length === 0 ? { key: "settings.noHistory" } : null,
    busyNote: busy ? { key: "settings.busy" } : null,
  };
}

/** What the person is told after a deletion, success or not (D-10). */
export function deletionMessage(result: DeletionResult, scope: "node" | "all"): Text {
  if (result.ok) return { key: scope === "all" ? "settings.clearedAll" : "settings.deleted" };
  switch (result.reason) {
    case "BUSY":
      return { key: "settings.busy" };
    case "STORAGE_ERROR":
      return { key: "settings.deleteStorageError" };
    case "SECRET_ERROR":
      return { key: scope === "all" ? "settings.clearSecretError" : "settings.deleteSecretError" };
  }
}

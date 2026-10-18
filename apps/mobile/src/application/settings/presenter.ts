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
    return { key: "settings.timeoutRange", params: { min: result.range[0], max: result.range[1] } };
  }
  return { key: "settings.saveFailed" };
}

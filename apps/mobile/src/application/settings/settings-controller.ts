import { createStore, type StoreApi } from "zustand/vanilla";

import type { DiagnosticPolicy } from "@guardian/domain";

import type { SettingsStore } from "./ports";
import {
  DEFAULT_SETTINGS,
  TIMEOUT_RANGE_S,
  parseStoredSettings,
  parseTimeoutInput,
  serializeSettings,
  toPolicy,
  type Settings,
} from "./settings";

export interface SettingsState {
  status: "loading" | "ready";
  settings: Settings;
  /** The stored value could not be read; defaults are in use until the next save (D-2). */
  unreadable: boolean;
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "OUT_OF_RANGE"; range: readonly [number, number] }
  | { ok: false; reason: "STORAGE_ERROR" };

/**
 * Settings as the rest of the app sees them. A change is validated, written, and only then
 * visible in state, so a rejected or failed save leaves the value in use untouched (FR-15 AC3).
 */
export class SettingsController {
  readonly store: StoreApi<SettingsState> = createStore<SettingsState>(() => ({
    status: "loading",
    settings: DEFAULT_SETTINGS,
    unreadable: false,
  }));
  private loading: Promise<void> | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly persistence: SettingsStore) {}

  /** Idempotent: every call returns the same read. */
  load(): Promise<void> {
    return (this.loading ??= this.read());
  }

  getState(): SettingsState {
    return this.store.getState();
  }

  /** The policy for a run that starts now; defaults until the stored value has loaded. */
  policy(): DiagnosticPolicy {
    return toPolicy(this.getState().settings);
  }

  async redactionDefault(): Promise<boolean> {
    await this.load();
    return this.getState().settings.redactKeys;
  }

  /** `"auto"` clears the override; text must be whole seconds within the allowed range. */
  async setTimeout(input: string | "auto"): Promise<SaveResult> {
    if (input === "auto") return this.save({ timeoutOverrideS: null });
    const parsed = parseTimeoutInput(input);
    if (!parsed.ok) return { ok: false, reason: "OUT_OF_RANGE", range: TIMEOUT_RANGE_S };
    return this.save({ timeoutOverrideS: parsed.seconds });
  }

  setAttempts(attempts: number): Promise<SaveResult> {
    return this.save({ attempts });
  }

  setRedactKeys(redactKeys: boolean): Promise<SaveResult> {
    return this.save({ redactKeys });
  }

  private async read(): Promise<void> {
    try {
      const { settings, unreadable } = parseStoredSettings(await this.persistence.read());
      this.store.setState({ status: "ready", settings, unreadable });
    } catch {
      this.store.setState({ status: "ready", settings: DEFAULT_SETTINGS, unreadable: true });
    }
  }

  private save(change: Partial<Settings>): Promise<SaveResult> {
    const run = this.tail.then(async (): Promise<SaveResult> => {
      await this.load();
      const next = { ...this.getState().settings, ...change };
      try {
        await this.persistence.write(serializeSettings(next));
      } catch {
        return { ok: false, reason: "STORAGE_ERROR" };
      }
      this.store.setState({ settings: next, unreadable: false });
      return { ok: true };
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

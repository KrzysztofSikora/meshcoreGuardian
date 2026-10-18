import { z } from "zod";

import {
  ATTEMPTS_RANGE,
  DEFAULT_DIAGNOSTIC_POLICY,
  OVERRIDE_RANGE_MS,
  type DiagnosticPolicy,
} from "@guardian/domain";

export interface Settings {
  /** Whole seconds, or null for the automatic timeout. */
  timeoutOverrideS: number | null;
  attempts: number;
  redactKeys: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timeoutOverrideS: null,
  attempts: DEFAULT_DIAGNOSTIC_POLICY.attempts,
  redactKeys: true,
};

/** Allowed timeout override in whole seconds, derived from the domain range. */
export const TIMEOUT_RANGE_S = [OVERRIDE_RANGE_MS[0] / 1000, OVERRIDE_RANGE_MS[1] / 1000] as const;

const settingsSchema = z.strictObject({
  version: z.literal(1),
  timeoutOverrideS: z
    .number()
    .int()
    .min(TIMEOUT_RANGE_S[0])
    .max(TIMEOUT_RANGE_S[1])
    .nullable(),
  attempts: z.number().int().min(ATTEMPTS_RANGE[0]).max(ATTEMPTS_RANGE[1]),
  redactKeys: z.boolean(),
});

/** True when the values are within the allowed ranges (same rules as the stored shape). */
export function isValidSettings(settings: Settings): boolean {
  const { version: _version, ...shape } = settingsSchema.shape;
  return z.strictObject(shape).safeParse(settings).success;
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: 1, ...settings });
}

/** Missing value: defaults. Unreadable value: defaults, flagged so the screen can say so (D-2). */
export function parseStoredSettings(raw: string | null): {
  settings: Settings;
  unreadable: boolean;
} {
  if (raw === null) return { settings: DEFAULT_SETTINGS, unreadable: false };
  try {
    const { version: _version, ...settings } = settingsSchema.parse(JSON.parse(raw));
    return { settings, unreadable: false };
  } catch {
    return { settings: DEFAULT_SETTINGS, unreadable: true };
  }
}

export type TimeoutInput =
  | { ok: true; seconds: number }
  | { ok: false; reason: "OUT_OF_RANGE"; min: number; max: number };

/** Whole seconds only; anything else is rejected with the allowed range (FR-15 AC3). */
export function parseTimeoutInput(text: string): TimeoutInput {
  const trimmed = text.trim();
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!(seconds >= TIMEOUT_RANGE_S[0] && seconds <= TIMEOUT_RANGE_S[1])) {
    return { ok: false, reason: "OUT_OF_RANGE", min: TIMEOUT_RANGE_S[0], max: TIMEOUT_RANGE_S[1] };
  }
  return { ok: true, seconds };
}

export function toPolicy(settings: Settings): DiagnosticPolicy {
  return {
    attempts: settings.attempts,
    overrideMs: settings.timeoutOverrideS === null ? null : settings.timeoutOverrideS * 1000,
  };
}

export const CONTACT_SYNC_FAILURES = [
  "NO_RESPONSE",
  "TRANSPORT_UNAVAILABLE",
  "UNSUPPORTED",
  "MALFORMED_RESPONSE",
  "STORAGE_ERROR",
  "UNEXPECTED",
] as const;

export type ContactSyncFailure = (typeof CONTACT_SYNC_FAILURES)[number];

/** `at` is epoch ms; `total` and `received` count contacts. */
export type ContactSyncState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "done"; at: number; total: number }
  | { kind: "partial"; at: number; received: number; expected: number }
  | { kind: "failed"; reason: ContactSyncFailure };

export function isContactSyncFailure(value: unknown): value is ContactSyncFailure {
  return typeof value === "string" && (CONTACT_SYNC_FAILURES as readonly string[]).includes(value);
}

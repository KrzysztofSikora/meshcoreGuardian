import type { CompanionInfo } from "./companion";

export const CONNECT_FAILURE_REASONS = [
  "CONNECT_TIMEOUT",
  "CONNECT_ERROR",
  "HANDSHAKE_NO_RESPONSE",
  "HANDSHAKE_MALFORMED",
  "LINK_LOST",
  "BLUETOOTH_OFF",
] as const;

export type ConnectFailureReason = (typeof CONNECT_FAILURE_REASONS)[number];

/** Exactly one of four states (FR-01 AC5). */
export type ConnectionState =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "connected"; companion: CompanionInfo }
  | { kind: "failed"; reason: ConnectFailureReason };

export function isConnectFailureReason(value: unknown): value is ConnectFailureReason {
  return typeof value === "string" && (CONNECT_FAILURE_REASONS as readonly string[]).includes(value);
}

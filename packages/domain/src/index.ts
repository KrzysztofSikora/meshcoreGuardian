export { RESULT_CODES, isResultCode } from "./diagnostics/result-code";
export type { ResultCode } from "./diagnostics/result-code";
export { REASONS_BY_RESULT, isReasonFor } from "./diagnostics/reason-code";
export type { ReasonCode, ReasonsOf } from "./diagnostics/reason-code";
export { CHECK_KINDS, continuesAfter, planChecks } from "./diagnostics/check";
export type { CheckEvidence, CheckKind, CheckOutcome, CheckPlan } from "./diagnostics/check";
export {
  OVERRIDE_RANGE_MS,
  TIMEOUT_CAP_MS,
  TIMEOUT_DEFAULT_MS,
  TIMEOUT_FLOOR_MS,
  TIMEOUT_MARGIN,
  attemptTimeout,
} from "./policy/timeout";
export type { TimeoutSource } from "./policy/timeout";
export {
  ATTEMPTS_RANGE,
  DEFAULT_DIAGNOSTIC_POLICY,
  assertAttempts,
  shouldRetry,
} from "./policy/retry";
export type { DiagnosticPolicy } from "./policy/retry";
export { COOLDOWN_MS, cooldownRemaining, cooldownRemainingAt } from "./policy/cooldown";
export type { CompanionInfo } from "./companion/companion";
export {
  CAPABILITIES,
  CAPABILITY_MIN_VER_CODE,
  actionAvailability,
  deriveCapabilities,
} from "./companion/capabilities";
export type {
  ActionAvailability,
  Capabilities,
  Capability,
  CapabilityStatus,
} from "./companion/capabilities";
export { TESTED_FIRMWARE, isTestedFirmware } from "./companion/firmware";
export { CONNECT_FAILURE_REASONS, isConnectFailureReason } from "./companion/connection-state";
export type { ConnectFailureReason, ConnectionState } from "./companion/connection-state";
export {
  LABEL_MAX_LENGTH,
  NODE_ROLES,
  contactLastHeard,
  displayName,
  effectiveRole,
  isOnDashboard,
  keyPrefix,
  normalizeLabel,
  roleFromContactType,
  sortNodes,
} from "./nodes/node";
export type { ContactReport, LabelResult, Node, NodeRole } from "./nodes/node";
export type { NodeRepository, SyncOutcome } from "./nodes/ports";
export { CONTACT_SYNC_FAILURES, isContactSyncFailure } from "./nodes/sync";
export type { ContactSyncFailure, ContactSyncState } from "./nodes/sync";

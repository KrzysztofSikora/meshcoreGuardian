export { RESULT_CODES, isResultCode } from "./diagnostics/result-code";
export type { ResultCode } from "./diagnostics/result-code";
export { REASONS_BY_RESULT, isReasonFor } from "./diagnostics/reason-code";
export type { ReasonCode, ReasonsOf } from "./diagnostics/reason-code";
export { CHECK_KINDS, continuesAfter, planChecks } from "./diagnostics/check";
export type { CheckEvidence, CheckKind, CheckOutcome, CheckPlan } from "./diagnostics/check";
export { loginEvidence, sessionRole } from "./diagnostics/session-role";
export type { SessionRole } from "./diagnostics/session-role";
export { classifyRun } from "./diagnostics/classify";
export type {
  ClassifyContext,
  Limitation,
  Preflight,
  RunClassification,
} from "./diagnostics/classify";
export { RULES, ruleFor } from "./diagnostics/rules";
export type { Key, Rule } from "./diagnostics/rules";
export type { DiagnosticRun, DiagnosticRunRepository, RunCompanion } from "./diagnostics/run";
export { ageBucket, lastRunStatus } from "./diagnostics/status";
export type { AgeBucket, RunStatus, StatusKind } from "./diagnostics/status";
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
export type { NodeRepository, SyncOrigin, SyncOutcome } from "./nodes/ports";
export { CONTACT_SYNC_FAILURES, isContactSyncFailure } from "./nodes/sync";
export type { ContactSyncFailure, ContactSyncState } from "./nodes/sync";
export {
  COMPASS_POINTS,
  advertisedPosition,
  compassPoint,
  distanceMeters,
  initialBearing,
} from "./geo/geo";
export type { CompassPoint, GeoPoint } from "./geo/geo";
export { OTHER_NEARBY_COUNT, nearestRepeaters, rankRepeaters } from "./nodes/nearest";
export type { RankedRepeater } from "./nodes/nearest";
export { GUEST_PASSWORD_MAX_BYTES, validateGuestPassword } from "./nodes/guest-password";
export type { GuestPasswordResult } from "./nodes/guest-password";
export type { SecretStore } from "./secrets/secret-store";
export { lppMeaning } from "./telemetry/lpp";
export type { LppMeaning } from "./telemetry/lpp";
export type { TelemetryRepository } from "./telemetry/ports";
export {
  TREND_MIN_SAMPLES,
  TREND_MIN_SPAN_MS,
  TREND_STABLE_BAND_V,
  voltagePoints,
  voltageTrend,
} from "./telemetry/voltage";
export type { VoltagePoint, VoltageReading, VoltageTrend } from "./telemetry/voltage";
export { SIGNAL_SCOPES, TELEMETRY_SOURCES, samplesFromChecks } from "./telemetry/samples";
export type {
  Signal,
  SignalScope,
  TelemetrySample,
  TelemetrySource,
  TelemetryValue,
} from "./telemetry/samples";
export { EXPORT_SCHEMA_VERSION, buildReport } from "./export/report";
export type { ExportInput, ExportReport, ExportRun, ExportSignal } from "./export/report";
export { EXPORT_FORMATS, JSON_FIELDS, exportKey, exportManifest } from "./export/redact";
export type { ExportFormat, ExportManifest, NeverIncluded, Redaction } from "./export/redact";
export { CSV_COLUMNS, toCsv, toJson } from "./export/serialize";

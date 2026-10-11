export { RESULT_CODES, isResultCode } from "./diagnostics/result-code";
export type { ResultCode } from "./diagnostics/result-code";
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

export const CAPABILITIES = ["contacts", "login", "status", "telemetry", "trace"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Lowest firmware version code that supports each capability. UNVERIFIED except where S-01
 * exercised the command at ver code 13 (see docs/compatibility.md). Telemetry is tagged v5+ in
 * the firmware source; the others carry no tag, so 1 is the least restrictive guess.
 */
export const CAPABILITY_MIN_VER_CODE: Record<Capability, number> = {
  contacts: 1,
  login: 1,
  status: 1,
  telemetry: 5,
  trace: 1,
};

export type CapabilityStatus =
  | { supported: true }
  | { supported: false; reason: "FIRMWARE_TOO_OLD"; firmwareVersion: string };

export type Capabilities = Record<Capability, CapabilityStatus>;

export type ActionAvailability =
  | { enabled: true }
  | { enabled: false; reason: "FIRMWARE_TOO_OLD"; firmwareVersion: string };

export function deriveCapabilities(info: {
  firmwareVerCode: number;
  firmwareVersion: string;
}): Capabilities {
  const entry = (capability: Capability): CapabilityStatus =>
    info.firmwareVerCode >= CAPABILITY_MIN_VER_CODE[capability]
      ? { supported: true }
      : {
          supported: false,
          reason: "FIRMWARE_TOO_OLD",
          firmwareVersion: info.firmwareVersion,
        };
  return {
    contacts: entry("contacts"),
    login: entry("login"),
    status: entry("status"),
    telemetry: entry("telemetry"),
    trace: entry("trace"),
  };
}

/** Whether an action that needs `needs` may be offered; a disabled one carries its reason. */
export function actionAvailability(
  capabilities: Capabilities,
  needs: Capability,
): ActionAvailability {
  const status = capabilities[needs];
  if (status.supported) return { enabled: true };
  return { enabled: false, reason: status.reason, firmwareVersion: status.firmwareVersion };
}

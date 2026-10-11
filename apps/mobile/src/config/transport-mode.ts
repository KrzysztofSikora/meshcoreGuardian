export type TransportMode = "ble" | "fake";

/**
 * Reads `EXPO_PUBLIC_TRANSPORT` (plan D-9). Unset or empty means real BLE; any value other than
 * `ble` or `fake` fails at startup so a mistyped e2e build never runs the real radio.
 */
export function parseTransportMode(raw: string | undefined): TransportMode {
  if (raw === undefined || raw === "" || raw === "ble") return "ble";
  if (raw === "fake") return "fake";
  throw new Error(`Unknown EXPO_PUBLIC_TRANSPORT: ${raw}`);
}

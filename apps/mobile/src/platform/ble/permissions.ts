/**
 * The only runtime permissions the app asks for (FR-01 AC1). The manifest declares
 * `BLUETOOTH_SCAN` with `neverForLocation`, so no location permission is needed on Android 12+.
 */
export const REQUIRED_PERMISSIONS = [
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
] as const;

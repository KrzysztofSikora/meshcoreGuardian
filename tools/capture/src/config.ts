export interface CaptureConfig {
  /** BLE address or advertised name of the companion. */
  companion: string;
  /** Lower-case hex public key prefix of the one remote node the capture may contact (D-6). */
  repeaterPrefix: string;
  /** Empty for an open guest login. Never printed or recorded. */
  guestPassword: string;
}

export class CaptureConfigError extends Error {
  override readonly name = "CaptureConfigError";
}

/** meshcore.js: "password is remainder of frame, max 15 characters". */
const MAX_PASSWORD_LENGTH = 15;
/** Whole bytes, at least one and at most the 32-byte public key. */
const KEY_PREFIX = /^(?:[0-9a-f]{2}){1,32}$/;

/**
 * Reads the capture settings from the environment (`.env`). Refuses to start without a companion
 * and a target node, so a capture never runs or picks a node by accident (TR-23). Error messages
 * never contain the password.
 */
export function readCaptureConfig(env: Record<string, string | undefined>): CaptureConfig {
  const companion = env.HW_COMPANION?.trim() ?? "";
  if (companion === "")
    throw new CaptureConfigError(
      "HW_COMPANION is not set: put the companion's BLE address in .env",
    );
  const repeaterPrefix = env.HW_REPEATER?.trim().toLowerCase() ?? "";
  if (repeaterPrefix === "")
    throw new CaptureConfigError(
      "HW_REPEATER is not set: put the target node's public key prefix in .env",
    );
  if (!KEY_PREFIX.test(repeaterPrefix))
    throw new CaptureConfigError("HW_REPEATER must be a hex public key prefix of 1 to 32 bytes");
  const guestPassword = env.HW_GUEST_PASSWORD ?? "";
  if (guestPassword.length > MAX_PASSWORD_LENGTH)
    throw new CaptureConfigError(
      `HW_GUEST_PASSWORD is longer than ${MAX_PASSWORD_LENGTH} characters`,
    );
  return { companion, repeaterPrefix, guestPassword };
}

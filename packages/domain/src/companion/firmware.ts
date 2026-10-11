/** `major.minor` firmware lines verified on real hardware (S-01). Add a line to add a version. */
export const TESTED_FIRMWARE: readonly string[] = ["1.17"];

const VERSION = /^v?(\d+)\.(\d+)/;

export function isTestedFirmware(firmwareVersion: string): boolean {
  const match = VERSION.exec(firmwareVersion);
  if (!match) return false;
  return TESTED_FIRMWARE.includes(`${match[1]}.${match[2]}`);
}

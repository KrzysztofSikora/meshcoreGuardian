import { cString, requireLength, u8 } from "./bytes";

/**
 * RESP_CODE_DEVICE_INFO, firmware 1.17 (companion_radio/MyMesh.cpp): code, FIRMWARE_VER_CODE,
 * MAX_CONTACTS / 2, MAX_GROUP_CHANNELS, ble_pin (u32, bytes 4–7), build date (12), manufacturer
 * (40), FIRMWARE_VERSION (20), then `repeat` (v9+) and `path_hash_mode` (v10+). meshcore.js reads
 * the PIN as "reserved" and everything after the date as the model. The PIN is never decoded.
 */
export interface DeviceInfo {
  firmwareVerCode: number;
  maxContacts: number;
  maxChannels: number;
  buildDate: string;
  manufacturer: string;
  firmwareVersion: string;
  repeatEnabled?: boolean;
  pathHashMode?: number;
}

const BUILD_DATE_AT = 8;
const MANUFACTURER_AT = 20;
const FIRMWARE_VERSION_AT = 60;
const REPEAT_AT = 80;
const PATH_HASH_MODE_AT = 81;

export function decodeDeviceInfo(frame: Uint8Array): DeviceInfo {
  requireLength(frame, REPEAT_AT);
  const info: DeviceInfo = {
    firmwareVerCode: u8(frame, 1),
    maxContacts: u8(frame, 2) * 2,
    maxChannels: u8(frame, 3),
    buildDate: cString(frame, BUILD_DATE_AT, MANUFACTURER_AT - BUILD_DATE_AT),
    manufacturer: cString(frame, MANUFACTURER_AT, FIRMWARE_VERSION_AT - MANUFACTURER_AT),
    firmwareVersion: cString(frame, FIRMWARE_VERSION_AT, REPEAT_AT - FIRMWARE_VERSION_AT),
  };
  if (frame.length > REPEAT_AT) info.repeatEnabled = u8(frame, REPEAT_AT) !== 0;
  if (frame.length > PATH_HASH_MODE_AT) info.pathHashMode = u8(frame, PATH_HASH_MODE_AT);
  return info;
}

// Companion frames for the capture tests, laid out like firmware 1.17 (companion_radio/MyMesh.cpp),
// little-endian. The adapter's own builders live in its test tree, which tools do not import.

const u32 = (value: number) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  value >>> 24,
];
const text = (value: string, size = value.length) => {
  const bytes = new Array<number>(size).fill(0);
  bytes.splice(0, value.length, ...Array.from(value, (char) => char.charCodeAt(0)));
  return bytes;
};

export const toHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const publicKey = (first: number) =>
  Array.from({ length: 32 }, (_, index) => (first + index) & 0xff);

export const PIN = 0x0012d687; // 1234567: distinctive bytes 87 d6 12 00

export const deviceInfoFrame = (pin = PIN) =>
  Uint8Array.from([
    13,
    10, // FIRMWARE_VER_CODE
    175, // MAX_CONTACTS / 2
    40, // MAX_GROUP_CHANNELS
    ...u32(pin),
    ...text("11 Oct 2026", 12),
    ...text("Heltec V3", 40),
    ...text("v1.17.1", 20),
    1, // repeat
    0, // path_hash_mode
  ]);

/** Latitude 52.229675, longitude 21.012228 as int32 × 1e6. */
const LAT_LON = [...u32(52_229_675), ...u32(21_012_228)];

export const selfInfoFrame = (name = "Operator SP5ABC") =>
  Uint8Array.from([
    5,
    1, // ADV_TYPE_CHAT
    22,
    30,
    ...publicKey(0x10),
    ...LAT_LON,
    1, // multi_acks
    0, // advert_loc_policy
    0, // telemetry modes
    0, // manual_add_contacts
    ...u32(869_525),
    ...u32(250_000),
    11,
    5,
    ...text(name),
  ]);

export interface ContactOptions {
  code?: number;
  key?: number[];
  type?: number;
  name?: string;
}

/** RESP_CODE_CONTACT (148 bytes); `code: 0x8a` gives the new-advert push with the same layout. */
export const contactFrame = ({
  code = 3,
  key = publicKey(0xa0),
  type = 2,
  name = "Room K",
}: ContactOptions = {}) =>
  Uint8Array.from([
    code,
    ...key,
    type,
    0, // flags
    0xff, // out_path_len: no known path
    ...new Array<number>(64).fill(0),
    ...text(name, 32),
    ...u32(1_760_000_000),
    ...LAT_LON,
    ...u32(1_760_000_100),
  ]);

/** CMD_SEND_LOGIN: code 26, the 32-byte public key, then the password as the rest of the frame. */
export const sendLoginFrame = (password: string, key = publicKey(0xa0)) =>
  Uint8Array.from([26, ...key, ...text(password)]);

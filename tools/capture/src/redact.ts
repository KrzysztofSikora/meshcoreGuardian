/**
 * Redaction of recorded frames (plan D-4). It applies only to the copy that is written to the
 * fixture; the frames sent to and received from the companion are never changed.
 *
 * - `SendLogin` (tx): the password after the public key is dropped.
 * - Device info (rx): the BLE pairing PIN (bytes 4–7) is zeroed.
 * - Self info (rx): the companion's position is zeroed and its name becomes `companion`.
 * - Chat contacts (rx contact or new-advert push, type 1): name → `chat-<n>`, position zeroed.
 *   Repeater, room and sensor contacts are public infrastructure adverts and stay verbatim.
 * - RX log push (0x88, D-20): SNR and RSSI are kept, the raw over-the-air packet is dropped. It can
 *   be any packet the companion heard, e.g. a public-channel message or a chat advert.
 */

export type Direction = "tx" | "rx";

export type RedactionLabel =
  | "sendLogin.password"
  | "deviceInfo.blePin"
  | "selfInfo.latLon"
  | "selfInfo.name"
  | "chatContact.name"
  | "chatContact.latLon"
  | "rxLog.packet";

/** Per-run state: the same chat contact gets the same `chat-<n>` in every frame of a run. */
export interface RedactionState {
  chatNumbers: Map<string, number>;
}

export const createRedactionState = (): RedactionState => ({ chatNumbers: new Map() });

export interface Redacted {
  bytes: Uint8Array;
  /** The rules applied to this frame; empty when the frame is recorded as received. */
  redactions: RedactionLabel[];
}

const SEND_LOGIN = 26;
const DEVICE_INFO = 13;
const SELF_INFO = 5;
const CONTACT = 3;
const NEW_ADVERT = 0x8a;
const RX_LOG = 0x88;

const PUBLIC_KEY_END = 33;
const BLE_PIN = [4, 8] as const;
const SELF_LAT_LON = [36, 44] as const;
const SELF_NAME_AT = 58;
const SELF_NAME = "companion";
const CONTACT_TYPE_AT = 33;
const ADV_TYPE_CHAT = 1;
const CONTACT_NAME = [100, 132] as const;
const CONTACT_LAT_LON = [136, 144] as const;
/** Code, SNR × 4 (int8) and RSSI (int8); the raw packet follows. */
const RX_LOG_HEADER = 3;

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

export function redactFrame(dir: Direction, frame: Uint8Array, state: RedactionState): Redacted {
  const code = frame[0];
  if (dir === "tx")
    return code === SEND_LOGIN && frame.length > PUBLIC_KEY_END
      ? { bytes: frame.slice(0, PUBLIC_KEY_END), redactions: ["sendLogin.password"] }
      : { bytes: frame.slice(), redactions: [] };

  const bytes = frame.slice();
  const redactions: RedactionLabel[] = [];
  if (code === DEVICE_INFO && bytes.length >= BLE_PIN[1]) {
    bytes.fill(0, ...BLE_PIN);
    redactions.push("deviceInfo.blePin");
  } else if (code === SELF_INFO) {
    if (bytes.length >= SELF_LAT_LON[1]) {
      bytes.fill(0, ...SELF_LAT_LON);
      redactions.push("selfInfo.latLon");
    }
    if (bytes.length > SELF_NAME_AT) {
      const named = new Uint8Array(SELF_NAME_AT + SELF_NAME.length);
      named.set(bytes.subarray(0, SELF_NAME_AT));
      named.set(ascii(SELF_NAME), SELF_NAME_AT);
      return { bytes: named, redactions: [...redactions, "selfInfo.name"] };
    }
  } else if (code === RX_LOG && bytes.length > RX_LOG_HEADER) {
    return { bytes: bytes.slice(0, RX_LOG_HEADER), redactions: ["rxLog.packet"] };
  } else if (
    (code === CONTACT || code === NEW_ADVERT) &&
    bytes.length >= CONTACT_LAT_LON[1] &&
    bytes[CONTACT_TYPE_AT] === ADV_TYPE_CHAT
  ) {
    const key = Array.from(bytes.subarray(1, PUBLIC_KEY_END)).join(",");
    const number = state.chatNumbers.get(key) ?? state.chatNumbers.size + 1;
    state.chatNumbers.set(key, number);
    bytes.fill(0, ...CONTACT_NAME);
    bytes.set(ascii(`chat-${number}`), CONTACT_NAME[0]);
    bytes.fill(0, ...CONTACT_LAT_LON);
    redactions.push("chatContact.name", "chatContact.latLon");
  }
  return { bytes, redactions };
}

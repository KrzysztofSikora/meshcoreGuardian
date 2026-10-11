export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Lower- or upper-case hex with an even length; callers validate it first. */
export const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

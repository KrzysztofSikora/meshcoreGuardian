// Little-endian readers over Uint8Array. No `Buffer`: the adapter must run under Hermes later.
import { MalformedFrameError } from "./errors";

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const u8 = (bytes: Uint8Array, at: number) => view(bytes).getUint8(at);
export const u16le = (bytes: Uint8Array, at: number) => view(bytes).getUint16(at, true);
export const i16le = (bytes: Uint8Array, at: number) => view(bytes).getInt16(at, true);
export const u32le = (bytes: Uint8Array, at: number) => view(bytes).getUint32(at, true);
export const i32le = (bytes: Uint8Array, at: number) => view(bytes).getInt32(at, true);

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

// meshcore.js decodes strings with TextDecoder too, so this adds no runtime requirement. The
// adapter's lib has no DOM or Node types, hence the cast.
const utf8 = new (
  globalThis as unknown as { TextDecoder: new () => { decode(bytes: Uint8Array): string } }
).TextDecoder();

/** The string in a fixed field of `maxLength` bytes: up to the first zero, or the whole field. */
export function cString(bytes: Uint8Array, start: number, maxLength: number): string {
  const field = bytes.subarray(start, start + maxLength);
  const end = field.indexOf(0);
  return utf8.decode(end === -1 ? field : field.subarray(0, end));
}

export function requireLength(frame: Uint8Array, needed: number): void {
  if (frame.length < needed) throw new MalformedFrameError(frame[0] ?? null, frame.length, needed);
}

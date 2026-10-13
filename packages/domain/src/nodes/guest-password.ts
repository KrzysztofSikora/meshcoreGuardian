/** The firmware keeps the password in a 16-byte C string (UNVERIFIED on hardware, PRD §8). */
export const GUEST_PASSWORD_MAX_BYTES = 15;

export type GuestPasswordResult =
  { ok: true; value: string } | { ok: false; reason: "EMPTY" | "TOO_LONG" };

/** UTF-8 byte length; domain has no `TextEncoder`. Lone surrogates count 3, as the encoder does. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** The password is kept exactly as typed: spaces may be part of it. The login frame is UTF-8. */
export function validateGuestPassword(input: string): GuestPasswordResult {
  if (input.length === 0) return { ok: false, reason: "EMPTY" };
  if (utf8Length(input) > GUEST_PASSWORD_MAX_BYTES) {
    return { ok: false, reason: "TOO_LONG" };
  }
  return { ok: true, value: input };
}

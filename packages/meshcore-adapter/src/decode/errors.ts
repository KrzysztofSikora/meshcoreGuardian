/** A companion frame too short for the layout of its code. `code` is null for an empty frame. */
export class MalformedFrameError extends Error {
  override readonly name = "MalformedFrameError";

  constructor(
    readonly code: number | null,
    readonly length: number,
    readonly needed: number,
  ) {
    super(`Malformed frame (code ${code ?? "none"}): ${length} bytes, needs ${needed}`);
  }
}

import { z } from "zod";

import type { LastCompanion } from "../application/connection/ports";

const schema = z.object({ id: z.string().min(1), name: z.string() });

/** Parses the stored JSON; anything invalid reads as "no companion" (plan D-7). */
export function parseLastCompanion(raw: string | null): LastCompanion | null {
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

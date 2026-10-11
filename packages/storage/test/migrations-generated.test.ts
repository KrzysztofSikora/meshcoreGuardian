import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

// @ts-expect-error the generator is a plain .mjs script without types
import { renderMigrations } from "../scripts/gen-migrations.mjs";

it("keeps src/migrations/generated.ts in step with migrations/*.sql", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const committed = readFileSync(join(here, "../src/migrations/generated.ts"), "utf8");

  expect(committed, "run `pnpm --filter @guardian/storage gen:migrations`").toBe(
    renderMigrations(),
  );
});

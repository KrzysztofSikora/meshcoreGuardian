import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Plan D-13 (PR #22): Guardian is not an admin client (PRD out of scope). Every command the
// client sends to the companion is on this list; adding a write or admin command fails here.
const ALLOWED_COMMANDS = [
  "sendCommandAppStart",
  "sendCommandDeviceQuery",
  "sendCommandGetContacts",
  "sendCommandSendLogin",
  "sendCommandSendStatusReq",
  "sendCommandSendTelemetryReq",
];

describe("MeshClient command surface", () => {
  it("calls only read-only companion commands", () => {
    const source = readFileSync(
      new URL(
        "../../../../../packages/meshcore-adapter/src/client/mesh-client.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const used = [...new Set([...source.matchAll(/\.(sendCommand\w+)\(/g)].map((m) => m[1]!))];
    expect(used.sort()).toEqual([...ALLOWED_COMMANDS].sort());
  });
});

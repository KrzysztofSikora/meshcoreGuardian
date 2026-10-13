import { describe, expect, it } from "vitest";

import { sessionRole } from "./session-role";

describe("sessionRole", () => {
  it.each([
    [0, 0, "guest"],
    [0, 1, "read_only"],
    [0, 2, "read_write"],
    [1, 3, "admin"],
    [0, 3, "admin"],
    [1, 0, "guest"],
  ] as const)("flag %i, ACL %i -> %s", (permissions, aclPermissions, role) => {
    expect(sessionRole({ permissions, aclPermissions })).toBe(role);
  });

  it("uses only the low two ACL bits", () => {
    expect(sessionRole({ permissions: 0, aclPermissions: 0b100 })).toBe("guest");
  });

  it("falls back to the admin flag when the ACL byte is missing", () => {
    expect(sessionRole({ permissions: 1, aclPermissions: null })).toBe("admin");
    expect(sessionRole({ permissions: 0, aclPermissions: null })).toBe("unknown");
  });
});

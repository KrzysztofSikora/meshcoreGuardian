import { describe, expect, it } from "vitest";

import { parseLastCompanion } from "./last-companion";

describe("parseLastCompanion", () => {
  it("reads a stored companion", () => {
    expect(parseLastCompanion('{"id":"AA:BB","name":"MeshCore-x"}')).toEqual({
      id: "AA:BB",
      name: "MeshCore-x",
    });
  });

  it.each([null, "", "not json", "{}", '{"id":"","name":"x"}', '{"id":1,"name":"x"}'])(
    "treats %j as no companion",
    (raw) => {
      expect(parseLastCompanion(raw)).toBeNull();
    },
  );
});

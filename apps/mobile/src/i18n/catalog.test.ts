import { describe, expect, it } from "vitest";

import en from "./en.json";
import { i18n } from "./index";

const screens = ["dashboard", "connect", "node", "run", "settings"] as const;

describe("en catalog", () => {
  it.each(screens)("%s has a non-empty title and placeholder", (screen) => {
    expect(en[screen].title.trim()).not.toBe("");
    expect(en[screen].placeholder.trim()).not.toBe("");
  });

  it.each([
    ["ble", "Transport: BLE"],
    ["fake", "Transport: Fake (development)"],
  ] as const)("interpolates the %s transport label", (mode, expected) => {
    expect(i18n.t("settings.transport", { mode: i18n.t(`transport.${mode}`) })).toBe(expected);
  });
});

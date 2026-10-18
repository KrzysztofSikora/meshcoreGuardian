import { describe, expect, it } from "vitest";

import { InMemorySettingsStore } from "../../platform/fake/in-memory";
import { SettingsController } from "./settings-controller";
import { DEFAULT_SETTINGS } from "./settings";

const reload = async (store: InMemorySettingsStore) => {
  const controller = new SettingsController(store);
  await controller.load();
  return controller;
};

describe("SettingsController", () => {
  it("is loading, with defaults in policy(), until the store has been read", async () => {
    const controller = new SettingsController(new InMemorySettingsStore());
    expect(controller.getState().status).toBe("loading");
    expect(controller.getState().unreadable).toBe(false);
    expect(controller.policy()).toEqual({ attempts: 2, overrideMs: null });
    await controller.load();
    expect(controller.getState()).toMatchObject({ status: "ready", unreadable: false });
  });

  it("reads the store once however often load is called", async () => {
    let reads = 0;
    const store = new InMemorySettingsStore();
    const read = store.read.bind(store);
    store.read = async () => (reads++, read());
    const controller = new SettingsController(store);
    await Promise.all([controller.load(), controller.load()]);
    await controller.load();
    expect(reads).toBe(1);
  });

  it("saves every setting and a new controller reads them back (persistence)", async () => {
    const store = new InMemorySettingsStore();
    const controller = await reload(store);
    expect(await controller.setTimeout("20")).toEqual({ ok: true });
    expect(await controller.setAttempts(3)).toEqual({ ok: true });
    expect(await controller.setRedactKeys(false)).toEqual({ ok: true });

    const again = await reload(store);
    expect(again.getState().settings).toEqual({
      timeoutOverrideS: 20,
      attempts: 3,
      redactKeys: false,
    });
    expect(again.policy()).toEqual({ attempts: 3, overrideMs: 20_000 });
    expect(await again.redactionDefault()).toBe(false);
  });

  it("auto clears the override", async () => {
    const controller = await reload(new InMemorySettingsStore());
    await controller.setTimeout("20");
    expect(await controller.setTimeout("auto")).toEqual({ ok: true });
    expect(controller.policy().overrideMs).toBeNull();
  });

  it.each([0, 4])("rejects attempts %d without writing", async (attempts) => {
    const store = new InMemorySettingsStore();
    const controller = await reload(store);
    const writes = store.writes;

    expect(await controller.setAttempts(attempts)).toMatchObject({ ok: false, reason: "OUT_OF_RANGE" });
    expect(controller.policy().attempts).toBe(DEFAULT_SETTINGS.attempts);
    expect(store.writes).toBe(writes);
  });

  it.each(["4", "61", "12.5", "abc", ""])(
    "rejects timeout %j with the range and keeps the old value in state and store (FR-15 AC3)",
    async (input) => {
      const store = new InMemorySettingsStore();
      const controller = await reload(store);
      await controller.setTimeout("20");
      const before = store.raw;
      const writes = store.writes;
      expect(await controller.setTimeout(input)).toEqual({
        ok: false,
        reason: "OUT_OF_RANGE",
        range: [5, 60],
      });
      expect(controller.policy().overrideMs).toBe(20_000);
      expect(store.raw).toBe(before);
      expect(store.writes).toBe(writes);
    },
  );

  it("keeps the old value and reports a storage error when the write fails", async () => {
    const store = new InMemorySettingsStore();
    const controller = await reload(store);
    store.failWrite = true;
    expect(await controller.setAttempts(3)).toEqual({ ok: false, reason: "STORAGE_ERROR" });
    expect(controller.getState().settings.attempts).toBe(2);
    store.failWrite = false;
    expect(await controller.setAttempts(3)).toEqual({ ok: true });
    expect(controller.getState().settings.attempts).toBe(3);
  });

  it("uses defaults and flags an unreadable value, and a save clears the flag (D-2)", async () => {
    const store = new InMemorySettingsStore("{garbage");
    const controller = await reload(store);
    expect(controller.getState()).toMatchObject({ settings: DEFAULT_SETTINGS, unreadable: true });
    await controller.setAttempts(1);
    expect(controller.getState().unreadable).toBe(false);
    expect((await reload(store)).getState().settings.attempts).toBe(1);
  });

  it("uses defaults and flags it when the read itself fails", async () => {
    const store = new InMemorySettingsStore();
    store.failRead = true;
    const controller = await reload(store);
    expect(controller.getState()).toMatchObject({
      status: "ready",
      settings: DEFAULT_SETTINGS,
      unreadable: true,
    });
    expect(await controller.redactionDefault()).toBe(true);
  });

  it("writes one at a time and in call order, each building on the previous", async () => {
    const store = new InMemorySettingsStore();
    const controller = await reload(store);
    await Promise.all([
      controller.setTimeout("10"),
      controller.setAttempts(1),
      controller.setRedactKeys(false),
    ]);
    expect(controller.getState().settings).toEqual({
      timeoutOverrideS: 10,
      attempts: 1,
      redactKeys: false,
    });
    expect((await reload(store)).getState().settings).toEqual(controller.getState().settings);
  });

  it("redactionDefault waits for the load", async () => {
    const store = new InMemorySettingsStore(
      JSON.stringify({ version: 1, timeoutOverrideS: null, attempts: 2, redactKeys: false }),
    );
    expect(await new SettingsController(store).redactionDefault()).toBe(false);
  });
});

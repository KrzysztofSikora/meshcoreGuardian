import { describe, expect, it } from "vitest";

import { InMemorySecretStore } from "../../platform/fake/in-memory";
import { GuestPasswords } from "./guest-passwords";

const A = "aa".repeat(32);
const B = "bb".repeat(32);
const C = "cc".repeat(32);
const INDEX = "guest-password.index";

function setup() {
  const secrets = new InMemorySecretStore();
  return { secrets, passwords: new GuestPasswords(secrets) };
}

describe("GuestPasswords", () => {
  it("starts with no password state", () => {
    expect(setup().passwords.store.getState()).toEqual({ saved: {}, adminDiscarded: {} });
  });

  it("save writes the value under the node key and lists it in the index (FR-14 AC1)", async () => {
    const { secrets, passwords } = setup();
    expect(await passwords.save(A, "pw-LEAK-CANARY")).toEqual({ ok: true });
    expect(await secrets.get(`guest-password.${A}`)).toBe("pw-LEAK-CANARY");
    expect(JSON.parse((await secrets.get(INDEX))!)).toEqual([A]);
    expect(await passwords.password(A)).toBe("pw-LEAK-CANARY");
    expect(passwords.store.getState().saved[A]).toBe("yes");
  });

  it("saving twice keeps one index entry and the newer value", async () => {
    const { secrets, passwords } = setup();
    await passwords.save(A, "one");
    await passwords.save(A, "two");
    expect(JSON.parse((await secrets.get(INDEX))!)).toEqual([A]);
    expect(await passwords.password(A)).toBe("two");
  });

  it("two concurrent saves are both indexed (D-12)", async () => {
    const { secrets, passwords } = setup();
    await Promise.all([passwords.save(A, "one"), passwords.save(B, "two")]);
    expect(JSON.parse((await secrets.get(INDEX))!).sort()).toEqual([A, B]);
  });

  it("rejects an empty or too long password without touching the store", async () => {
    const { secrets, passwords } = setup();
    expect(await passwords.save(A, "")).toEqual({ ok: false, reason: "EMPTY" });
    expect(await passwords.save(A, "a".repeat(16))).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(secrets.keys()).toEqual([]);
  });

  it("password is empty when none is stored", async () => {
    const { passwords } = setup();
    expect(await passwords.password(A)).toBe("");
  });

  it("remove deletes the key and its index entry, keeping the others (FR-14 AC3)", async () => {
    const { secrets, passwords } = setup();
    await passwords.save(A, "one");
    await passwords.save(B, "two");
    expect(await passwords.remove(A)).toEqual({ ok: true });
    expect(secrets.keys().sort()).toEqual([INDEX, `guest-password.${B}`].sort());
    expect(JSON.parse((await secrets.get(INDEX))!)).toEqual([B]);
    expect(passwords.store.getState().saved[A]).toBe("no");
  });

  it("clearAll leaves no key behind (FR-14 AC3, TR-21)", async () => {
    const { secrets, passwords } = setup();
    await passwords.save(A, "one");
    await passwords.save(B, "two");
    await passwords.save(C, "three");
    await passwords.clearAll();
    expect(secrets.keys()).toEqual([]);
    expect(passwords.store.getState().saved).toEqual({});
    expect(await passwords.password(A)).toBe("");
  });

  it("load reports presence", async () => {
    const { passwords } = setup();
    await passwords.load(A);
    expect(passwords.store.getState().saved[A]).toBe("no");
    await passwords.save(A, "one");
    await passwords.load(A);
    expect(passwords.store.getState().saved[A]).toBe("yes");
  });

  it("storage failures: STORAGE_ERROR, saved=error, password rejects", async () => {
    const { secrets, passwords } = setup();
    secrets.failWith = new Error("keystore");
    expect(await passwords.save(A, "one")).toEqual({ ok: false, reason: "STORAGE_ERROR" });
    expect(await passwords.remove(A)).toEqual({ ok: false });
    await passwords.load(A);
    expect(passwords.store.getState().saved[A]).toBe("error");
    await expect(passwords.password(A)).rejects.toThrow("keystore");
    await expect(passwords.clearAll()).rejects.toThrow("keystore");
  });

  it("a failed operation does not block later ones (D-12)", async () => {
    const { secrets, passwords } = setup();
    secrets.failSetWith = new Error("keystore");
    expect(await passwords.save(A, "one")).toEqual({ ok: false, reason: "STORAGE_ERROR" });
    secrets.failSetWith = null;
    expect(await passwords.save(A, "one")).toEqual({ ok: true });
    expect(await passwords.password(A)).toBe("one");
  });

  it.each(["not json", '{"a":1}', "[1,2]", '["a",1]'])("an unreadable index %s is an error", async (raw) => {
    const { secrets, passwords } = setup();
    await secrets.set(INDEX, raw);
    expect(await passwords.save(A, "one")).toEqual({ ok: false, reason: "STORAGE_ERROR" });
    expect(await passwords.remove(A)).toEqual({ ok: false });
    await expect(passwords.clearAll()).rejects.toThrow();
    expect(secrets.keys()).toEqual([INDEX]);
  });

  it("no state field contains the password", async () => {
    const { passwords } = setup();
    await passwords.save(A, "pw-LEAK-CANARY");
    expect(JSON.stringify(passwords.store.getState())).not.toContain("pw-LEAK-CANARY");
  });

  it("discardAdminPassword removes the password and notes it for the card (PR #22)", async () => {
    const { secrets, passwords } = setup();
    await passwords.save(A, "pw-ADMIN");
    expect(await passwords.discardAdminPassword(A, "pw-ADMIN")).toEqual({ ok: true });
    expect(secrets.keys()).toEqual([INDEX]);
    expect(await passwords.password(A)).toBe("");
    expect(passwords.store.getState().saved[A]).toBe("no");
    expect(passwords.store.getState().adminDiscarded[A]).toBe("removed");
  });

  it("discardAdminPassword leaves a different password saved since the run started", async () => {
    const { passwords } = setup();
    await passwords.save(A, "guest");
    expect(await passwords.discardAdminPassword(A, "pw-ADMIN")).toEqual({ ok: true });
    expect(await passwords.password(A)).toBe("guest");
    expect(passwords.store.getState().saved[A]).toBe("yes");
    expect(passwords.store.getState().adminDiscarded).toEqual({});
  });

  it("discardAdminPassword reports a password it could not remove", async () => {
    const { secrets, passwords } = setup();
    await passwords.save(A, "pw-ADMIN");
    secrets.failWith = new Error("keystore");
    expect(await passwords.discardAdminPassword(A, "pw-ADMIN")).toEqual({ ok: false });
    expect(passwords.store.getState().adminDiscarded[A]).toBe("kept");
  });

  it("saving a new password clears the admin note; clearAll clears all notes", async () => {
    const { passwords } = setup();
    await passwords.save(A, "pw-ADMIN");
    await passwords.discardAdminPassword(A, "pw-ADMIN");
    await passwords.save(A, "guest");
    expect(passwords.store.getState().adminDiscarded).toEqual({});
    await passwords.discardAdminPassword(A, "pw-ADMIN");
    await passwords.clearAll();
    expect(passwords.store.getState().adminDiscarded).toEqual({});
  });
});

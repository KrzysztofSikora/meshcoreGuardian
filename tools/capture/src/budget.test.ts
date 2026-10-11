import { describe, expect, it } from "vitest";

import { FakeClock } from "../test/support/fake-clock";
import { BudgetExceededError, NODE_SPACING_MS, RequestBudget, type BudgetKind } from "./budget";

const NODE = "a0a1a2a3a4a5";
const OTHER = "b0b1b2b3b4b5";

describe("RequestBudget (TR-23)", () => {
  it.each<[BudgetKind, number]>([
    ["handshake", 1],
    ["sync", 1],
    ["login", 2],
    ["status", 2],
    ["telemetry", 2],
  ])("grants %s %i times per run, then refuses", (kind, limit) => {
    const budget = new RequestBudget(new FakeClock());
    for (let index = 0; index < limit; index += 1) budget.take(kind);
    expect(() => budget.take(kind)).toThrow(BudgetExceededError);
    expect(() => budget.take(kind)).toThrow(`at most ${limit} ${kind} per capture run`);
  });

  it("refuses a third login even when spaced a minute apart", () => {
    const clock = new FakeClock();
    const budget = new RequestBudget(clock);
    budget.take("login", NODE);
    clock.advance(NODE_SPACING_MS);
    budget.take("login", NODE);
    clock.advance(NODE_SPACING_MS);
    expect(() => budget.take("login", NODE)).toThrow(new BudgetExceededError("login"));
  });

  it("counts each kind separately", () => {
    const budget = new RequestBudget(new FakeClock());
    budget.take("login");
    budget.take("login");
    expect(budget.take("status")).toBe(0);
  });

  it("does not wait for the first request to a node or for requests without a node", () => {
    const budget = new RequestBudget(new FakeClock());
    expect(budget.take("handshake")).toBe(0);
    expect(budget.take("sync")).toBe(0);
    expect(budget.take("login", NODE)).toBe(0);
  });

  it("waits 30 s for a status sent 30 s after the login to the same node", async () => {
    const clock = new FakeClock(1_000);
    const budget = new RequestBudget(clock);
    await budget.acquire("login", NODE);
    clock.advance(30_000);
    await budget.acquire("status", NODE);
    expect(clock.sleeps).toEqual([30_000]);
    expect(clock.now()).toBe(1_000 + NODE_SPACING_MS);
  });

  it("does not wait for a different node", async () => {
    const clock = new FakeClock();
    const budget = new RequestBudget(clock);
    await budget.acquire("login", NODE);
    clock.advance(1_000);
    await budget.acquire("status", OTHER);
    expect(clock.sleeps).toEqual([]);
  });

  it("does not wait once a minute has passed", () => {
    const clock = new FakeClock();
    const budget = new RequestBudget(clock);
    budget.take("login", NODE);
    clock.advance(NODE_SPACING_MS);
    expect(budget.take("status", NODE)).toBe(0);
    clock.advance(NODE_SPACING_MS + 5_000);
    expect(budget.take("telemetry", NODE)).toBe(0);
  });

  it("spaces from the scheduled send time, not from when the wait was granted", () => {
    const clock = new FakeClock();
    const budget = new RequestBudget(clock);
    budget.take("login", NODE);
    expect(budget.take("status", NODE)).toBe(NODE_SPACING_MS);
    // The status goes out at 60 s, so a telemetry granted at 0 s waits until 120 s.
    expect(budget.take("telemetry", NODE)).toBe(2 * NODE_SPACING_MS);
  });

  it("does not consume spacing when the budget refuses", () => {
    const clock = new FakeClock();
    const budget = new RequestBudget(clock);
    budget.take("handshake");
    expect(() => budget.take("handshake", NODE)).toThrow(BudgetExceededError);
    expect(budget.take("login", NODE)).toBe(0);
  });
});

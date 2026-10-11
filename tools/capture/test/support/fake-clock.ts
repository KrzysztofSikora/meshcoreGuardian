import type { Clock } from "../../src/budget";

/** A clock that only moves when `sleep` or `advance` is called; `sleeps` records every wait. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];

  constructor(private time = 0) {}

  now(): number {
    return this.time;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

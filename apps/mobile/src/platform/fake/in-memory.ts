import type { Unsubscribe } from "@guardian/meshcore-adapter";

import type { AirtimeNoticeStore } from "../../application/diagnostics/ports";
import type {
  AppStatePort,
  LastCompanion,
  LastCompanionStore,
} from "../../application/connection/ports";

export class InMemoryAppState implements AppStatePort {
  private state: "active" | "background" = "active";
  private readonly listeners = new Set<(state: "active" | "background") => void>();

  current(): "active" | "background" {
    return this.state;
  }

  onChange(callback: (state: "active" | "background") => void): Unsubscribe {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  set(state: "active" | "background"): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

export class InMemoryLastCompanionStore implements LastCompanionStore {
  constructor(private value: LastCompanion | null = null) {}

  async load(): Promise<LastCompanion | null> {
    return this.value;
  }

  async save(value: LastCompanion): Promise<void> {
    this.value = value;
  }
}

export class InMemoryAirtimeNoticeStore implements AirtimeNoticeStore {
  constructor(private value = false) {}

  async seen(): Promise<boolean> {
    return this.value;
  }

  async markSeen(): Promise<void> {
    this.value = true;
  }
}

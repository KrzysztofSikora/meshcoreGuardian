import type { SecretStore } from "@guardian/domain";
import type { Unsubscribe } from "@guardian/meshcore-adapter";

import type { SettingsStore } from "../../application/settings/ports";
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

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  /** When set, every call rejects with it (error-path tests). */
  failWith: Error | null = null;
  /** When set, only `set` rejects with it. */
  failSetWith: Error | null = null;

  async get(key: string): Promise<string | null> {
    if (this.failWith !== null) throw this.failWith;
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    if (this.failSetWith !== null) throw this.failSetWith;
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

/** In-memory `SettingsStore` for tests; either call can be made to fail. */
export class InMemorySettingsStore implements SettingsStore {
  failRead = false;
  failWrite = false;
  writes = 0;

  constructor(public raw: string | null = null) {}

  async read(): Promise<string | null> {
    if (this.failRead) throw new Error("storage");
    return this.raw;
  }

  async write(raw: string): Promise<void> {
    if (this.failWrite) throw new Error("storage");
    this.writes += 1;
    this.raw = raw;
  }
}

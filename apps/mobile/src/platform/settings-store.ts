import Storage from "expo-sqlite/kv-store";

import type { SettingsStore } from "../application/settings/ports";

const KEY = "settings";

export class KvSettingsStore implements SettingsStore {
  read(): Promise<string | null> {
    return Storage.getItem(KEY);
  }

  async write(raw: string): Promise<void> {
    await Storage.setItem(KEY, raw);
  }
}

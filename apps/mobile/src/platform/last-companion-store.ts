import Storage from "expo-sqlite/kv-store";

import type { LastCompanion, LastCompanionStore } from "../application/connection/ports";
import { parseLastCompanion } from "./last-companion";

const KEY = "companion.last";

export class KvLastCompanionStore implements LastCompanionStore {
  async load(): Promise<LastCompanion | null> {
    return parseLastCompanion(await Storage.getItem(KEY));
  }

  async save(value: LastCompanion): Promise<void> {
    await Storage.setItem(KEY, JSON.stringify(value));
  }
}

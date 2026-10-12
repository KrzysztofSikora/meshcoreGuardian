import Storage from "expo-sqlite/kv-store";

import type { AirtimeNoticeStore } from "../application/diagnostics/ports";

const KEY = "notice.airtime.seen";

export class KvAirtimeNoticeStore implements AirtimeNoticeStore {
  async seen(): Promise<boolean> {
    return (await Storage.getItem(KEY)) === "1";
  }

  async markSeen(): Promise<void> {
    await Storage.setItem(KEY, "1");
  }
}

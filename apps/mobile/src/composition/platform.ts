import type {
  AppStatePort,
  BlePlatform,
  LastCompanionStore,
} from "../application/connection/ports";
import type { TransportMode } from "../config/transport-mode";
import { SCENARIOS } from "../debug/scenarios";
import { FakeBlePlatform } from "../platform/fake/fake-ble-platform";
import { InMemoryAppState, InMemoryLastCompanionStore } from "../platform/fake/in-memory";

export interface Platform {
  ble: BlePlatform;
  appState: AppStatePort;
  lastCompanion: LastCompanionStore;
  /** Set in fake mode only: the debug route switches its scenario. */
  fake: FakeBlePlatform | null;
}

/**
 * Real Bluetooth, app state and storage in `ble` mode; scripted in-memory doubles in `fake`
 * mode (e2e builds). The native modules are required lazily so a fake build never loads them.
 */
export function createPlatform(mode: TransportMode): Platform {
  if (mode === "fake") {
    const fake = new FakeBlePlatform(SCENARIOS["connect-ok"]);
    return {
      ble: fake,
      appState: new InMemoryAppState(),
      lastCompanion: new InMemoryLastCompanionStore(),
      fake,
    };
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { RnBlePlatform } =
    require("../platform/ble/ble-platform") as typeof import("../platform/ble/ble-platform");
  const { RnAppState } = require("../platform/app-state") as typeof import("../platform/app-state");
  const { KvLastCompanionStore } =
    require("../platform/last-companion-store") as typeof import("../platform/last-companion-store");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    ble: new RnBlePlatform(),
    appState: new RnAppState(),
    lastCompanion: new KvLastCompanionStore(),
    fake: null,
  };
}

import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import { container } from "../../../composition";
import {
  LARGE_SEED_TARGET,
  largeSeedContacts,
  largeSeedRuns,
} from "../../../debug/large-seed";
import { voltageSeedRuns } from "../../../debug/voltage-seed";

/** Room K, the node the fake companion knows (same key as the recorded exchanges). */
const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const SEED_COMPANION = {
  publicKey: "ef".repeat(32),
  name: "Seed companion",
  firmwareVersion: "v1.17.1",
};

const SEEDS = ["voltage-history", "large-history"];

async function seedVoltageHistory(): Promise<string> {
  const repository = await container.runRepository();
  // Opening the link again must not stack a second set of runs.
  if ((await repository.recentForNode(ROOM_K, 1)).length === 0) {
    for (const run of voltageSeedRuns(Date.now(), ROOM_K, SEED_COMPANION)) {
      await repository.save(run);
    }
  }
  return `/node/${ROOM_K}`;
}

/** 200 nodes and 1,000 runs for the performance trace (plan D-8); a second visit adds nothing. */
async function seedLargeHistory(): Promise<string> {
  const startedAt = Date.now();
  const runs = await container.runRepository();
  if ((await runs.recentForNode(LARGE_SEED_TARGET, 1)).length === 0) {
    const nodes = await container.nodeRepository();
    const stored = await nodes.syncOrigin();
    // `complete: false` never marks real nodes missing; the stored origin keeps the sync line.
    await nodes.applySync(largeSeedContacts(startedAt), {
      complete: false,
      now: startedAt,
      origin: stored ?? { companionPublicKey: SEED_COMPANION.publicKey, position: null },
    });
    for (const run of largeSeedRuns(startedAt, SEED_COMPANION)) await runs.save(run);
    await container.nodes.reload();
    await container.runs.refreshLatest();
  }
  if (__DEV__) console.log(`large-history seed took ${Date.now() - startedAt} ms`);
  return "/";
}

/**
 * `guardian://debug/seed/voltage-history` stores six past runs for Room K and opens the node;
 * `large-history` stores the performance data and opens the Dashboard. They work only in the fake
 * build; an unknown name or a BLE build goes to the Dashboard.
 */
export default function SeedRoute() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const [target, setTarget] = useState<string | null>(null);
  const valid = container.platform.fake !== null && SEEDS.includes(name);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    void (async () => {
      let href = "/";
      try {
        href = name === "large-history" ? await seedLargeHistory() : await seedVoltageHistory();
      } catch {
        // Debug aid: show the screen anyway, whatever was stored is what it shows.
        if (name === "voltage-history") href = `/node/${ROOM_K}`;
      }
      if (!cancelled) setTarget(href);
    })();
    return () => {
      cancelled = true;
    };
  }, [valid, name]);

  if (!valid) return <Redirect href="/" />;
  return target === null ? null : <Redirect href={target as "/"} />;
}

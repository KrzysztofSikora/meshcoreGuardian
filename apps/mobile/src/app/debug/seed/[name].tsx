import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import { container } from "../../../composition";
import { voltageSeedRuns } from "../../../debug/voltage-seed";

/** Room K, the node the fake companion knows (same key as the recorded exchanges). */
const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const SEED_COMPANION = {
  publicKey: "ef".repeat(32),
  name: "Seed companion",
  firmwareVersion: "v1.17.1",
};

/**
 * `guardian://debug/seed/voltage-history` stores six past runs for Room K and opens the node. It
 * works only in the fake build; an unknown name or a BLE build goes to the Dashboard.
 */
export default function SeedRoute() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const [ready, setReady] = useState(false);
  const valid = container.platform.fake !== null && name === "voltage-history";

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    void (async () => {
      const repository = await container.runRepository();
      for (const run of voltageSeedRuns(Date.now(), ROOM_K, SEED_COMPANION)) {
        await repository.save(run);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [valid]);

  if (!valid) return <Redirect href="/" />;
  return ready ? <Redirect href={`/node/${ROOM_K}`} /> : null;
}

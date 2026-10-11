import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import { container } from "../../../composition";
import { SCENARIOS, isScenarioName } from "../../../debug/scenarios";

/**
 * `guardian://debug/scenario/<name>` picks the fake scenario for an e2e flow (plan D-14). In a
 * BLE build it does nothing and goes to the Dashboard.
 */
export default function ScenarioRoute() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const [ready, setReady] = useState(false);
  const fake = container.platform.fake;
  const valid = fake !== null && isScenarioName(name);

  useEffect(() => {
    if (fake === null || !isScenarioName(name)) return;
    fake.setScenario(SCENARIOS[name]);
    void container.session.reset().then(() => setReady(true));
  }, [fake, name]);

  if (!valid) return <Redirect href="/" />;
  return ready ? <Redirect href="/connect" /> : null;
}

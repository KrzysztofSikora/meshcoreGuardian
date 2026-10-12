import { useCallback, useSyncExternalStore } from "react";

let tick = Date.now();

/**
 * The time, refreshed every `intervalMs` while `enabled`, so a screen can show a countdown or a
 * relative age. A shared snapshot read through `useSyncExternalStore` keeps render pure.
 */
export function useNow(enabled: boolean, intervalMs: number): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) return () => undefined;
      const refresh = () => {
        tick = Date.now();
        onChange();
      };
      refresh();
      const timer = setInterval(refresh, intervalMs);
      return () => clearInterval(timer);
    },
    [enabled, intervalMs],
  );
  return useSyncExternalStore(subscribe, () => tick);
}

import type { Unsubscribe } from "@guardian/meshcore-adapter";
import { AppState } from "react-native";

import type { AppStatePort } from "../application/connection/ports";

type Mapped = "active" | "background";

function map(state: string): Mapped {
  return state === "active" ? "active" : "background";
}

export class RnAppState implements AppStatePort {
  current(): Mapped {
    return map(AppState.currentState);
  }

  onChange(callback: (state: Mapped) => void): Unsubscribe {
    const subscription = AppState.addEventListener("change", (state) => callback(map(state)));
    return () => subscription.remove();
  }
}

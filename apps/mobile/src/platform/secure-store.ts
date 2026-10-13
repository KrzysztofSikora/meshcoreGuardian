import * as SecureStore from "expo-secure-store";

import type { SecretStore } from "@guardian/domain";

/** Keystore-backed storage. Thin on purpose: all key logic is in `GuestPasswords`. */
export class ExpoSecretStore implements SecretStore {
  get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  set(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value);
  }

  delete(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key);
  }
}

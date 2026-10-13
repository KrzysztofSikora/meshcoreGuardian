/**
 * Keystore-backed key/value storage for secrets (tech-stack: `SecretStore`). `null` means absent.
 * Keys are caller-built; the Expo implementation accepts only `[A-Za-z0-9._-]`.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

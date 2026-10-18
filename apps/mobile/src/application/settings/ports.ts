/** Persistence of the settings value. Both calls reject when storage fails. */
export interface SettingsStore {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
}

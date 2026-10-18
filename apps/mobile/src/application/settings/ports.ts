import type { DataEraser } from "@guardian/domain";

/** Persistence of the settings value. Both calls reject when storage fails. */
export interface SettingsStore {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
}

/** What `DataDeletion` needs (settings D-8 to D-11). */
export interface DeletionPorts {
  eraser: () => Promise<DataEraser>;
  passwords: {
    remove(publicKey: string): Promise<{ ok: boolean }>;
    /** Throws on failure. */
    clearAll(): Promise<void>;
  };
  /** True while a diagnostic run or a contact sync is active. */
  busy: () => boolean;
  /** Re-reads the in-memory copies after rows are gone. */
  refresh: {
    nodes(): Promise<void>;
    runs(): Promise<void>;
    history(publicKey: string | null): void;
  };
}

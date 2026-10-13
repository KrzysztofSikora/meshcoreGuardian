import { validateGuestPassword, type SecretStore } from "@guardian/domain";
import { createStore, type StoreApi } from "zustand/vanilla";

const KEY_PREFIX = "guest-password.";
const INDEX_KEY = `${KEY_PREFIX}index`;

export interface GuestPasswordsState {
  /** Whether a password is stored per node, as last read. Never the password itself. */
  saved: Record<string, "yes" | "no" | "error">;
}

export type SaveResult =
  { ok: true } | { ok: false; reason: "EMPTY" | "TOO_LONG" | "STORAGE_ERROR" };

const keyOf = (publicKey: string) => `${KEY_PREFIX}${publicKey}`;

/**
 * Guest passwords in secure storage, one key per node (plan D-1). An index entry lists every key,
 * because the store cannot list its keys and `clearAll` must leave nothing behind (D-2). Store
 * calls run one at a time so the index is never read-modify-written concurrently (D-12).
 * The password is never put in state, errors or logs.
 */
export class GuestPasswords {
  readonly store: StoreApi<GuestPasswordsState> = createStore<GuestPasswordsState>(() => ({
    saved: {},
  }));
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly secrets: SecretStore) {}

  async load(publicKey: string): Promise<void> {
    let saved: "yes" | "no" | "error";
    try {
      saved = (await this.serial(() => this.secrets.get(keyOf(publicKey)))) === null ? "no" : "yes";
    } catch {
      saved = "error";
    }
    this.mark(publicKey, saved);
  }

  /** The stored password, or "" for the open guest login. Rejects when storage fails (D-7). */
  async password(publicKey: string): Promise<string> {
    return (await this.serial(() => this.secrets.get(keyOf(publicKey)))) ?? "";
  }

  async save(publicKey: string, input: string): Promise<SaveResult> {
    const checked = validateGuestPassword(input);
    if (!checked.ok) return checked;
    try {
      await this.serial(async () => {
        const index = await this.readIndex();
        if (!index.includes(publicKey))
          await this.secrets.set(INDEX_KEY, JSON.stringify([...index, publicKey]));
        await this.secrets.set(keyOf(publicKey), checked.value);
      });
    } catch {
      return { ok: false, reason: "STORAGE_ERROR" };
    }
    this.mark(publicKey, "yes");
    return { ok: true };
  }

  async remove(publicKey: string): Promise<{ ok: boolean }> {
    try {
      await this.serial(async () => {
        const index = await this.readIndex();
        await this.secrets.delete(keyOf(publicKey));
        await this.secrets.set(INDEX_KEY, JSON.stringify(index.filter((k) => k !== publicKey)));
      });
    } catch {
      return { ok: false };
    }
    this.mark(publicKey, "no");
    return { ok: true };
  }

  /** Deletes every stored password and the index. Throws on failure so the caller can report it. */
  async clearAll(): Promise<void> {
    await this.serial(async () => {
      const index = await this.readIndex();
      for (const publicKey of index) await this.secrets.delete(keyOf(publicKey));
      await this.secrets.delete(INDEX_KEY);
    });
    this.store.setState({ saved: {} });
  }

  private mark(publicKey: string, saved: "yes" | "no" | "error"): void {
    this.store.setState((state) => ({ saved: { ...state.saved, [publicKey]: saved } }));
  }

  /** Runs `job` after the previous one; a failed job does not stop later ones. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async readIndex(): Promise<string[]> {
    const raw = await this.secrets.get(INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error("Unreadable guest password index");
    }
    return parsed;
  }
}

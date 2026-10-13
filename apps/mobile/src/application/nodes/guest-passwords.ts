import { validateGuestPassword, type SecretStore } from "@guardian/domain";
import { createStore, type StoreApi } from "zustand/vanilla";

const KEY_PREFIX = "guest-password.";
const INDEX_KEY = `${KEY_PREFIX}index`;

export interface GuestPasswordsState {
  /** Whether a password is stored per node, as last read. Never the password itself. */
  saved: Record<string, "yes" | "no" | "error">;
  /** Nodes whose saved password gave an admin session and was dropped; `kept` if removal failed. */
  adminDiscarded: Record<string, "removed" | "kept">;
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
    adminDiscarded: {},
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
    this.clearAdminNotice(publicKey);
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
      await this.serial(() => this.removeLocked(publicKey));
    } catch {
      return { ok: false };
    }
    this.mark(publicKey, "no");
    return { ok: true };
  }

  /**
   * The password `sent` opened an admin session. Guardian takes only a guest password (PRD
   * out of scope: admin login), so it is removed and the node card says why. A different value
   * saved since the run started is left alone.
   */
  async discardAdminPassword(publicKey: string, sent: string): Promise<{ ok: boolean }> {
    let result: { ok: boolean };
    try {
      const removed = await this.serial(async () => {
        if ((await this.secrets.get(keyOf(publicKey))) !== sent) return false;
        await this.removeLocked(publicKey);
        return true;
      });
      if (!removed) return { ok: true };
      this.mark(publicKey, "no");
      result = { ok: true };
    } catch {
      result = { ok: false };
    }
    this.store.setState((state) => ({
      adminDiscarded: { ...state.adminDiscarded, [publicKey]: result.ok ? "removed" : "kept" },
    }));
    return result;
  }

  /** Deletes every stored password and the index. Throws on failure so the caller can report it. */
  async clearAll(): Promise<void> {
    await this.serial(async () => {
      const index = await this.readIndex();
      for (const publicKey of index) await this.secrets.delete(keyOf(publicKey));
      await this.secrets.delete(INDEX_KEY);
    });
    this.store.setState({ saved: {}, adminDiscarded: {} });
  }

  private async removeLocked(publicKey: string): Promise<void> {
    const index = await this.readIndex();
    await this.secrets.delete(keyOf(publicKey));
    await this.secrets.set(INDEX_KEY, JSON.stringify(index.filter((k) => k !== publicKey)));
  }

  private clearAdminNotice(publicKey: string): void {
    this.store.setState((state) => {
      const { [publicKey]: _gone, ...rest } = state.adminDiscarded;
      return { adminDiscarded: rest };
    });
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

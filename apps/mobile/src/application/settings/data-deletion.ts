import type { DeletionPorts } from "./ports";

export type DeletionResult =
  { ok: true } | { ok: false; reason: "BUSY" | "STORAGE_ERROR" | "SECRET_ERROR" };

/**
 * Deletes stored history on request (FR-15 AC2, FR-14 AC3). Rows go first, in one transaction,
 * then the secrets; both steps are idempotent, so a retry repeats the whole action (D-10).
 * One deletion runs at a time; a second call gets the same result.
 */
export class DataDeletion {
  private inFlight: Promise<DeletionResult> | null = null;

  constructor(private readonly ports: DeletionPorts) {}

  deleteNodeHistory(publicKey: string): Promise<DeletionResult> {
    return this.once(async () => {
      const erased = await this.erase((eraser) => eraser.eraseNodeHistory(publicKey));
      if (!erased) return { ok: false, reason: "STORAGE_ERROR" };
      let removed = false;
      try {
        removed = (await this.ports.passwords.remove(publicKey)).ok;
      } catch {
        removed = false;
      }
      await this.refresh(publicKey);
      return removed ? { ok: true } : { ok: false, reason: "SECRET_ERROR" };
    });
  }

  clearAll(): Promise<DeletionResult> {
    return this.once(async () => {
      const erased = await this.erase((eraser) => eraser.eraseAll());
      if (!erased) return { ok: false, reason: "STORAGE_ERROR" };
      let removed = true;
      try {
        await this.ports.passwords.clearAll();
      } catch {
        removed = false;
      }
      await this.refresh(null);
      return removed ? { ok: true } : { ok: false, reason: "SECRET_ERROR" };
    });
  }

  private once(action: () => Promise<DeletionResult>): Promise<DeletionResult> {
    if (this.inFlight !== null) return this.inFlight;
    if (this.ports.busy()) return Promise.resolve({ ok: false, reason: "BUSY" });
    const running = action().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = running;
    return running;
  }

  private async erase(
    action: (eraser: Awaited<ReturnType<DeletionPorts["eraser"]>>) => Promise<void>,
  ): Promise<boolean> {
    try {
      await action(await this.ports.eraser());
      return true;
    } catch {
      return false;
    }
  }

  /** A failed refresh shows as the controllers' own storage error, not as a failed deletion. */
  private async refresh(publicKey: string | null): Promise<void> {
    this.ports.refresh.history(publicKey);
    await Promise.all([
      this.ports.refresh.nodes().catch(() => undefined),
      this.ports.refresh.runs().catch(() => undefined),
    ]);
  }
}

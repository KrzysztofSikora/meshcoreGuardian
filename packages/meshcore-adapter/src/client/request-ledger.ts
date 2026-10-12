const KEY_PREFIX_HEX = 12;

/**
 * When each node was last sent a remote request, in memory. One ledger outlives every client of
 * a session, so a reconnect cannot bypass the cooldown (plan D-7).
 */
export class RemoteRequestLedger {
  private readonly lastRequest = new Map<string, number>();

  record(publicKey: string, at: number): void {
    this.lastRequest.set(publicKey.slice(0, KEY_PREFIX_HEX).toLowerCase(), at);
  }

  lastAt(publicKey: string): number | null {
    return this.lastRequest.get(publicKey.slice(0, KEY_PREFIX_HEX).toLowerCase()) ?? null;
  }
}

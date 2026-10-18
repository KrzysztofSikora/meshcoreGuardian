/** Deletes stored data on the user's request (settings D-7, D-8). Both methods are idempotent. */
export interface DataEraser {
  /**
   * Removes a node's runs, checks and telemetry samples and clears its user label and role.
   * The node row and its dashboard pin stay. An unknown node is a no-op.
   */
  eraseNodeHistory(publicKey: string): Promise<void>;
  /** Removes every node, run, check, sample and the contact sync origin. */
  eraseAll(): Promise<void>;
}

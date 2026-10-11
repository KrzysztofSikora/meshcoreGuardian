// The adapter compiles without DOM or Node types; React Native, Hermes and Node all provide timers.
// Files that use them reference this file, so the declaration travels with the source (like
// meshcore-js.d.ts). Function declarations merge with the platform's own as overloads.
declare function setTimeout(handler: () => void, timeoutMs?: number): unknown;
declare function clearTimeout(handle: unknown): void;

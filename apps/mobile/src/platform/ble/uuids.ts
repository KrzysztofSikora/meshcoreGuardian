// Nordic UART service of the MeshCore companion (verified in S-01, docs/compatibility.md).
export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** Written by the app: one companion frame per write. */
export const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** Notified by the companion: one companion frame per notification. */
export const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

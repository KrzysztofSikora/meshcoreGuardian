import { i16le, requireLength, toHex, u16le, u32le } from "./bytes";

/**
 * The stats struct repeater and room-server firmware share (`RepeaterStats` / `ServerStats`).
 * Repeaters append rx air time and receive errors, room servers post counters; both stay in
 * `extraHex` until a capture verifies them, together with any encryption padding.
 */
export interface RemoteStats {
  battMilliVolts: number;
  currTxQueueLen: number;
  noiseFloor: number;
  lastRssi: number;
  nPacketsRecv: number;
  nPacketsSent: number;
  totalAirTimeSecs: number;
  totalUpTimeSecs: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  errEvents: number;
  /** SNR in quarter dB, as sent. */
  lastSnrX4: number;
  nDirectDups: number;
  nFloodDups: number;
}

export const STATS_LENGTH = 48;

/** Reads the stats struct at `offset` of `frame`; the rest of the frame becomes `extraHex`. */
export function decodeStats(
  frame: Uint8Array,
  offset: number,
): { stats: RemoteStats; extraHex: string } {
  requireLength(frame, offset + STATS_LENGTH);
  const s = frame.subarray(offset);
  return {
    stats: {
      battMilliVolts: u16le(s, 0),
      currTxQueueLen: u16le(s, 2),
      noiseFloor: i16le(s, 4),
      lastRssi: i16le(s, 6),
      nPacketsRecv: u32le(s, 8),
      nPacketsSent: u32le(s, 12),
      totalAirTimeSecs: u32le(s, 16),
      totalUpTimeSecs: u32le(s, 20),
      nSentFlood: u32le(s, 24),
      nSentDirect: u32le(s, 28),
      nRecvFlood: u32le(s, 32),
      nRecvDirect: u32le(s, 36),
      errEvents: u16le(s, 40),
      lastSnrX4: i16le(s, 42),
      nDirectDups: u16le(s, 44),
      nFloodDups: u16le(s, 46),
    },
    extraHex: toHex(s.subarray(STATS_LENGTH)),
  };
}

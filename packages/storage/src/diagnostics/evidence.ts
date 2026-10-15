import { z } from "zod";

import type { CheckEvidence } from "@guardian/domain";

const lppValue = z.object({
  channel: z.number(),
  type: z.number(),
  value: z.union([
    z.number(),
    z.object({ latitude: z.number(), longitude: z.number(), altitude: z.number() }),
  ]),
});

export const evidenceSchema: z.ZodType<CheckEvidence> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("login"),
    permissions: z.number(),
    aclPermissions: z.number().nullable(),
    firmwareLevel: z.number().nullable(),
    passwordSent: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("status"),
    battMilliVolts: z.number(),
    currTxQueueLen: z.number(),
    noiseFloor: z.number(),
    lastRssi: z.number(),
    nPacketsRecv: z.number(),
    nPacketsSent: z.number(),
    totalAirTimeSecs: z.number(),
    totalUpTimeSecs: z.number(),
    nSentFlood: z.number(),
    nSentDirect: z.number(),
    nRecvFlood: z.number(),
    nRecvDirect: z.number(),
    errEvents: z.number(),
    lastSnrX4: z.number(),
    nDirectDups: z.number(),
    nFloodDups: z.number(),
  }),
  z.object({ kind: z.literal("telemetry"), values: z.array(lppValue), lppHex: z.string() }),
  z.object({
    kind: z.literal("malformed"),
    code: z.number(),
    length: z.number(),
    hex: z.string(),
  }),
  z.object({ kind: z.literal("rejected"), code: z.number().nullable() }),
]);

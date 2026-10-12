import {
  nearestRepeaters,
  type Node,
  type RankedRepeater,
  type SyncOrigin,
} from "@guardian/domain";

import { lastHeardText, nameText, type Text } from "./presenter";

/** A compass word is a catalog key, so a distance line carries it as a nested `Text`. */
export interface NearestText {
  key: string;
  params?: Record<string, string | number | Text>;
}

export interface CandidateModel {
  publicKey: string;
  name: Text;
  path: Text;
  position: NearestText;
  lastHeard: Text;
}

export type NearestCardModel =
  | { kind: "empty"; text: Text; syncHint: Text }
  | { kind: "found"; nearest: CandidateModel; others: CandidateModel[]; asOf: Text | null };

/** Metric, rounded to what an advertised position can honestly claim (plan D-7). */
export function formatDistance(metres: number): string {
  if (metres < 1000) {
    const rounded = Math.round(metres / 10) * 10;
    return rounded >= 1000 ? "1 km" : `${rounded} m`;
  }
  if (metres < 10_000) {
    const tenths = Math.round(metres / 100) / 10;
    return tenths >= 10 ? "10 km" : `${tenths.toFixed(1)} km`;
  }
  return `${Math.round(metres / 1000)} km`;
}

function pathText(hops: number | null): Text {
  if (hops === null) return { key: "nearest.path.unknown" };
  return hops === 0
    ? { key: "nearest.path.direct" }
    : { key: "nearest.path.hops", params: { count: hops } };
}

function positionText(ranked: RankedRepeater, companionKnown: boolean): NearestText {
  if (!companionKnown) return { key: "nearest.position.companionNotSet" };
  if (ranked.distanceM === null) return { key: "nearest.position.notAdvertised" };
  const distance = formatDistance(ranked.distanceM);
  return ranked.direction === null
    ? { key: "nearest.position.noDirection", params: { distance } }
    : {
        key: "nearest.position.distance",
        params: { distance, direction: { key: `nearest.compass.${ranked.direction}` } },
      };
}

/**
 * The Dashboard's "Nearest repeater" card: a pure function of stored contacts and the sync origin,
 * so it never costs a radio request. Every value is "as of the last contact sync" (FR-21 AC4).
 */
export function nearestCard(
  nodes: readonly Node[],
  origin: SyncOrigin | null,
  formatTime: (ms: number) => string,
): NearestCardModel {
  const companion = origin?.position ?? null;
  const { nearest, others } = nearestRepeaters(nodes, companion, origin?.companionPublicKey ?? null);
  if (nearest === null) {
    return {
      kind: "empty",
      text: { key: "nearest.empty" },
      syncHint: { key: "nearest.syncHint" },
    };
  }
  const model = (ranked: RankedRepeater): CandidateModel => ({
    publicKey: ranked.node.publicKey,
    name: nameText(ranked.node),
    path: pathText(ranked.hops),
    position: positionText(ranked, companion !== null),
    lastHeard: lastHeardText(ranked.node, formatTime),
  });
  return {
    kind: "found",
    nearest: model(nearest),
    others: others.map(model),
    asOf:
      origin === null
        ? null
        : { key: "nearest.asOf", params: { time: formatTime(nearest.node.syncedAt) } },
  };
}

import { compassPoint, distanceMeters, initialBearing } from "../geo/geo";
import type { CompassPoint, GeoPoint } from "../geo/geo";
import { effectiveRole } from "./node";
import type { Node } from "./node";

export const OTHER_NEARBY_COUNT = 5;

export interface RankedRepeater {
  node: Node;
  /** Last known hop count from the companion at the last sync; `null` = path unknown. */
  hops: number | null;
  /** Metres between the companion and the node's advertised position; `null` if either is missing. */
  distanceM: number | null;
  /** `null` when the distance is unknown or zero. */
  direction: CompassPoint | null;
}

function byNullLast(a: number | null, b: number | null, sign: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return sign * (a - b);
}

/**
 * Contact repeaters, best first: fewest known hops, then shortest distance from the companion,
 * then most recently heard, then public key. Unknown values sort last. `companionKey` restricts the
 * list to the nodes whose path came from that companion, because hops from another companion say
 * nothing about this one (plan-review 1); a partial sync from the same companion keeps the rest.
 */
export function rankRepeaters(
  nodes: readonly Node[],
  companion: GeoPoint | null,
  companionKey: string | null = null,
): RankedRepeater[] {
  return nodes
    .filter(
      (n) =>
        n.inContacts &&
        effectiveRole(n) === "repeater" &&
        (companionKey === null || n.pathCompanionKey === companionKey),
    )
    .map((node): RankedRepeater => {
      const distanceM =
        companion !== null && node.position !== null
          ? distanceMeters(companion, node.position)
          : null;
      const direction =
        companion !== null && node.position !== null && distanceM !== null && distanceM > 0
          ? compassPoint(initialBearing(companion, node.position))
          : null;
      return { node, hops: node.pathHops, distanceM, direction };
    })
    .sort(
      (a, b) =>
        byNullLast(a.hops, b.hops, 1) ||
        byNullLast(a.distanceM, b.distanceM, 1) ||
        byNullLast(a.node.lastHeardAt, b.node.lastHeardAt, -1) ||
        (a.node.publicKey < b.node.publicKey ? -1 : a.node.publicKey > b.node.publicKey ? 1 : 0),
    );
}

export function nearestRepeaters(
  nodes: readonly Node[],
  companion: GeoPoint | null,
  companionKey: string | null = null,
  others: number = OTHER_NEARBY_COUNT,
): { nearest: RankedRepeater | null; others: RankedRepeater[] } {
  const ranked = rankRepeaters(nodes, companion, companionKey);
  return { nearest: ranked[0] ?? null, others: ranked.slice(1, 1 + others) };
}

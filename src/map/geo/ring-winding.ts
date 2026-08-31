/**
 * Ring orientation and closure for GeoJSON polygons.
 *
 * This module exists because of a split in who validates what. Mongo's
 * `2dsphere` index — which `map-places.data.ts` documents as validation
 * infrastructure that happens to also be an index — rejects an unclosed or
 * self-intersecting ring at insert. It says nothing about WINDING: a reversed
 * exterior ring stores silently and reads back exactly as authored.
 *
 * RFC 7946 §3.1.6: "A linear ring MUST follow the right-hand rule with respect
 * to the area it bounds, i.e., exterior rings are counterclockwise, and holes
 * are clockwise." The wire serves stored geometry verbatim, so the ring has to
 * be conformant BEFORE it is stored — which is why this runs in the importer
 * rather than in the projection. Normalising on read would put the rule in the
 * hot path of every request to correct a mistake made once.
 *
 * The reason it matters is not pedantry about the spec. The client's polygon
 * overlay wants the OPPOSITE direction and its own docs warn that a wrongly
 * wound ring may "draw abnormally or not receive events" — a zone that renders
 * but cannot be tapped. That reversal belongs in one tested client adapter,
 * against a wire direction it can rely on.
 *
 * Every position here is `[lng, lat]` — GeoJSON order, x then y — so the
 * shoelace sum below is the ordinary planar one with no axis juggling.
 */

import type { LinearRing } from "./geojson.types";

/**
 * Twice the signed planar area of a ring. Positive is counter-clockwise.
 *
 * Planar rather than spherical on purpose: the only thing read from it is the
 * SIGN, and the `cos(lat)` distortion that makes a planar area wrong over
 * degrees is a positive scale factor, so it cannot flip one. A campus fits in
 * a few hundred metres either way, where the difference is not measurable at
 * all.
 *
 * Returns 0 for a ring with fewer than three positions, so a degenerate row
 * falls through the callers below untouched instead of throwing. A ring that
 * short is a data problem for the importer's own guards to name, not something
 * to crash an orientation check.
 */
export function signedArea(ring: LinearRing): number {
  if (ring.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum;
}

/** Whether the last position repeats the first, which is what "closed" means. */
export function isClosedRing(ring: LinearRing): boolean {
  if (ring.length < 2) return false;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * Closes a ring by repeating its first position, or returns it unchanged.
 *
 * A ring too short to close is returned as-is rather than padded: repeating the
 * single position of a one-point ring would manufacture a valid-looking
 * two-point ring out of broken input, which is worse than passing the breakage
 * along to the guard whose job is to name it.
 */
export function closeRing(ring: LinearRing): LinearRing {
  if (ring.length < 2 || isClosedRing(ring)) return ring;
  return [...ring, ring[0]!];
}

/**
 * Returns the ring closed and wound in `direction`, reversing only if needed.
 *
 * "Only if needed" is load-bearing for the importer's change detection: a
 * conformant ring must come back byte-identical, or every re-import would
 * rewrite every polygon and `updatedAt` would stop meaning anything.
 */
export function rewindRing(
  ring: LinearRing,
  direction: "ccw" | "cw",
): LinearRing {
  const closed = closeRing(ring);
  const area = signedArea(closed);
  // Zero means degenerate — no orientation to correct, and reversing would
  // churn the document for nothing.
  if (area === 0) return closed;

  const isCcw = area > 0;
  const wantsCcw = direction === "ccw";
  return isCcw === wantsCcw ? closed : [...closed].reverse();
}

/**
 * Normalises a GeoJSON Polygon's `coordinates` to RFC 7946: the exterior ring
 * counter-clockwise, every interior ring (hole) clockwise.
 *
 * The exterior is `rings[0]` by the spec's own positional convention — the one
 * place this codebase accepts a positional index, because the format defines it
 * and reordering it would produce a different, still-valid polygon rather than
 * an error.
 */
export function rewindPolygon(rings: LinearRing[]): LinearRing[] {
  return rings.map((ring, index) => rewindRing(ring, index === 0 ? "ccw" : "cw"));
}

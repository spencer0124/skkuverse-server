/**
 * The RFC 7946 geometry vocabulary, shared by storage and the wire.
 *
 * These are the only geometry shapes in the system, and they are deliberately
 * the SAME objects in Mongo and in the response. A place's geometry is authored
 * as GeoJSON in the ops sheet, stored as GeoJSON, and served as GeoJSON — one
 * object passed through untouched, with no converter anywhere on the server.
 *
 * That is the whole point. The classic failure here is an axis swap, which
 * "never throws" — swapped Seoul coordinates simply land in the Yellow Sea and
 * the map lies quietly. A swap can only be introduced AT a conversion, so the
 * defence is to have none rather than to guard one. It also means an
 * off-the-shelf GeoJSON validator can be pointed at either end.
 *
 * Coordinates are `[longitude, latitude]` — RFC 7946 §3.1.1, "precisely in that
 * order" — in WGS 84, the only CRS the spec allows since alternatives were
 * removed in 2016.
 *
 * Note what is NOT here: a circle, and an image overlay. Neither is expressible
 * in RFC 7946, and the three libraries that pretend otherwise disagree with
 * each other about how. When those overlays ship they get their own union arms
 * in `map-overlay.types.ts` with named `{ lat, lng }` fields, and this file
 * stays exactly the spec.
 */

/** One GeoJSON position, `[lng, lat]`. */
export type Position = [number, number];

/**
 * One GeoJSON linear ring. Closed — the last position repeats the first — and
 * wound per RFC 7946 §3.1.6, which `geo/ring-winding.ts` enforces on write.
 */
export type LinearRing = Position[];

export interface GeoJsonPoint {
  type: "Point";
  coordinates: Position;
}

export interface GeoJsonLineString {
  type: "LineString";
  coordinates: Position[];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  /** `coordinates[0]` is the exterior ring; the rest are holes. */
  coordinates: LinearRing[];
}

/**
 * Every geometry this map stores or serves.
 *
 * A discriminated union on `type` rather than a loose `{ type: string }`, so a
 * producer that forgets a case is a compile error rather than a document that
 * silently fails to draw.
 */
export type OverlayGeometry = GeoJsonPoint | GeoJsonLineString | GeoJsonPolygon;

/**
 * Is this stored value a geometry this build can actually draw?
 *
 * Structural, not merely a `type` check, and that distinction is the whole
 * point. `coordinates: [null]` on a Polygon satisfies "is an array" and then
 * dereferences `null.length` two calls later, inside a route with no try/catch
 * — one hand-edited document 500s the whole collection for every client.
 *
 * The Mongo tier is content, so the answer to a bad row is to skip and count
 * it, never to throw: one unusable document must not take the other sixty with
 * it. The `2dsphere` index refuses most of this at insert, but it is not a
 * guarantee we can lean on — a fresh `_dev` database imported before the server
 * has ever booted has no index at all.
 */
export function isDrawableGeometry(value: unknown): value is OverlayGeometry {
  if (typeof value !== "object" || value === null) return false;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };

  if (type === "Point") return isPosition(coordinates);
  if (type === "LineString") {
    return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPosition);
  }
  if (type === "Polygon") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length > 0 &&
      // Four, not three: a triangle is three corners plus the repeat that
      // closes it. Fewer cannot bound an area, and `rewindRing` would read a
      // signed area of zero and leave it as-is rather than reporting anything.
      coordinates.every(
        (ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition),
      )
    );
  }
  return false;
}

function isPosition(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

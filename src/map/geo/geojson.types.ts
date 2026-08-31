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

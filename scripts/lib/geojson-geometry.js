"use strict";

/**
 * Reads an authored GeoJSON geometry object and validates its structure.
 *
 * WHY A PASTED GeoJSON OBJECT rather than named `lat`/`lng` arrays. The
 * existing coordinate form exists because a booth's position is HAND-TYPED off
 * a survey, and a named pair is the shape you cannot transpose by accident. A
 * fifty-vertex ring is not hand-typed — it comes out of geojson.io, QGIS or
 * Google My Maps, and every one of them emits RFC 7946. Requiring the author to
 * transcribe that into named pairs is precisely where a swap would get
 * introduced. So: **a coordinate you type is named; a coordinate you paste is
 * GeoJSON**, and the pasted form is stored and served without ever being
 * touched.
 *
 * WHAT THIS DOES NOT DO: winding. RFC 7946 wants exterior rings
 * counter-clockwise and holes clockwise, but that normalisation lives in
 * `src/map/geo/ring-winding.ts` and runs at projection time. Two reasons. This
 * directory is CommonJS and excluded from tsconfig, so doing it here would mean
 * a second copy of the shoelace — one rule, two implementations that can
 * disagree. And hand-editing Mongo is a blessed ops workflow, so an
 * import-time-only fix would miss exactly the edits most likely to be wrong.
 * Rejecting a paste for an orientation the author cannot see would also make a
 * perfectly good sheet unimportable for an invisible reason.
 *
 * Mongo's 2dsphere index is the backstop for the rest: it refuses an unclosed
 * ring, a self-intersecting loop and a hole outside its exterior at insert.
 * The checks here exist so the failure names a file and a line instead of
 * arriving as a driver error halfway through a write.
 */

const SUPPORTED = ["Polygon", "LineString"];

/** A finite `[lng, lat]` pair, with the same cheap swap detector `asPlace` uses. */
function checkPosition(pos, where, errors) {
  if (!Array.isArray(pos) || pos.length < 2) {
    errors.push(`${where} must be a [lng, lat] pair`);
    return;
  }
  const [lng, lat] = pos;
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    errors.push(`${where}[0] ${lng} is not a longitude`);
  }
  // SKKU's longitude is 126, which is outside latitude's ±90 range — so a
  // wholesale [lat, lng] paste trips this on the first vertex rather than
  // drawing a shape across the Yellow Sea.
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) {
    errors.push(`${where}[1] ${lat} is not a latitude — lat and lng may be swapped`);
  }
}

function checkRing(ring, where, errors) {
  if (!Array.isArray(ring)) {
    errors.push(`${where} must be an array of positions`);
    return;
  }
  // Four, not three: a triangle is three corners plus the repeat that closes it.
  if (ring.length < 4) {
    errors.push(`${where} has ${ring.length} positions — a closed ring needs at least 4`);
    return;
  }
  ring.forEach((pos, i) => checkPosition(pos, `${where}[${i}]`, errors));

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    Array.isArray(first) &&
    Array.isArray(last) &&
    (first[0] !== last[0] || first[1] !== last[1])
  ) {
    errors.push(`${where} is not closed — repeat the first position as the last`);
  }
}

/**
 * @param {unknown} value  the authored `geometry` object
 * @param {string} where   path for error messages
 * @param {string[]} errors accumulator, appended to rather than thrown
 * @returns {object|null}  the geometry to store, or null if unusable
 */
function asGeometry(value, where, errors) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${where} must be a GeoJSON geometry object`);
    return null;
  }

  const { type, coordinates } = value;
  // One spelling per thing: a Point is authored as named lat/lng, so accepting
  // it here too would give a booth two ways to say the same sentence.
  if (type === "Point") {
    errors.push(`${where}.type "Point" is not authored here — write named lat/lng instead`);
    return null;
  }
  if (!SUPPORTED.includes(type)) {
    errors.push(`${where}.type must be one of [${SUPPORTED.join(", ")}]`);
    return null;
  }
  if (!Array.isArray(coordinates)) {
    errors.push(`${where}.coordinates must be an array`);
    return null;
  }

  const before = errors.length;
  if (type === "LineString") {
    if (coordinates.length < 2) {
      errors.push(`${where}.coordinates must have at least 2 positions`);
    }
    coordinates.forEach((pos, i) =>
      checkPosition(pos, `${where}.coordinates[${i}]`, errors),
    );
  } else {
    if (coordinates.length === 0) {
      errors.push(`${where}.coordinates must have at least one ring`);
    }
    coordinates.forEach((ring, i) =>
      checkRing(ring, `${where}.coordinates[${i}]`, errors),
    );
  }

  if (errors.length > before) return null;
  // Stored exactly as authored. No copy, no reshape, nothing to get wrong.
  return { type, coordinates };
}

module.exports = { asGeometry, SUPPORTED };

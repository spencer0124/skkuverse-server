/**
 * Shared CSV → PlaceDoc reader for the event map (skkuverse#13, Phase 1).
 *
 * Pure and clock-free: no DB, no `new Date()`, no process.exit. It returns
 * { docs, errors } and the caller decides what to do — which is what lets the
 * importer abort on any error and lets the test suite run it on fixtures.
 *
 * Parsing is csv-parse (RFC 4180), NOT a hand-rolled split(","). The committed
 * ops sheet already has five rows whose note_ko contains a comma inside a
 * quoted field, and the sheet is edited in Excel/Sheets, which also brings
 * doubled quotes ("" → ") and a UTF-8 BOM. `bom: true` matters more than it
 * looks: without it the first header key parses as "U+FEFF then placeId" and every
 * single row fails for a missing id, pointing the blame at the data instead of
 * the encoding.
 *
 * Contract: docs/reference/eventmap-api.md §4.1 / §10.
 */
const { parse } = require("csv-parse/sync");

/** The ops sheet's columns. Order is irrelevant (csv-parse maps by name); the set is not. */
const EXPECTED_COLUMNS = [
  "placeId",
  "campus",
  "name_ko",
  "zone",
  "lat",
  "lng",
  "note_ko",
];

/** Closed union, mirroring PlaceDoc.campus. An unexpected value is a data bug. */
const VALID_CAMPUSES = ["hssc", "nsc"];

/**
 * Plain decimal only: optional minus, digits, optional dot-digits.
 *
 * This is stricter than Number() on purpose. Number() accepts "1e5", "0x10" and
 * "Infinity", none of which a surveyor ever types, and every one of which would
 * land somewhere plausible-looking. Rejecting them here means the only way to
 * write a coordinate is the way the sheet already writes them.
 */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Reads one coordinate cell.
 *
 * The blank check is not defensive padding — `Number("") === 0`, so a guard
 * built on isNaN() alone admits an empty cell as 0, the pair lands at [0,0],
 * and 2dsphere happily accepts it because the Gulf of Guinea is a real place.
 * The row must be rejected instead (skkuverse#12).
 *
 * parseFloat is never used: parseFloat("37,29") === 37, silently wrong for a
 * locale that writes decimals with a comma.
 */
function readCoordinate(raw, label, limit) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed === "") {
    return { ok: false, reason: `${label} is blank` };
  }
  if (!DECIMAL_RE.test(trimmed)) {
    return {
      ok: false,
      reason: `${label} is not a plain decimal number (got "${trimmed}")`,
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `${label} is not finite (got "${trimmed}")` };
  }
  if (value < -limit || value > limit) {
    return {
      ok: false,
      reason: `${label} ${value} is outside ±${limit} — lat and lng may be swapped`,
    };
  }
  return { ok: true, value };
}

function readText(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * @param {string} text        raw CSV file contents
 * @param {{layerSetId: string}} options
 * @returns {{docs: object[], errors: {line: number|null, placeId: string|null, message: string}[]}}
 *
 * `docs` carry every PlaceDoc field except `updatedAt` — the caller stamps that,
 * so this module stays clock-free and its output is comparable across runs.
 */
function parsePlacesCsv(text, options) {
  const layerSetId = options && options.layerSetId;
  if (!layerSetId) {
    return {
      docs: [],
      errors: [{ line: null, placeId: null, message: "layerSetId is required" }],
    };
  }

  let rows;
  try {
    rows = parse(text, {
      columns: true, // header row → object keys (the option csv-parse 7.0.2 hardens)
      bom: true, // spreadsheet exports prepend a UTF-8 BOM
      skip_empty_lines: true,
      trim: false, // values stay verbatim; each field is trimmed deliberately below
    });
  } catch (err) {
    // csv-parse THROWS on structural damage (e.g. a row with the wrong number
    // of columns → CSV_RECORD_INCONSISTENT_COLUMNS). Catch it, or the operator
    // gets a stack trace instead of a sentence telling them which line to fix.
    return {
      docs: [],
      errors: [
        {
          line: typeof err.lines === "number" ? err.lines : null,
          placeId: null,
          message: `CSV could not be parsed (${err.code || "unknown"}): ${err.message}`,
        },
      ],
    };
  }

  if (rows.length === 0) {
    return {
      docs: [],
      errors: [{ line: null, placeId: null, message: "CSV has a header but no rows" }],
    };
  }

  // Header check before any row work. A renamed or dropped column would
  // otherwise degrade into 62 identical per-row rejections, which reads as
  // "the data is broken" when the truth is "the sheet's shape changed".
  const actual = Object.keys(rows[0]);
  const missing = EXPECTED_COLUMNS.filter((c) => !actual.includes(c));
  const unexpected = actual.filter((c) => !EXPECTED_COLUMNS.includes(c));
  if (missing.length > 0 || unexpected.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing [${missing.join(", ")}]`);
    if (unexpected.length > 0) parts.push(`unexpected [${unexpected.join(", ")}]`);
    return {
      docs: [],
      errors: [
        {
          line: 1,
          placeId: null,
          message: `header does not match the ops sheet — ${parts.join(", ")}. Expected exactly [${EXPECTED_COLUMNS.join(", ")}]`,
        },
      ],
    };
  }

  const docs = [];
  const errors = [];
  const seen = new Map();

  rows.forEach((row, index) => {
    // +2: one for the header row, one to make it 1-based like an editor shows.
    const line = index + 2;
    const placeId = readText(row.placeId);
    const reject = (message) => errors.push({ line, placeId: placeId || null, message });

    if (placeId === "") {
      reject("placeId is blank");
      return;
    }
    if (seen.has(placeId)) {
      reject(`duplicate placeId — already used on line ${seen.get(placeId)}`);
      return;
    }
    seen.set(placeId, line);

    const campus = readText(row.campus);
    if (!VALID_CAMPUSES.includes(campus)) {
      reject(`campus must be one of [${VALID_CAMPUSES.join(", ")}] (got "${campus}")`);
      return;
    }

    const nameKo = readText(row.name_ko);
    if (nameKo === "") {
      reject("name_ko is blank");
      return;
    }

    const lat = readCoordinate(row.lat, "lat", 90);
    if (!lat.ok) {
      reject(lat.reason);
      return;
    }
    const lng = readCoordinate(row.lng, "lng", 180);
    if (!lng.ok) {
      reject(lng.reason);
      return;
    }

    // An empty zone is legitimate, not an error — nsc-barrierfree has none.
    const zone = readText(row.zone);
    const noteKo = readText(row.note_ko);

    docs.push({
      _id: placeId,
      layerSetId,
      campus,
      name: { ko: nameKo },
      // GeoJSON is [lng, lat]. This is the only place in the import path where
      // the two orders meet, and it is why the wire format later carries named
      // lat/lng fields instead of a positional pair (ADR 0004 invariant 3).
      location: { type: "Point", coordinates: [lng.value, lat.value] },
      zone: zone === "" ? null : zone,
      tags: [],
      lifecycle: "active",
      // Ops provenance ("범례 6. …", survey method). Not user-facing, so it goes
      // to extensions rather than earning a column in the wire payload.
      ...(noteKo === "" ? {} : { extensions: { noteKo } }),
    });
  });

  return { docs, errors };
}

module.exports = {
  EXPECTED_COLUMNS,
  VALID_CAMPUSES,
  parsePlacesCsv,
};

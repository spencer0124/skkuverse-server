/**
 * The authoring reader: one JSON file → one `MapPlaceDoc` per place.
 *
 * Replaces a CSV reader for plots and a JSON reader for sessions. Those existed
 * because a place and its occupancy were two documents; they are one now, so the
 * join that used to happen at import time does not happen at all.
 *
 * JSON rather than a spreadsheet, for the reason the old sessions reader already
 * gave: `hours`, `fields` and `actions` are nested, and a CSV cell cannot carry
 * a list without inventing a separator to get wrong later.
 *
 * PURE. No Mongo, no clock, no filesystem — text in, documents out — so the
 * committed sheet can be parsed in a unit test and every rule pinned there.
 *
 * ## Failure posture
 *
 * Accumulates every error rather than throwing at the first, and names the exact
 * path in each. The caller aborts wholesale on a non-empty list: a partial
 * festival import is worse than none, because the missing half is invisible on
 * the map and nobody knows to look for it.
 */

const ACTION_TYPES = ["content", "route", "webview", "external", "miniapp"];
const STYLES = ["primary", "secondary"];

/**
 * Keys that were meaningful in the OLD two-file format and would now be read as
 * nothing at all.
 *
 * Rejected by name rather than ignored. `days: [1, 2]` is the exact key the old
 * importer expanded into `-d1` and `-d2` documents — the duplication this format
 * exists to remove — so a pasted old-format file has to fail loudly rather than
 * import each place once and silently lose its second day.
 */
const { asGeometry } = require("./geojson-geometry");

const RETIRED_PLACE_KEYS = {
  days: "a place is one document now — write one entry in `hours` per day",
  slot: "no longer read; the windows in `hours` say when a place is open",
  placeId: "coordinates live on the place itself — use `lat`/`lng`",
  startOffsetMin: "windows are absolute instants — use `hours[].startAt`",
  endOffsetMin: "windows are absolute instants — use `hours[].endAt`",
  hoursLabel: "derived from `hours` by the client",
  lifecycle: "a cancelled place is deleted from this file, not flagged",
  tenantId: "use `subtitle` if the occupant should be visible",
  tenantName: "use `subtitle` if the occupant should be visible",
  tenantKind: "use `subtitle` if the occupant should be visible",
};

const RETIRED_ROOT_KEYS = {
  timeBase: "windows are always absolute now — write ISO instants in `hours`",
  sessions: "rename to `places`; one entry per place, not per day",
};

function asI18n(value, where, errors) {
  // A bare string is Korean shorthand. The sheet is hand-typed and overwhelmingly
  // Korean-only, so requiring {"ko": …} on every one of ~200 strings would be
  // noise around the few that actually carry a translation.
  if (typeof value === "string") {
    if (value.trim() === "") {
      errors.push(`${where} must not be blank`);
      return null;
    }
    return { ko: value };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${where} must be a string or an {ko, en?, zh?} object`);
    return null;
  }
  if (typeof value.ko !== "string" || value.ko.trim() === "") {
    errors.push(`${where}.ko must be a non-empty string`);
    return null;
  }
  const out = { ko: value.ko };
  for (const lang of ["en", "zh"]) {
    if (value[lang] === undefined || value[lang] === null) continue;
    if (typeof value[lang] !== "string") {
      errors.push(`${where}.${lang} must be a string`);
      return null;
    }
    if (value[lang].trim() !== "") out[lang] = value[lang];
  }
  return out;
}

function asInstant(value, where, errors) {
  if (typeof value !== "string") {
    errors.push(`${where} must be an ISO instant string`);
    return null;
  }
  const date = new Date(value);
  // An Invalid Date round-trips into Mongo happily, and every comparison against
  // it is false — so the place would simply never be open, with nothing anywhere
  // saying why.
  if (!Number.isFinite(date.getTime())) {
    errors.push(`${where} "${value}" is not a parseable instant`);
    return null;
  }
  return date;
}

function asHours(value, where, errors) {
  // Absent means always open. That is the ONE meaning of an empty list, and the
  // reason a half-bounded window is refused below: allowing one open end would
  // give `hours` a second way to say "no limit", which is exactly the ambiguity
  // that used to force a `status` field to exist.
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${where} must be an array of {startAt, endAt}`);
    return [];
  }
  const out = [];
  value.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (raw.startAt === undefined || raw.endAt === undefined) {
      errors.push(
        `${at} needs both startAt and endAt — a half-bounded window is not expressible; write two windows, or none`,
      );
      return;
    }
    const startAt = asInstant(raw.startAt, `${at}.startAt`, errors);
    const endAt = asInstant(raw.endAt, `${at}.endAt`, errors);
    if (!startAt || !endAt) return;
    if (endAt <= startAt) {
      errors.push(`${at}.endAt is at or before its startAt`);
      return;
    }
    out.push({ startAt, endAt });
  });
  return out;
}

function asFields(value, where, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${where} must be an array of {label, value}`);
    return [];
  }
  const out = [];
  value.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const label = asI18n(raw.label, `${at}.label`, errors);
    const fieldValue = asI18n(raw.value, `${at}.value`, errors);
    if (label && fieldValue) out.push({ label, value: fieldValue });
  });
  return out;
}

function asActions(value, where, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${where} must be an array of actions`);
    return [];
  }
  const out = [];
  value.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      errors.push(`${at}.id must be a non-empty string`);
      return;
    }
    if (!ACTION_TYPES.includes(raw.actionType)) {
      errors.push(`${at}.actionType must be one of [${ACTION_TYPES.join(", ")}]`);
      return;
    }
    if (typeof raw.actionValue !== "string" || raw.actionValue.trim() === "") {
      errors.push(`${at}.actionValue must be a non-empty string`);
      return;
    }
    if (raw.style !== undefined && !STYLES.includes(raw.style)) {
      errors.push(`${at}.style must be one of [${STYLES.join(", ")}]`);
      return;
    }
    const label = asI18n(raw.label, `${at}.label`, errors);
    if (!label) return;

    const action = {
      id: raw.id,
      label,
      actionType: raw.actionType,
      // Left EXACTLY as authored, root-relative included. Resolving a webview
      // path needs WEBVIEW_ORIGIN, which is server config; an importer holding
      // its own copy would disagree with the server the moment it changed, and
      // the stored value would be a stale absolute URL nobody could see was
      // wrong. `map-event-markers.data.ts` resolves at serve time instead.
      actionValue: raw.actionValue,
    };
    if (raw.style) action.style = raw.style;
    out.push(action);
  });
  return out;
}

function asPlace(raw, i, ctx, errors) {
  // Anything this place contributes lands here first, so a place with ANY
  // problem can be excluded whole. Pushing straight into `errors` and returning
  // a document anyway made the importer's "N valid, M rejected" line count
  // messages against places — two errors on one row read as two rejected rows.
  const own = [];
  const where = `places[${i}]`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${where} must be an object`);
    return null;
  }

  for (const [key, hint] of Object.entries(RETIRED_PLACE_KEYS)) {
    if (raw[key] !== undefined) {
      own.push(`${where}.${key} is no longer read — ${hint}`);
    }
  }

  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    errors.push(`${where}.id must be a non-empty string`);
    return null;
  }
  errors.push(...own);
  own.length = 0;
  const where2 = `places[${i}] ("${raw.id}")`;

  if (typeof raw.category !== "string" || raw.category.trim() === "") {
    own.push(`${where2}.category must be a non-empty string`);
  }
  if (typeof raw.order !== "number" || !Number.isFinite(raw.order)) {
    // No default. A silent 0 would make the list order arbitrary while looking
    // deliberate, and every real sheet has this column already.
    own.push(`${where2}.order must be a finite number`);
  }

  // A place carries EITHER named lat/lng (a hand-typed point) OR a pasted
  // GeoJSON `geometry` (a ring or a line). Never both, and never neither —
  // see scripts/lib/geojson-geometry.js for why the two forms exist.
  const hasPoint = raw.lat !== undefined || raw.lng !== undefined;
  const hasGeometry = raw.geometry !== undefined && raw.geometry !== null;

  let location = null;
  if (hasPoint && hasGeometry) {
    own.push(
      `${where2} has both lat/lng and geometry — a place has one position`,
    );
  } else if (hasGeometry) {
    location = asGeometry(raw.geometry, `${where2}.geometry`, own);
  } else {
    const lat = raw.lat;
    const lng = raw.lng;
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) {
      // Cheap swap detector, and it works here for the same reason it works in the
      // camera validator: SKKU's longitude (126) is outside latitude's ±90 range.
      own.push(`${where2}.lat ${lat} is not a latitude — lat and lng may be swapped`);
    } else if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) {
      own.push(`${where2}.lng ${lng} is not a longitude`);
    } else {
      location = { type: "Point", coordinates: [lng, lat] };
    }
  }

  const title = asI18n(raw.title, `${where2}.title`, own);
  const subtitle =
    raw.subtitle === undefined || raw.subtitle === null
      ? null
      : asI18n(raw.subtitle, `${where2}.subtitle`, own);
  const hours = asHours(raw.hours, `${where2}.hours`, own);
  const fields = asFields(raw.fields, `${where2}.fields`, own);
  const actions = asActions(raw.actions, `${where2}.actions`, own);

  // ONE verdict per place. A document that failed any rule is not returned, so
  // `docs.length` is the number of places that would actually be written.
  errors.push(...own);
  if (own.length > 0 || !title || !location) return null;

  return {
    // Prefixed, so two festivals can hold a `bar-01` without colliding and an id
    // read off a deep link says which festival it belongs to.
    _id: `${ctx.layerSetId}-${raw.id}`,
    layerSetId: ctx.layerSetId,
    campus: ctx.campus,
    category: raw.category,
    location,
    title,
    subtitle,
    hours,
    fields,
    actions,
    order: raw.order,
    updatedAt: new Date(),
  };
}

/**
 * @param {string} text     the file's contents
 * @param {{layerSetId: string}} opts  the layer set being imported
 * @returns {{docs: object[], errors: string[]}}
 */
function parsePlacesFile(text, { layerSetId }) {
  const errors = [];
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    return { docs: [], errors: [`file is not valid JSON: ${err.message}`] };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { docs: [], errors: ["file must be a JSON object"] };
  }

  for (const [key, hint] of Object.entries(RETIRED_ROOT_KEYS)) {
    if (root[key] !== undefined) errors.push(`${key} is no longer read — ${hint}`);
  }

  if (root.layerSetId !== layerSetId) {
    errors.push(
      `file layerSetId "${root.layerSetId}" does not match the "${layerSetId}" being imported`,
    );
  }
  if (root.campus !== "hssc" && root.campus !== "nsc") {
    errors.push(`campus must be "hssc" or "nsc"`);
  }
  if (!Array.isArray(root.places) || root.places.length === 0) {
    errors.push("places must be a non-empty array");
    return { docs: [], errors };
  }

  const ctx = { layerSetId, campus: root.campus };
  const docs = [];
  const seen = new Set();
  root.places.forEach((raw, i) => {
    const doc = asPlace(raw, i, ctx, errors);
    if (!doc) return;
    if (seen.has(doc._id)) {
      errors.push(`places[${i}] has a duplicate id "${raw.id}"`);
      return;
    }
    seen.add(doc._id);
    docs.push(doc);
  });

  return { docs, errors };
}

module.exports = { parsePlacesFile };

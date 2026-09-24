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

// Shared with the campus sheet, so the two authoring files cannot disagree
// about what a valid ring is.
const { asGeometry } = require("./geojson-geometry");

/**
 * Keys that were meaningful in the OLD two-file format and would now be read as
 * nothing at all.
 *
 * Rejected by name rather than ignored. `days: [1, 2]` is the exact key the old
 * importer expanded into `-d1` and `-d2` documents — the duplication this format
 * exists to remove — so a pasted old-format file has to fail loudly rather than
 * import each place once and silently lose its second day.
 */
const RETIRED_PLACE_KEYS = {
  days: "a place is one document now — write one entry in `hours` per day",
  slot: "no longer read; the windows in `hours` say when a place is open",
  placeId:
    "coordinates live on the place itself — use `lat`/`lng`, or `geometry` for a ring or a line",
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
    // A mini-app target is checked here rather than left to the serve-time drop:
    // a typo'd id would import clean and ship a sheet with the button silently
    // missing, which nobody would know to look for.
    if (raw.actionType === "miniapp") {
      const target = parseMiniAppTarget(raw.actionValue);
      if (!target) {
        errors.push(`${at}.actionValue must be a mini-app target: <miniAppId>[/path]`);
        return;
      }
      if (!REGISTERED_MINIAPP_IDS.includes(target.id)) {
        errors.push(`${at}.actionValue names an unregistered mini app "${target.id}"`);
        return;
      }
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

// --- Place detail -----------------------------------------------------------
//
// The sheet body a tapped place opens (`src/map/map-place-detail.types.ts`).
// STRICT, unlike the rest of this reader's tolerance for unknown keys: every
// level refuses a key it does not know, because a misspelled optional key —
// `captoin` — would otherwise import clean and render as nothing, which is the
// silent failure the whole detail exists to end.
//
// The constants below are COPIES of server values, because scripts/ is plain
// CommonJS and cannot import TypeScript. A parity test in
// __tests__/nest/map/map-places-import.test.ts pins each to its source, and the
// serve path re-checks every URL anyway, so drift can only ever drop a block.

/** src/map/map-place-detail.types.ts PLACE_KINDS — CLOSED on the client. */
const PLACE_KINDS = ["pub", "booth", "promo", "foodTruck", "goods", "facility", "stage", "etc"];
/** src/map/map-place-detail.types.ts PLACE_BLOCK_TYPES. */
const BLOCK_TYPES = ["text", "list", "table", "image", "notice"];
/** src/map/map-place-detail.types.ts PLACE_DETAIL_ACTION_TYPES. */
const DETAIL_ACTION_TYPES = ["instagram", "link"];
/** src/infra/origins.ts MEDIA_ORIGIN. */
const MEDIA_ORIGIN = "https://media.skkuverse.com";

const WHITESPACE_RE = /\s/;
/** src/map/map-event-overlays.data.ts ABSOLUTE_HTTPS_RE. */
const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/][^\s]*$/;
const INSTAGRAM_HOSTS = ["instagram.com", "www.instagram.com"];
/** Paths that are Instagram's own pages, not a username. */
const INSTAGRAM_RESERVED_PATHS = ["accounts", "direct", "explore", "p", "reel", "reels", "stories"];
const INSTAGRAM_MEDIA_KINDS = ["p", "reel", "reels"];

/** Copy of src/infra/media-url.ts `isMediaUrl` — see there for each rule. */
function isMediaUrl(value) {
  if (typeof value !== "string" || value === "" || WHITESPACE_RE.test(value)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== MEDIA_ORIGIN) return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.pathname === "/" || url.hash !== "") return false;
  return true;
}

/** Copy of src/map/map-event-details.data.ts `isAbsoluteHttpsUrl`. */
function isAbsoluteHttpsUrl(value) {
  return typeof value === "string" && !WHITESPACE_RE.test(value) && ABSOLUTE_HTTPS_RE.test(value);
}

/** src/infra/webview-url.ts ROOT_RELATIVE_PATH_RE. */
const ROOT_RELATIVE_PATH_RE = /^\/(?![/\\])[^\s]*$/;
/** src/miniapps/miniapp-target.ts TARGET_RE. */
const MINIAPP_TARGET_RE = /^([a-z0-9-]+)(\/.*)?$/;

/** Copy of src/miniapps/miniapp-target.ts `parseMiniAppTarget` — see there for the grammar. */
function parseMiniAppTarget(value) {
  if (typeof value !== "string" || value === "" || WHITESPACE_RE.test(value)) return null;
  const match = MINIAPP_TARGET_RE.exec(value);
  if (!match) return null;
  const [, id, path] = match;
  if (!id) return null;
  if (path === undefined) return { id };
  if (!ROOT_RELATIVE_PATH_RE.test(path)) return null;
  return { id, path };
}

/**
 * The ids the server registers, read from the registry's own file rather than
 * copied: this is data that changes whenever a mini app is added, and a copy
 * would go stale silently. The importer runs from a checkout, where src/ exists.
 */
const REGISTERED_MINIAPP_IDS = require("../../src/miniapps/index.json").miniApps.map((m) => m.id);

/** The path segments of an https Instagram URL, or null for anything else. */
function instagramSegments(value) {
  if (!isAbsoluteHttpsUrl(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!INSTAGRAM_HOSTS.includes(url.hostname.toLowerCase())) return null;
  return url.pathname.split("/").filter(Boolean);
}

/**
 * Copy of src/map/map-event-details.data.ts `isInstagramProfileUrl`.
 *
 * Mirrors what the app will actually open (skkuverse-app `instagram.ts`): a
 * profile is exactly one path segment that is not one of Instagram's own pages.
 * Anything else is accepted by a looser check and then does NOTHING on tap.
 */
function isInstagramProfileUrl(value) {
  const segments = instagramSegments(value);
  return (
    segments !== null &&
    segments.length === 1 &&
    !INSTAGRAM_RESERVED_PATHS.includes(segments[0].toLowerCase())
  );
}

/** Copy of src/map/map-event-details.data.ts `isInstagramPostUrl`: `/p|reel|reels/<code>`. */
function isInstagramPostUrl(value) {
  const segments = instagramSegments(value);
  return (
    segments !== null &&
    segments.length === 2 &&
    INSTAGRAM_MEDIA_KINDS.includes(segments[0].toLowerCase())
  );
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(raw, allowed, at, errors) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      errors.push(`${at}.${key} is not a known key — expected one of [${allowed.join(", ")}]`);
    }
  }
}

/** Absent or null is `null` — never `undefined`, which would re-diff on every import. */
function asOptionalI18n(value, where, errors) {
  if (value === undefined || value === null) return null;
  return asI18n(value, where, errors);
}

function asUniqueId(value, at, seen, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${at}.id must be a non-empty string`);
    return null;
  }
  if (seen.has(value)) {
    errors.push(`${at}.id "${value}" is used twice in this place`);
    return null;
  }
  seen.add(value);
  return value;
}

/** A non-empty array, each element read by `read`. */
function asNonEmptyList(value, where, errors, read) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where} must be a non-empty array`);
    return [];
  }
  return value.map((raw, i) => read(raw, `${where}[${i}]`));
}

const BLOCK_KEYS = {
  text: ["type", "id", "title", "body"],
  list: ["type", "id", "title", "items"],
  table: ["type", "id", "title", "rows"],
  image: ["type", "id", "title", "url", "caption"],
  notice: ["type", "id", "title", "items"],
};

function asListItem(raw, at, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${at} must be an object`);
    return null;
  }
  rejectUnknownKeys(raw, ["emoji", "title", "description"], at, errors);
  let emoji = null;
  if (raw.emoji !== undefined && raw.emoji !== null) {
    if (typeof raw.emoji !== "string" || raw.emoji.trim() === "") {
      errors.push(`${at}.emoji must be a non-empty string or null`);
    } else {
      emoji = raw.emoji;
    }
  }
  return {
    emoji,
    title: asI18n(raw.title, `${at}.title`, errors),
    description: asOptionalI18n(raw.description, `${at}.description`, errors),
  };
}

function asTableRow(raw, at, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${at} must be an object`);
    return null;
  }
  rejectUnknownKeys(raw, ["label", "value"], at, errors);
  return {
    label: asI18n(raw.label, `${at}.label`, errors),
    value: asI18n(raw.value, `${at}.value`, errors),
  };
}

function asBlock(raw, at, seenIds, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${at} must be an object`);
    return null;
  }
  if (!BLOCK_TYPES.includes(raw.type)) {
    errors.push(`${at}.type must be one of [${BLOCK_TYPES.join(", ")}]`);
    return null;
  }
  rejectUnknownKeys(raw, BLOCK_KEYS[raw.type], at, errors);
  const id = asUniqueId(raw.id, at, seenIds, errors);
  const title = asOptionalI18n(raw.title, `${at}.title`, errors);
  const head = { type: raw.type, id, title };

  switch (raw.type) {
    case "text":
      return { ...head, body: asI18n(raw.body, `${at}.body`, errors) };
    case "list":
      return {
        ...head,
        items: asNonEmptyList(raw.items, `${at}.items`, errors, (item, where) =>
          asListItem(item, where, errors),
        ),
      };
    case "table":
      return {
        ...head,
        rows: asNonEmptyList(raw.rows, `${at}.rows`, errors, (row, where) =>
          asTableRow(row, where, errors),
        ),
      };
    case "image":
      if (!isMediaUrl(raw.url)) {
        errors.push(
          `${at}.url must be an object on ${MEDIA_ORIGIN}/… — upload it to the media bucket first`,
        );
      }
      return {
        ...head,
        url: raw.url,
        caption: asOptionalI18n(raw.caption, `${at}.caption`, errors),
      };
    case "notice":
      return {
        ...head,
        items: asNonEmptyList(raw.items, `${at}.items`, errors, (item, where) =>
          asI18n(item, where, errors),
        ),
      };
  }
}

function asDetailAction(raw, at, seenIds, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${at} must be an object`);
    return null;
  }
  if (!DETAIL_ACTION_TYPES.includes(raw.type)) {
    errors.push(`${at}.type must be one of [${DETAIL_ACTION_TYPES.join(", ")}]`);
    return null;
  }
  const id = asUniqueId(raw.id, at, seenIds, errors);
  const label = asI18n(raw.label, `${at}.label`, errors);

  if (raw.type === "instagram") {
    rejectUnknownKeys(raw, ["type", "id", "label", "profileUrl", "postUrl"], at, errors);
    if (!isInstagramProfileUrl(raw.profileUrl)) {
      errors.push(`${at}.profileUrl must be https://www.instagram.com/<username>`);
    }
    const postUrl = raw.postUrl === undefined || raw.postUrl === null ? null : raw.postUrl;
    if (postUrl !== null && !isInstagramPostUrl(postUrl)) {
      errors.push(`${at}.postUrl must be https://www.instagram.com/p/<code> (or /reel/), or null`);
    }
    return { type: "instagram", id, label, profileUrl: raw.profileUrl, postUrl };
  }

  rejectUnknownKeys(raw, ["type", "id", "label", "url"], at, errors);
  // The app opens a link as `external`, so it has to be a complete https URL.
  if (!isAbsoluteHttpsUrl(raw.url)) {
    errors.push(`${at}.url must be an absolute https:// URL`);
  }
  return { type: "link", id, label, url: raw.url };
}

function asDetail(raw, where, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  rejectUnknownKeys(
    raw,
    ["kind", "org", "isUnion", "locationLabel", "actions", "blocks"],
    where,
    errors,
  );

  // No default. The kind drives the list's filters, and a silent "etc" would
  // file a truck under nothing while looking deliberate.
  if (!PLACE_KINDS.includes(raw.kind)) {
    errors.push(`${where}.kind must be one of [${PLACE_KINDS.join(", ")}]`);
  }
  let isUnion = false;
  if (raw.isUnion !== undefined) {
    if (typeof raw.isUnion !== "boolean") {
      errors.push(`${where}.isUnion must be true or false`);
    } else {
      isUnion = raw.isUnion;
    }
  }

  let actions = [];
  if (raw.actions !== undefined && raw.actions !== null) {
    if (!Array.isArray(raw.actions)) {
      errors.push(`${where}.actions must be an array`);
    } else {
      const seen = new Set();
      actions = raw.actions.map((a, i) => asDetailAction(a, `${where}.actions[${i}]`, seen, errors));
      // The app follows the first one only; a second is authored and never shown.
      if (actions.filter((a) => a && a.type === "instagram").length > 1) {
        errors.push(`${where}.actions has more than one instagram action — the sheet shows one`);
      }
    }
  }

  let blocks = [];
  if (raw.blocks !== undefined && raw.blocks !== null) {
    if (!Array.isArray(raw.blocks)) {
      errors.push(`${where}.blocks must be an array`);
    } else {
      const seen = new Set();
      blocks = raw.blocks.map((b, i) => asBlock(b, `${where}.blocks[${i}]`, seen, errors));
    }
  }

  return {
    kind: raw.kind,
    org: asOptionalI18n(raw.org, `${where}.org`, errors),
    isUnion,
    locationLabel: asOptionalI18n(raw.locationLabel, `${where}.locationLabel`, errors),
    actions,
    blocks,
  };
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
    // Two INDEPENDENT checks, not a chain. A wholesale transposition makes both
    // wrong, and this file's whole posture is that one run names everything —
    // an `else if` would hand the author one message, then the other on a
    // second round trip.
    const latOk =
      typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90;
    const lngOk =
      typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
    if (!latOk) {
      // Cheap swap detector, and it works here for the same reason it works in the
      // camera validator: SKKU's longitude (126) is outside latitude's ±90 range.
      own.push(`${where2}.lat ${lat} is not a latitude — lat and lng may be swapped`);
    }
    if (!lngOk) {
      own.push(`${where2}.lng ${lng} is not a longitude`);
    }
    if (latOk && lngOk) {
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
  const detail =
    raw.detail === undefined || raw.detail === null
      ? null
      : asDetail(raw.detail, `${where2}.detail`, own);

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
    detail,
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

module.exports = {
  parsePlacesFile,
  // Exported for the parity test only — each is a copy of a server value.
  PLACE_KINDS,
  BLOCK_TYPES,
  DETAIL_ACTION_TYPES,
  MEDIA_ORIGIN,
  isMediaUrl,
  isAbsoluteHttpsUrl,
  isInstagramProfileUrl,
  isInstagramPostUrl,
  parseMiniAppTarget,
};

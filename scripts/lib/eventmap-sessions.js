/**
 * Shared JSON → SessionDoc reader for the event map (skkuverse#16).
 *
 * The sibling of eventmap-csv.js, and deliberately the same shape: pure, no DB,
 * no process.exit, returns { docs, errors } and lets the caller decide. That is
 * what lets the importer abort on any error and the test suite run it on
 * fixtures.
 *
 * ## Why JSON and not CSV
 *
 * Places are flat — an id, a name, two coordinates — so a spreadsheet is the
 * right editor and csv-parse is the right reader. A session is not flat:
 * `actions[]`, `media.images[]`, `fields{}` and every I18n value are nested, and
 * a spreadsheet can only carry those as embedded JSON inside a cell, which is
 * strictly worse than JSON all the way down. Sheet-based authoring for sessions
 * is what skkuverse#19's dashboard is for; until then this file is the ops
 * surface and `--dry-run` is the safety net.
 *
 * ## Time base
 *
 * `timeBase` is a file-level, mutually exclusive choice:
 *
 *   "absolute"  startAt/endAt are ISO instants. What real festival content uses.
 *   "relative"  startOffsetMin/endOffsetMin are minutes from `now`. What a
 *               verification run uses, so that open, upcoming and closed all
 *               appear at once and a status boundary is crossed while someone
 *               is watching.
 *
 * A relative file is NOT idempotent — every run resolves to different instants,
 * so every run rewrites `updatedAt` and mints a new snapshot version. That is
 * correct (it genuinely is a new dataset each time) but it is the one place this
 * importer cannot honour the diff discipline eventmap-db.js's upsertPlaces
 * describes, so the importer says so out loud.
 *
 * ## `days` expansion
 *
 * A SessionDoc is ONE occupancy interval, so a 양일주점 running both nights is
 * two documents, not one with a two-day span. Authoring it twice is how the
 * duplication gets out of sync, so the file says `"days": [1, 2]` and this
 * module expands it, suffixing `-d1` / `-d2` onto the id. Omit `days` for an
 * always-on facility.
 *
 * Contract: docs/reference/eventmap-api.md §4.2 / §10.
 */

/** Mirrors SessionDoc.lifecycle. */
const VALID_LIFECYCLES = ["draft", "published", "hidden", "cancelled"];

/** Mirrors SessionAction.actionType. */
const VALID_ACTION_TYPES = ["content", "route", "webview", "external", "miniapp"];

/** Mirrors SessionAction.style. */
const VALID_ACTION_STYLES = ["primary", "secondary"];

/** Mirrors PlaceDoc.campus / SessionDoc.campus. */
const VALID_CAMPUSES = ["hssc", "nsc"];

const VALID_TIME_BASES = ["absolute", "relative"];

/** The three the wire format carries. A fourth would need infra/i18n.ts too. */
const I18N_KEYS = ["ko", "en", "zh"];

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

/**
 * Civil date in Asia/Seoul, which is what `SessionDoc.date` stores.
 *
 * en-CA formats as YYYY-MM-DD. Copied from seed-eventmap-demo.js rather than
 * imported: that script is a `_dev`-only demo seeder and this is the production
 * import path, so a require() between them would couple the two lifetimes for
 * six lines.
 */
function seoulDate(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * A bare string is shorthand for `{ ko: ... }`, matching how parsePlacesCsv
 * turns `name_ko` into `name`. An object is taken as-is after checking that at
 * least one supported language carries text — a value blank in every language
 * is what the materializer's `hasAnyText` rejects later, and catching it here
 * names the row instead of the snapshot.
 */
function readI18n(raw, label) {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return { ok: false, reason: `${label} is blank` };
    return { ok: true, value: { ko: text } };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, reason: `${label} must be a string or an object` };
  }
  const unexpected = Object.keys(raw).filter((k) => !I18N_KEYS.includes(k));
  if (unexpected.length > 0) {
    return {
      ok: false,
      reason: `${label} has unsupported language key(s) [${unexpected.join(", ")}] — expected any of [${I18N_KEYS.join(", ")}]`,
    };
  }
  const value = {};
  for (const key of I18N_KEYS) {
    const text = readText(raw[key]);
    if (text !== "") value[key] = text;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, reason: `${label} is blank in every language` };
  }
  return { ok: true, value };
}

/** Integer only. Number() would accept "1e5" and 1.5; neither is a minute offset. */
function readInteger(raw, label) {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, reason: `${label} must be an integer (got ${JSON.stringify(raw)})` };
  }
  return { ok: true, value: raw };
}

/**
 * Strict ISO instant.
 *
 * Date.parse accepts a great deal that is not an instant — "2026", "Sep 16" and
 * a bare "2026-09-16" (which it reads as UTC midnight, silently shifting a
 * Seoul-authored time by nine hours). The regex forces an explicit offset or Z,
 * so the author has to state the timezone rather than inherit whichever one the
 * parser guesses.
 */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function readInstant(raw, label) {
  const text = readText(raw);
  if (text === "") return { ok: false, reason: `${label} is blank` };
  if (!ISO_INSTANT_RE.test(text)) {
    return {
      ok: false,
      reason: `${label} must be an ISO instant with an explicit offset or Z (got "${text}")`,
    };
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: `${label} is not a real date (got "${text}")` };
  }
  return { ok: true, value: new Date(ms) };
}

/** YYYY-MM-DD, used for the explicit `date` an absolute-time session carries. */
const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readActions(raw, reject) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    reject("actions must be an array");
    return null;
  }

  const out = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const action = raw[i];
    const where = `actions[${i}]`;
    if (!isPlainObject(action)) {
      reject(`${where} must be an object`);
      return null;
    }

    const id = readText(action.id);
    if (id === "") {
      reject(`${where}.id is blank`);
      return null;
    }
    if (seen.has(id)) {
      reject(`${where}.id "${id}" is used twice in the same session`);
      return null;
    }
    seen.add(id);

    const label = readI18n(action.label, `${where}.label`);
    if (!label.ok) {
      reject(label.reason);
      return null;
    }

    const actionType = readText(action.actionType);
    if (!VALID_ACTION_TYPES.includes(actionType)) {
      reject(
        `${where}.actionType must be one of [${VALID_ACTION_TYPES.join(", ")}] (got "${actionType}")`,
      );
      return null;
    }

    // `content` is prose and may contain whitespace and newlines; every other
    // type is a value an opener or the router receives, so the shape check is
    // the materializer's isValidActionValue and it is deliberately NOT repeated
    // here — a value this file cannot judge is judged there, where the origin
    // constant lives. What is checked here is only that something was written.
    const actionValue =
      actionType === "content"
        ? typeof action.actionValue === "string"
          ? action.actionValue
          : ""
        : readText(action.actionValue);
    if (actionValue.trim() === "") {
      reject(`${where}.actionValue is blank`);
      return null;
    }

    // A `webview` value SHOULD be root-relative: the materializer joins
    // WEBVIEW_ORIGIN, and a host written here is a second place the origin lives
    // — which is exactly how a stale host reached production once already.
    if (actionType === "webview" && !actionValue.startsWith("/")) {
      reject(
        `${where}.actionValue must be root-relative for a webview action (got "${actionValue}") — ` +
          "the materializer joins WEBVIEW_ORIGIN, so this file never names a host",
      );
      return null;
    }

    const wire = { id, label: label.value, actionType, actionValue };

    if (action.style !== undefined && action.style !== null) {
      const style = readText(action.style);
      if (!VALID_ACTION_STYLES.includes(style)) {
        reject(
          `${where}.style must be one of [${VALID_ACTION_STYLES.join(", ")}] (got "${style}")`,
        );
        return null;
      }
      wire.style = style;
    }

    out.push(wire);
  }
  return out;
}

/**
 * `fields` values reach the card template's `field` slots. A number passes
 * through; anything else is an I18n value. `cancelled` is reserved — the
 * materializer writes it for a cancelled session, so authoring it by hand would
 * be silently overwritten for the one lifecycle where it matters.
 */
function readFields(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isPlainObject(raw)) return { ok: false, reason: "fields must be an object" };

  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "cancelled") {
      return {
        ok: false,
        reason: "fields.cancelled is reserved — the materializer writes it for a cancelled session",
      };
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return { ok: false, reason: `fields.${key} is not a finite number` };
      }
      out[key] = value;
      continue;
    }
    const i18n = readI18n(value, `fields.${key}`);
    if (!i18n.ok) return i18n;
    out[key] = i18n.value;
  }
  return { ok: true, value: Object.keys(out).length === 0 ? null : out };
}

function readMedia(raw, reject) {
  if (raw === undefined || raw === null) return { thumbnailUrl: null, images: [] };
  if (!isPlainObject(raw)) {
    reject("media must be an object");
    return null;
  }
  const thumbnailUrl = readText(raw.thumbnailUrl);
  const images = raw.images === undefined || raw.images === null ? [] : raw.images;
  if (!Array.isArray(images) || images.some((i) => readText(i) === "")) {
    reject("media.images must be an array of non-blank strings");
    return null;
  }
  return {
    thumbnailUrl: thumbnailUrl === "" ? null : thumbnailUrl,
    images: images.map((i) => i.trim()),
  };
}

/**
 * Resolves one session's window under whichever time base the file declared.
 *
 * Both bounds null is legitimate and load-bearing: it is how an always-on
 * facility is expressed, and §9 makes it one of the two cases the client does
 * NOT recompute against its own clock.
 */
function readWindow(entry, timeBase, dayIndex, now, reject) {
  const relative = timeBase === "relative";
  const startKey = relative ? "startOffsetMin" : "startAt";
  const endKey = relative ? "endOffsetMin" : "endAt";

  const wrongBase = relative ? ["startAt", "endAt"] : ["startOffsetMin", "endOffsetMin"];
  for (const key of wrongBase) {
    if (entry[key] !== undefined) {
      reject(`${key} is not allowed when timeBase is "${timeBase}" — use ${relative ? "offsets" : "instants"}`);
      return null;
    }
  }

  const read = (key) => {
    const raw = entry[key];
    if (raw === undefined || raw === null) return { ok: true, value: null };
    if (relative) {
      const minutes = readInteger(raw, key);
      if (!minutes.ok) return minutes;
      // The day offset is what makes a relative day-2 session sit a day later
      // than its day-1 twin, so `days: [1, 2]` produces two distinguishable
      // windows rather than two identical ones.
      const dayShift = dayIndex == null ? 0 : (dayIndex - 1) * DAY_MS;
      return { ok: true, value: new Date(now.getTime() + minutes.value * MIN_MS + dayShift) };
    }
    return readInstant(raw, key);
  };

  const start = read(startKey);
  if (!start.ok) {
    reject(start.reason);
    return null;
  }
  const end = read(endKey);
  if (!end.ok) {
    reject(end.reason);
    return null;
  }

  if (start.value && end.value && end.value <= start.value) {
    reject(`${endKey} must be after ${startKey}`);
    return null;
  }

  return { startAt: start.value, endAt: end.value };
}

/**
 * @param {string} text        raw JSON file contents
 * @param {{layerSetId: string, now: Date}} options
 * @returns {{docs: object[], errors: {index: number|null, id: string|null, message: string}[], timeBase: string|null}}
 *
 * `now` is a parameter rather than a `new Date()` call so this module stays
 * deterministic: a test passes a fixed instant and gets comparable output, which
 * is the same property parsePlacesCsv gets by having no clock at all.
 *
 * `docs` carry every SessionDoc field except `updatedAt` — the caller stamps it.
 */
function parseSessionsJson(text, options) {
  const layerSetId = options && options.layerSetId;
  const now = options && options.now;
  const fail = (message, index = null, id = null) => ({
    docs: [],
    errors: [{ index, id, message }],
    timeBase: null,
  });

  if (!layerSetId) return fail("layerSetId is required");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return fail("now must be a valid Date");
  }

  let file;
  try {
    file = JSON.parse(text);
  } catch (err) {
    // JSON.parse throws a SyntaxError carrying a character position. Surfacing
    // the message verbatim is more useful than a stack trace, and it is the only
    // structural failure this file has.
    return fail(`JSON could not be parsed: ${err.message}`);
  }

  if (!isPlainObject(file)) return fail("the file must be a JSON object");

  if (readText(file.layerSetId) !== layerSetId) {
    return fail(
      `file layerSetId "${readText(file.layerSetId)}" does not match --layer-set-id "${layerSetId}" — ` +
        "refusing to import one event's sessions into another",
    );
  }

  const timeBase = readText(file.timeBase);
  if (!VALID_TIME_BASES.includes(timeBase)) {
    return fail(`timeBase must be one of [${VALID_TIME_BASES.join(", ")}] (got "${timeBase}")`);
  }

  const campus = readText(file.campus) || "nsc";
  if (!VALID_CAMPUSES.includes(campus)) {
    return fail(`campus must be one of [${VALID_CAMPUSES.join(", ")}] (got "${campus}")`);
  }

  if (!Array.isArray(file.sessions) || file.sessions.length === 0) {
    return fail("sessions must be a non-empty array");
  }

  const docs = [];
  const errors = [];
  const seenIds = new Map();
  const seenDocIds = new Set();

  file.sessions.forEach((entry, index) => {
    const rawId = isPlainObject(entry) ? readText(entry.id) : "";
    const reject = (message) => errors.push({ index, id: rawId || null, message });

    if (!isPlainObject(entry)) {
      reject("session must be an object");
      return;
    }
    if (rawId === "") {
      reject("id is blank");
      return;
    }
    if (seenIds.has(rawId)) {
      reject(`duplicate id — already used at index ${seenIds.get(rawId)}`);
      return;
    }
    seenIds.set(rawId, index);

    const placeId = readText(entry.placeId);
    if (placeId === "") {
      reject("placeId is blank");
      return;
    }

    const title = readI18n(entry.title, "title");
    if (!title.ok) {
      reject(title.reason);
      return;
    }

    let subtitle = null;
    if (entry.subtitle !== undefined && entry.subtitle !== null) {
      const parsed = readI18n(entry.subtitle, "subtitle");
      if (!parsed.ok) {
        reject(parsed.reason);
        return;
      }
      subtitle = parsed.value;
    }

    // `category` is an OPEN string by design — next year's "전시" must be a Mongo
    // edit and not a deploy — so the only check is that it was written. An
    // unmapped value falls back through itemDefaults.fallback rather than
    // blocking the publish, which is why the importer separately reports the
    // distinct categories it is about to write.
    const category = readText(entry.category);
    if (category === "") {
      reject("category is blank");
      return;
    }

    const tenantName = readI18n(entry.tenantName, "tenantName");
    if (!tenantName.ok) {
      reject(tenantName.reason);
      return;
    }
    const tenantKind = readText(entry.tenantKind);
    if (tenantKind === "") {
      reject("tenantKind is blank");
      return;
    }
    const tenantId = readText(entry.tenantId);

    const lifecycle = entry.lifecycle === undefined ? "published" : readText(entry.lifecycle);
    if (!VALID_LIFECYCLES.includes(lifecycle)) {
      reject(`lifecycle must be one of [${VALID_LIFECYCLES.join(", ")}] (got "${lifecycle}")`);
      return;
    }

    const slot = readText(entry.slot);

    let tags = [];
    if (entry.tags !== undefined && entry.tags !== null) {
      if (!Array.isArray(entry.tags) || entry.tags.some((t) => readText(t) === "")) {
        reject("tags must be an array of non-blank strings");
        return;
      }
      tags = entry.tags.map((t) => t.trim());
    }

    const actions = readActions(entry.actions, reject);
    if (actions === null) return;

    const fields = readFields(entry.fields);
    if (!fields.ok) {
      reject(fields.reason);
      return;
    }

    const media = readMedia(entry.media, reject);
    if (media === null) return;

    let hoursLabel = null;
    if (entry.hoursLabel !== undefined && entry.hoursLabel !== null) {
      const parsed = readI18n(entry.hoursLabel, "hoursLabel");
      if (!parsed.ok) {
        reject(parsed.reason);
        return;
      }
      hoursLabel = parsed.value;
    }

    let order = index;
    if (entry.order !== undefined && entry.order !== null) {
      const parsed = readInteger(entry.order, "order");
      if (!parsed.ok) {
        reject(parsed.reason);
        return;
      }
      order = parsed.value;
    }

    // `days` absent means one document with no day index — an always-on facility.
    let days = [null];
    if (entry.days !== undefined && entry.days !== null) {
      if (!Array.isArray(entry.days) || entry.days.length === 0) {
        reject("days must be a non-empty array of integers, or omitted");
        return;
      }
      const parsed = [];
      for (const day of entry.days) {
        const int = readInteger(day, "days[]");
        if (!int.ok) {
          reject(int.reason);
          return;
        }
        if (int.value < 1) {
          reject(`days[] must be 1 or greater (got ${int.value})`);
          return;
        }
        if (parsed.includes(int.value)) {
          reject(`days[] repeats ${int.value}`);
          return;
        }
        parsed.push(int.value);
      }
      days = parsed;
    }

    let explicitDate = null;
    if (entry.date !== undefined && entry.date !== null) {
      const date = readText(entry.date);
      if (!CIVIL_DATE_RE.test(date)) {
        reject(`date must be YYYY-MM-DD (got "${date}")`);
        return;
      }
      if (days.length > 1) {
        reject("date cannot be set when days has more than one entry — one date cannot cover both");
        return;
      }
      explicitDate = date;
    }

    for (const dayIndex of days) {
      const window = readWindow(entry, timeBase, dayIndex, now, reject);
      if (window === null) return;

      // The suffix exists only when a single authored row became several
      // documents, so an unexpanded id stays readable in Atlas and in a log line.
      const docId =
        days.length > 1
          ? `${layerSetId}-${rawId}-d${dayIndex}`
          : `${layerSetId}-${rawId}`;
      if (seenDocIds.has(docId)) {
        reject(`expanded id "${docId}" collides with another session`);
        return;
      }
      seenDocIds.add(docId);

      const date =
        explicitDate ??
        (dayIndex == null || timeBase === "absolute"
          ? null
          : seoulDate(new Date(now.getTime() + (dayIndex - 1) * DAY_MS)));

      docs.push({
        _id: docId,
        layerSetId,
        placeId,
        campus,
        tenant: {
          id: tenantId === "" ? null : tenantId,
          name: tenantName.value,
          kind: tenantKind,
        },
        title: title.value,
        subtitle,
        category,
        tags,
        dayIndex,
        date,
        slot: slot === "" ? null : slot,
        startAt: window.startAt,
        endAt: window.endAt,
        hoursLabel,
        media,
        actions,
        ...(fields.value ? { fields: fields.value } : {}),
        order,
        lifecycle,
        deletedAt: null,
      });
    }
  });

  return { docs, errors, timeBase };
}

module.exports = {
  I18N_KEYS,
  VALID_ACTION_TYPES,
  VALID_CAMPUSES,
  VALID_LIFECYCLES,
  VALID_TIME_BASES,
  parseSessionsJson,
  seoulDate,
};

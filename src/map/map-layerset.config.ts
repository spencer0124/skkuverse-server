/**
 * Structure-tier loader and validator (skkuverse#14).
 *
 * Contract: docs/reference/event-places.md §1. Map layers, chips and the
 * category → layer table are DEVELOPER-owned and ship in the repo; activation
 * and content are ops-owned and live in Mongo. This module owns the first tier.
 *
 * Two things distinguish it from src/miniapps/miniapps.ts, which is otherwise
 * the same shape (readFileSync + __dirname + validate + freeze):
 *
 *  1. It NEVER throws at import — for a CONFIG FILE. miniapps throws at boot
 *     because there the registry IS the feature; here the base map is already
 *     being served, and an invalid config is logged and skipped, taking the
 *     festival off the map and leaving 건물번호 alone. A config typo must not
 *     take the whole API down. (The one
 *     caveat: this module imports `map-chips.data`, which does throw at import
 *     for a bad BASE chip. That is repo TypeScript, not a config file, and a
 *     PR fixes it — the miniapps posture, applied where it belongs.)
 *  2. The validity boundary is drawn by WHO CAN FIX IT. A category pointing at
 *     a missing layerId is a developer bug, fixable by a PR, so it blocks
 *     publication. A session whose ops-typed `category` has no entry at all is
 *     22:00 content, so it falls back and logs (ADR 0004 invariant 2). That is
 *     why itemDefaults.byCategory keys are NOT validated against anything —
 *     they are an open set on purpose.
 */
import fs from "fs";
import path from "path";
import { isHex6 } from "../infra/color";
import logger from "../infra/logger";
import type { MapCamera } from "./map-chip.types";
// Runtime imports INTO the map domain, and the reason the layer catalogue and
// the chip validator live in leaf modules: a festival's layers and chips are
// served beside the base map's, so they are validated against the full served
// set here, at load. Neither module imports this one back.
import { BASE_CHIPS, eventChipSpecs, validateChipSpecs } from "./map-chips.data";
import { BASE_LAYERS, eventLayerSpecs } from "./map-layers.data";
import type { I18n } from "../infra/types";
import type {
  DailyWindow,
  EventChipDef,
  EventLayerDef,
  EventMapConfig,
  ItemDefaults,
  ItemPresentation,
  LayerDefaultVisibility,
} from "./map-layerset.types";

/**
 * The layer sets that exist, listed explicitly rather than discovered with
 * readdirSync.
 *
 * At runtime __dirname is dist/src/map/, populated by
 * scripts/copy-build-assets.js — so a readdir would report "no layer sets" when
 * someone forgets to register a new file there, and a silently absent event map
 * is indistinguishable from a finished festival. An explicit list turns the same
 * mistake into a named ENOENT in the logs.
 *
 * ADDING A LAYER SET: add it here AND to scripts/copy-build-assets.js.
 */
const CONFIG_FILES = ["eskara-2026.json"] as const;


export type LoadedConfig =
  | { config: EventMapConfig; error: null }
  | { config: null; error: string };

// --- Primitive validators ---------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${where} must be a non-empty string`);
  }
  return value;
}

function asFiniteNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${where} must be a finite number`);
  }
  return value;
}

function asBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${where} must be a boolean`);
  return value;
}

function asOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  where: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`${where} must be one of [${allowed.join(", ")}]`);
  }
  return value as T;
}

function asI18n(value: unknown, where: string): I18n {
  const raw = asRecord(value, where);
  const out: I18n = { ko: asString(raw.ko, `${where}.ko`) };
  if (raw.en !== undefined && raw.en !== null) out.en = asString(raw.en, `${where}.en`);
  if (raw.zh !== undefined && raw.zh !== null) out.zh = asString(raw.zh, `${where}.zh`);
  return out;
}

function assertUnique(ids: string[], where: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`${where} has a duplicate id "${id}"`);
    seen.add(id);
  }
}

// --- Structure --------------------------------------------------------------

/**
 * `"HH:MM"`, 24-hour, 00:00–23:59.
 *
 * "24:00" is a real spelling of midnight in other formats and is rejected here,
 * because allowing it would give 00:00 a second one. "7:00" is rejected for the
 * same reason: one shape, so a bound can be compared as a string.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function asDailyWindow(value: unknown, where: string): DailyWindow {
  const raw = asRecord(value, where);
  const start = asString(raw.start, `${where}.start`);
  const end = asString(raw.end, `${where}.end`);
  for (const [key, bound] of [
    ["start", start],
    ["end", end],
  ] as const) {
    if (!HHMM.test(bound)) {
      fail(
        `${where}.${key} "${bound}" must be "HH:MM" on a 24-hour clock — midnight is "00:00", never "24:00"`,
      );
    }
  }
  // Equal bounds are ambiguous between "no minutes at all" and "the whole day",
  // and a layer that is on all day is `{"kind":"always"}`. `start > end` is NOT
  // an error: that is how a window says it wraps past midnight.
  if (start === end) {
    fail(
      `${where} has equal bounds "${start}" — a layer that is on all day is {"kind":"always"}`,
    );
  }
  return { start, end };
}

function asDefaultVisibleWhen(value: unknown, where: string): LayerDefaultVisibility {
  // Absent means always on, for the reason the boolean this replaced defaulted
  // to true: a layer that forgot to decide must not silently vanish.
  if (value === undefined || value === null) return { kind: "always" };
  const raw = asRecord(value, where);
  const kind = asOneOf(
    raw.kind,
    ["always", "never", "scheduled"] as const,
    `${where}.kind`,
  );
  if (kind !== "scheduled") {
    // Every validator here builds a fresh object, so an unknown key is normally
    // dropped without a word. Windows are the one worth failing on: they look
    // authored, and being read by nothing is invisible from the config.
    if (raw.windows !== undefined) {
      fail(`${where}.windows is read only on kind "scheduled", and this layer is "${kind}"`);
    }
    return { kind };
  }
  const windows = asArray(raw.windows, `${where}.windows`).map((w, i) =>
    asDailyWindow(w, `${where}.windows[${i}]`),
  );
  // Destructured rather than length-checked, so the non-empty tuple the type
  // declares is what narrowing produces — a `windows.length === 0` guard would
  // still leave `windows` a plain array and need a cast to return.
  const [first, ...rest] = windows;
  if (first === undefined) {
    fail(`${where}.windows must not be empty — a layer that is on all day is {"kind":"always"}`);
  }
  return { kind, windows: [first, ...rest] };
}

function asEventLayer(value: unknown, where: string): EventLayerDef {
  const raw = asRecord(value, where);
  const color = asString(raw.color, `${where}.color`);
  // The app's toCssColor prepends the "#" itself, so one here renders nothing
  // — a blank pin that looks like missing data rather than a config typo. The
  // rule is shared with the bus overlay colours, so there is one of it.
  if (!isHex6(color)) fail(`${where}.color must be a 6-digit hex colour without "#"`);
  return {
    id: asString(raw.id, `${where}.id`),
    label: asI18n(raw.label, `${where}.label`),
    color,
    defaultVisibleWhen: asDefaultVisibleWhen(
      raw.defaultVisibleWhen,
      `${where}.defaultVisibleWhen`,
    ),
  };
}

function asChip(value: unknown, where: string): EventChipDef {
  const raw = asRecord(value, where);
  const layerIds = asArray(raw.layerIds, `${where}.layerIds`).map((id, i) =>
    asString(id, `${where}.layerIds[${i}]`),
  );
  // An empty list is the camera-only chip of the wire contract, and that is
  // not a festival's to author — the reset chip already moves the camera.
  if (layerIds.length === 0) fail(`${where}.layerIds must not be empty`);
  const chip: EventChipDef = {
    id: asString(raw.id, `${where}.id`),
    emoji: asString(raw.emoji, `${where}.emoji`),
    layerIds,
  };
  if (raw.label !== undefined && raw.label !== null) {
    chip.label = asI18n(raw.label, `${where}.label`);
  } else if (layerIds.length !== 1) {
    // A single-layer chip reads as its layer does; anything wider has no such
    // default and must say what it means. Left absent rather than filled in
    // from the layer, so the hash reflects what was authored.
    fail(`${where}.label is required when layerIds names more than one layer`);
  }
  return chip;
}

/**
 * Every field REQUIRED, the three motion values included. A default here would
 * be a silent fallback for a number that decides how the map moves on every
 * chip tap — exactly the kind of fallback config is not allowed to have.
 */
function asCamera(value: unknown, where: string): MapCamera {
  const raw = asRecord(value, where);
  const lat = asFiniteNumber(raw.lat, `${where}.lat`);
  const lng = asFiniteNumber(raw.lng, `${where}.lng`);
  // Cheap swap detector. Not a general guarantee — it only catches a flip
  // because SKKU's longitude (126) exceeds latitude's ±90 range. The real
  // defence is the single conversion site in map-event-markers.data.ts.
  if (Math.abs(lat) > 90) {
    fail(`${where}.lat ${lat} is outside ±90 — lat and lng may be swapped`);
  }
  if (Math.abs(lng) > 180) fail(`${where}.lng ${lng} is outside ±180`);
  return {
    lat,
    lng,
    zoom: asFiniteNumber(raw.zoom, `${where}.zoom`),
    tilt: asFiniteNumber(raw.tilt, `${where}.tilt`),
    bearing: asFiniteNumber(raw.bearing, `${where}.bearing`),
    durationMs: asFiniteNumber(raw.durationMs, `${where}.durationMs`),
  };
}

function asItemPresentation(value: unknown, where: string): ItemPresentation {
  const raw = asRecord(value, where);
  return {
    layerId: asString(raw.layerId, `${where}.layerId`),
    pinPriority: asFiniteNumber(raw.pinPriority, `${where}.pinPriority`),
    // Absent or null means interactive, never fail closed — the same rule
    // `userConfigurable` and `defaultVisibleWhen` follow. Anything present must
    // be a real boolean: a string "false" is an authoring mistake worth naming,
    // not a value to coerce.
    interactive:
      raw.interactive === undefined || raw.interactive === null
        ? true
        : asBoolean(raw.interactive, `${where}.interactive`),
  };
}

function asItemDefaults(value: unknown, where: string): ItemDefaults {
  const raw = asRecord(value, where);
  const byCategoryRaw = asRecord(raw.byCategory, `${where}.byCategory`);
  const byCategory: Record<string, ItemPresentation> = {};
  for (const [category, presentation] of Object.entries(byCategoryRaw)) {
    byCategory[category] = asItemPresentation(
      presentation,
      `${where}.byCategory["${category}"]`,
    );
  }
  return {
    byCategory,
    fallback: asItemPresentation(raw.fallback, `${where}.fallback`),
  };
}

/**
 * Full structural validation. Throws a message naming the exact path, because
 * the only reader is whoever broke it and the only fix is a PR.
 */
export function assertValidConfig(raw: unknown): EventMapConfig {
  const root = asRecord(raw, "config");

  const camera = asCamera(root.camera, "config.camera");

  const layers = asArray(root.layers, "config.layers").map((l, i) =>
    asEventLayer(l, `config.layers[${i}]`),
  );
  if (layers.length === 0) fail("config.layers must not be empty");
  assertUnique(
    layers.map((l) => l.id),
    "config.layers",
  );
  // The reset chip is scoped to the layers that come on by themselves —
  // always-on plus scheduled. With none there is no way back to the ordinary
  // festival map, and the default view is an empty one.
  if (!layers.some((l) => l.defaultVisibleWhen.kind !== "never")) {
    fail('config.layers must have at least one layer that is not defaultVisibleWhen.kind "never"');
  }
  // /map/config serves both lists in one response and the app keys its
  // visibility store on the id, so a festival layer called building_numbers
  // would silently take over the buildings' toggle.
  layers.forEach((layer, i) => {
    if (BASE_LAYERS.some((base) => base.id === layer.id)) {
      fail(`config.layers[${i}].id "${layer.id}" collides with a base map layer`);
    }
  });

  // Shape only. Uniqueness and layer references are the chip VALIDATOR's
  // rules, run below over the row exactly as it will be served — one owner,
  // one set of messages, and the only place a collision with the synthesised
  // reset chip can be seen at all.
  const chips = asArray(root.chips, "config.chips").map((c, i) =>
    asChip(c, `config.chips[${i}]`),
  );

  const itemDefaults = asItemDefaults(root.itemDefaults, "config.itemDefaults");

  // Referential integrity, structure → structure only.
  const layerIds = new Set(layers.map((l) => l.id));

  const presentations: Array<[string, ItemPresentation]> = [
    ["config.itemDefaults.fallback", itemDefaults.fallback],
    ...Object.entries(itemDefaults.byCategory).map(
      ([category, p]): [string, ItemPresentation] => [
        `config.itemDefaults.byCategory["${category}"]`,
        p,
      ],
    ),
  ];
  for (const [where, presentation] of presentations) {
    if (!layerIds.has(presentation.layerId)) {
      // The whole point of the table: a category resolving to no layer is a
      // booth that is never drawn, with nothing anywhere saying why.
      fail(`${where}.layerId "${presentation.layerId}" is not in config.layers`);
    }
  }

  const config: EventMapConfig = {
    layerSetId: asString(root.layerSetId, "config.layerSetId"),
    campus: asOneOf(root.campus, ["hssc", "nsc"] as const, "config.campus"),
    name: asI18n(root.name, "config.name"),
    emoji: asString(root.emoji, "config.emoji"),
    camera,
    // Narrowed to the one zone the wire contract can honour. A DailyWindow
    // bound is wall-clock, and the client resolves it as a fixed +09:00 — so a
    // config claiming another zone is a silent wrong answer rather than a
    // degraded one. It was validated as any non-empty string until the WHEN
    // axis gave it something to be wrong about; "Asia/Seuol" passed.
    timezone: asOneOf(root.timezone, ["Asia/Seoul"] as const, "config.timezone"),
    layers,
    chips,
    itemDefaults,
  };

  // The chip row exactly as /map/config will serve it — base chips, the
  // synthesised reset chip, every authored chip — against the catalogue it
  // will be served beside. One validator for both lists, so the messages here
  // are the ones the map would have produced; and the only place a collision
  // with the reset chip's id can be caught, since that chip is authored
  // nowhere.
  const chipErrors = validateChipSpecs(
    [...BASE_CHIPS, ...eventChipSpecs(config)],
    [...BASE_LAYERS, ...eventLayerSpecs(config)],
  );
  if (chipErrors.length > 0) fail(`config.chips: ${chipErrors.join("; ")}`);

  return config;
}

// --- Load -------------------------------------------------------------------

function loadOne(fileName: string): [string, LoadedConfig] {
  const layerSetIdFromFile = fileName.replace(/\.json$/, "");
  try {
    const text = fs.readFileSync(path.join(__dirname, "config", fileName), "utf8");
    const config = assertValidConfig(JSON.parse(text));
    if (config.layerSetId !== layerSetIdFromFile) {
      fail(
        `config.layerSetId "${config.layerSetId}" does not match its filename "${fileName}"`,
      );
    }
    return [
      config.layerSetId,
      { config: Object.freeze(config), error: null },
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Loud, but not fatal: /map/config keeps serving the base layers, so the
    // campus map is intact and only the festival is missing. Silence here would
    // look exactly like "the festival is over".
    logger.error({ err: message, fileName }, "[map] Layer set config rejected");
    return [layerSetIdFromFile, { config: null, error: message }];
  }
}

const configs: ReadonlyMap<string, LoadedConfig> = new Map(CONFIG_FILES.map(loadOne));

/** null when the layer set does not exist at all (as opposed to failing validation). */
export function getLayerSetConfig(layerSetId: string): LoadedConfig | null {
  return configs.get(layerSetId) ?? null;
}

/**
 * Structure-tier loader and validator (skkuverse#14).
 *
 * Contract: docs/reference/eventmap-api.md §2. Layers, chips, sorts, card
 * templates and icons are DEVELOPER-owned and ship in the repo; activation and
 * content are ops-owned and live in Mongo. This module owns the first tier.
 *
 * Two things distinguish it from src/miniapps/miniapps.ts, which is otherwise
 * the same shape (readFileSync + __dirname + validate + freeze):
 *
 *  1. It NEVER throws at import. miniapps throws at boot because there the
 *     registry IS the feature; here a previously published snapshot is already
 *     being served, and eventmap-api.md §6.2 step 3 is explicit — an invalid
 *     config is logged and skipped, leaving the previous snapshot live. A
 *     config typo must not take the whole API down.
 *  2. The validity boundary is drawn by WHO CAN FIX IT. A layer pointing at a
 *     missing iconId is a developer bug, fixable by a PR, so it blocks
 *     publication. A session whose ops-typed `category` has no icon mapping is
 *     22:00 content, so it falls back and logs (ADR 0004 invariant 2). That is
 *     why itemDefaults.byCategory keys are NOT validated against anything —
 *     they are an open set on purpose.
 */
import fs from "fs";
import path from "path";
import logger from "../infra/logger";
import { canonicalStringify, md5 } from "./eventmap.hash";
import type {
  CardSlot,
  CardTemplateSpec,
  ChipGroupSpec,
  ChipSpec,
  EventMapConfig,
  I18n,
  IconSpec,
  ItemDefaults,
  ItemPresentation,
  LayerSpec,
  Predicate,
  SortSpec,
} from "./types";
import { ITEM_STATUSES, LAYER_RENDERS, SORT_KEYS } from "./types";

/**
 * The layer sets that exist, listed explicitly rather than discovered with
 * readdirSync.
 *
 * At runtime __dirname is dist/src/eventmap/, populated by
 * scripts/copy-build-assets.js — so a readdir would report "no layer sets" when
 * someone forgets to register a new file there, and a silently absent event map
 * is indistinguishable from a finished festival. An explicit list turns the same
 * mistake into a named ENOENT in the logs.
 *
 * ADDING A LAYER SET: add it here AND to scripts/copy-build-assets.js.
 */
const CONFIG_FILES = ["eskara-2026.json"] as const;

/**
 * The closed MarkerSymbol union, hand-mirrored from
 * @mj-studio/react-native-naver-map src/types/MarkerSymbol.ts and verified
 * byte-for-byte against the 2.7.0 the app ships.
 *
 * Deliberately not registered as a cross-repo contract: the union is effectively
 * frozen, and a drift fails loud here naming the offending config path rather
 * than shipping a blank pin. Re-check it if the library is ever bumped.
 */
const MARKER_SYMBOLS = [
  "blue",
  "gray",
  "green",
  "lightblue",
  "pink",
  "red",
  "yellow",
  "black",
  "lowDensityCluster",
  "mediumDensityCluster",
  "highDensityCluster",
] as const;

const HTTPS_RE = /^https:\/\//;

export type LoadedConfig =
  | { config: EventMapConfig; configHash: string; error: null }
  | { config: null; configHash: null; error: string };

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

function asBoolean(value: unknown, where: string, fallbackValue: boolean): boolean {
  if (value === undefined || value === null) return fallbackValue;
  if (typeof value !== "boolean") fail(`${where} must be a boolean`);
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

// --- Predicate --------------------------------------------------------------

/**
 * Validates the closed node set. The server never EVALUATES a predicate — the
 * evaluator lives in the app alone, because filter option counts (the one
 * feature that would make the server evaluate) are cut. Validating here is what
 * lets the client fail soft: an unknown node is impossible on the wire, so its
 * `evaluates false` rule only ever fires for a genuinely newer schema.
 */
function asPredicate(value: unknown, where: string): Predicate {
  const node = asArray(value, where);
  const kind = node[0];
  if (typeof kind !== "string") fail(`${where}[0] must be a predicate kind string`);

  switch (kind) {
    case "all":
      if (node.length !== 1) fail(`${where} "all" takes no arguments`);
      return ["all"];
    case "has":
      return ["has", asString(node[1], `${where}[1]`)];
    case "hasAny":
    case "hasAll": {
      const tags = asArray(node[1], `${where}[1]`);
      if (tags.length === 0) fail(`${where} "${kind}" needs at least one tag`);
      return [kind, tags.map((t, i) => asString(t, `${where}[1][${i}]`))];
    }
    case "not":
      return ["not", asPredicate(node[1], `${where}[1]`)];
    case "and":
    case "or": {
      const children = asArray(node[1], `${where}[1]`);
      if (children.length === 0) fail(`${where} "${kind}" needs at least one child`);
      return [kind, children.map((c, i) => asPredicate(c, `${where}[1][${i}]`))];
    }
    case "status": {
      const statuses = asArray(node[1], `${where}[1]`);
      if (statuses.length === 0) fail(`${where} "status" needs at least one status`);
      return [
        "status",
        statuses.map((s, i) => asOneOf(s, ITEM_STATUSES, `${where}[1][${i}]`)),
      ];
    }
    default:
      fail(`${where} has unknown predicate kind "${kind}"`);
  }
}

// --- Structure --------------------------------------------------------------

function asIcon(value: unknown, where: string): IconSpec {
  const raw = asRecord(value, where);
  const kind = asOneOf(raw.kind, ["symbol", "remote"] as const, `${where}.kind`);
  if (kind === "symbol") {
    return { kind, symbol: asOneOf(raw.symbol, MARKER_SYMBOLS, `${where}.symbol`) };
  }
  const uri = asString(raw.uri, `${where}.uri`);
  // http:// would be blocked by ATS/cleartext policy on device and render nothing.
  if (!HTTPS_RE.test(uri)) fail(`${where}.uri must be an https:// URL`);
  return {
    kind,
    uri,
    width: asFiniteNumber(raw.width, `${where}.width`),
    height: asFiniteNumber(raw.height, `${where}.height`),
  };
}

function asLayer(value: unknown, where: string): LayerSpec {
  const raw = asRecord(value, where);
  const optionalZoom = (v: unknown, key: string): number | null =>
    v === undefined || v === null ? null : asFiniteNumber(v, `${where}.${key}`);
  return {
    id: asString(raw.id, `${where}.id`),
    render: asOneOf(raw.render, LAYER_RENDERS, `${where}.render`),
    label: asI18n(raw.label, `${where}.label`),
    filter: asPredicate(raw.filter, `${where}.filter`),
    defaultVisible: asBoolean(raw.defaultVisible, `${where}.defaultVisible`, true),
    minZoom: optionalZoom(raw.minZoom, "minZoom"),
    maxZoom: optionalZoom(raw.maxZoom, "maxZoom"),
    iconId: asString(raw.iconId, `${where}.iconId`),
    sortId: asString(raw.sortId, `${where}.sortId`),
  };
}

function asChipGroup(value: unknown, where: string): ChipGroupSpec {
  const raw = asRecord(value, where);
  const selection = asOneOf(
    raw.selection,
    ["single", "multi"] as const,
    `${where}.selection`,
  );
  const chips = asArray(raw.chips, `${where}.chips`).map(
    (c, i): ChipSpec => {
      const chip = asRecord(c, `${where}.chips[${i}]`);
      return {
        id: asString(chip.id, `${where}.chips[${i}].id`),
        label: asI18n(chip.label, `${where}.chips[${i}].label`),
        defaultSelected: asBoolean(
          chip.defaultSelected,
          `${where}.chips[${i}].defaultSelected`,
          false,
        ),
        predicate: asPredicate(chip.predicate, `${where}.chips[${i}].predicate`),
      };
    },
  );
  if (chips.length === 0) fail(`${where}.chips must not be empty`);
  if (selection === "single" && chips.filter((c) => c.defaultSelected).length > 1) {
    fail(`${where} is single-selection but has more than one defaultSelected chip`);
  }
  const group: ChipGroupSpec = { id: asString(raw.id, `${where}.id`), selection, chips };
  if (raw.label !== undefined && raw.label !== null) {
    group.label = asI18n(raw.label, `${where}.label`);
  }
  return group;
}

function asSort(value: unknown, where: string): SortSpec {
  const raw = asRecord(value, where);
  return {
    id: asString(raw.id, `${where}.id`),
    label: asI18n(raw.label, `${where}.label`),
    by: asOneOf(raw.by, SORT_KEYS, `${where}.by`),
  };
}

function asCardSlot(value: unknown, where: string): CardSlot {
  const raw = asRecord(value, where);
  const kind = asOneOf(
    raw.kind,
    ["title", "subtitle", "hours", "thumbnail", "tags", "field"] as const,
    `${where}.kind`,
  );
  if (kind === "field") {
    return {
      kind,
      fieldKey: asString(raw.fieldKey, `${where}.fieldKey`),
      label: asI18n(raw.label, `${where}.label`),
    };
  }
  return { kind };
}

function asCardTemplate(value: unknown, where: string): CardTemplateSpec {
  const raw = asRecord(value, where);
  const slots = asArray(raw.slots, `${where}.slots`).map((s, i) =>
    asCardSlot(s, `${where}.slots[${i}]`),
  );
  if (slots.length === 0) fail(`${where}.slots must not be empty`);
  return { id: asString(raw.id, `${where}.id`), slots };
}

function asItemPresentation(value: unknown, where: string): ItemPresentation {
  const raw = asRecord(value, where);
  const out: ItemPresentation = {
    iconId: asString(raw.iconId, `${where}.iconId`),
    pinPriority: asFiniteNumber(raw.pinPriority, `${where}.pinPriority`),
    cardTemplateId: asString(raw.cardTemplateId, `${where}.cardTemplateId`),
  };
  if (raw.iconIdClosed !== undefined && raw.iconIdClosed !== null) {
    out.iconIdClosed = asString(raw.iconIdClosed, `${where}.iconIdClosed`);
  }
  return out;
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

  const camera = asRecord(root.camera, "config.camera");
  const lat = asFiniteNumber(camera.lat, "config.camera.lat");
  const lng = asFiniteNumber(camera.lng, "config.camera.lng");
  // Cheap swap detector. Not a general guarantee — it only catches a flip
  // because SKKU's longitude (126) exceeds latitude's ±90 range. The real
  // defence is the single conversion site in eventmap.materialize.ts.
  if (Math.abs(lat) > 90) {
    fail(`config.camera.lat ${lat} is outside ±90 — lat and lng may be swapped`);
  }
  if (Math.abs(lng) > 180) fail(`config.camera.lng ${lng} is outside ±180`);

  const iconsRaw = asRecord(root.icons, "config.icons");
  const icons: Record<string, IconSpec> = {};
  for (const [id, icon] of Object.entries(iconsRaw)) {
    icons[id] = asIcon(icon, `config.icons["${id}"]`);
  }
  if (Object.keys(icons).length === 0) fail("config.icons must not be empty");

  const layers = asArray(root.layers, "config.layers").map((l, i) =>
    asLayer(l, `config.layers[${i}]`),
  );
  if (layers.length === 0) fail("config.layers must not be empty");
  assertUnique(
    layers.map((l) => l.id),
    "config.layers",
  );

  const chipGroups = asArray(root.chipGroups, "config.chipGroups").map((g, i) =>
    asChipGroup(g, `config.chipGroups[${i}]`),
  );
  assertUnique(
    chipGroups.map((g) => g.id),
    "config.chipGroups",
  );
  // Chip ids are the client's selection keys across ALL groups, so they must be
  // globally unique, not merely unique within a group.
  assertUnique(
    chipGroups.flatMap((g) => g.chips.map((c) => c.id)),
    "config.chipGroups[].chips",
  );

  const sorts = asArray(root.sorts, "config.sorts").map((s, i) =>
    asSort(s, `config.sorts[${i}]`),
  );
  if (sorts.length === 0) fail("config.sorts must not be empty");
  assertUnique(
    sorts.map((s) => s.id),
    "config.sorts",
  );

  const cardTemplates = asArray(root.cardTemplates, "config.cardTemplates").map((t, i) =>
    asCardTemplate(t, `config.cardTemplates[${i}]`),
  );
  if (cardTemplates.length === 0) fail("config.cardTemplates must not be empty");
  assertUnique(
    cardTemplates.map((t) => t.id),
    "config.cardTemplates",
  );

  const itemDefaults = asItemDefaults(root.itemDefaults, "config.itemDefaults");

  // Referential integrity, structure → structure only.
  const iconIds = new Set(Object.keys(icons));
  const sortIds = new Set(sorts.map((s) => s.id));
  const templateIds = new Set(cardTemplates.map((t) => t.id));

  for (const layer of layers) {
    if (!iconIds.has(layer.iconId)) {
      fail(`config.layers["${layer.id}"].iconId "${layer.iconId}" is not in config.icons`);
    }
    if (!sortIds.has(layer.sortId)) {
      fail(`config.layers["${layer.id}"].sortId "${layer.sortId}" is not in config.sorts`);
    }
  }

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
    if (!iconIds.has(presentation.iconId)) {
      fail(`${where}.iconId "${presentation.iconId}" is not in config.icons`);
    }
    if (presentation.iconIdClosed && !iconIds.has(presentation.iconIdClosed)) {
      fail(`${where}.iconIdClosed "${presentation.iconIdClosed}" is not in config.icons`);
    }
    if (!templateIds.has(presentation.cardTemplateId)) {
      fail(
        `${where}.cardTemplateId "${presentation.cardTemplateId}" is not in config.cardTemplates`,
      );
    }
  }

  return {
    schemaVersion: asFiniteNumber(root.schemaVersion, "config.schemaVersion"),
    configVersion: asFiniteNumber(root.configVersion, "config.configVersion"),
    layerSetId: asString(root.layerSetId, "config.layerSetId"),
    campus: asOneOf(root.campus, ["hssc", "nsc"] as const, "config.campus"),
    camera: { lat, lng, zoom: asFiniteNumber(camera.zoom, "config.camera.zoom") },
    timezone: asString(root.timezone, "config.timezone"),
    refreshAfterSec: asFiniteNumber(root.refreshAfterSec, "config.refreshAfterSec"),
    stackKeyBy: asOneOf(
      root.stackKeyBy,
      ["placeId", "zone"] as const,
      "config.stackKeyBy",
    ),
    icons,
    layers,
    chipGroups,
    sorts,
    cardTemplates,
    itemDefaults,
  };
}

/**
 * Hash of what the config MEANS.
 *
 * configVersion is stripped: it is a human label that never reaches the wire, so
 * including it would republish an identical payload — invalidating every
 * client's one-year cache — every time someone bumped it out of habit.
 */
export function computeConfigHash(config: EventMapConfig): string {
  const hashable: Record<string, unknown> = { ...config };
  delete hashable.configVersion;
  return md5(canonicalStringify(hashable));
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
      { config: Object.freeze(config), configHash: computeConfigHash(config), error: null },
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Loud, but not fatal: a live snapshot keeps serving and the manifest keeps
    // answering. Silence here would look exactly like "the festival is over".
    logger.error({ err: message, fileName }, "[eventmap] Config rejected");
    return [layerSetIdFromFile, { config: null, configHash: null, error: message }];
  }
}

const configs: ReadonlyMap<string, LoadedConfig> = new Map(CONFIG_FILES.map(loadOne));

/** null when the layer set does not exist at all (as opposed to failing validation). */
export function getLayerSetConfig(layerSetId: string): LoadedConfig | null {
  return configs.get(layerSetId) ?? null;
}

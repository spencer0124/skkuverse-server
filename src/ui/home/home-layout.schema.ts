/**
 * Boot-time shape + referential-integrity check for the home layout.
 *
 * Same split as miniapps.schema.ts: this is OUR OWN config, so a typo is a bug
 * and throws at module load, before the deploy can serve anything. The client
 * receives the result as an untrusted payload and parses it tolerantly.
 *
 * The carousel rules also guard the campus sheet's carousel
 * (assertValidCampusCarousel), so both screens accept exactly the same banners.
 */
import { isMediaUrl } from "../../infra/media-url";
import type { I18n } from "../../infra/types";
import { ROOT_RELATIVE_PATH_RE, toWebviewUrl } from "../../infra/webview-url";
import { isKnownMiniAppTarget } from "../../miniapps/miniapp-target";
import { isSingleEmoji } from "../../miniapps/miniapps.schema";
import {
  HOME_ACTION_TYPES,
  HOME_LAYOUT_VERSION,
  type CampusBannerCarouselRaw,
  type HomeActionType,
  type HomeLayoutRaw,
} from "./home-layout.types";

const SLUG_RE = /^[a-z0-9_-]+$/;
const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/][^\s]*$/;
const WHITESPACE_RE = /\s/;
/** Refused unless it carries its own offset: a bare local time is read in the host's zone. */
const OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

export const ASPECT_RATIO_MIN = 1;
export const ASPECT_RATIO_MAX = 6;
export const AUTO_ROTATE_SEC_MIN = 2;
export const AUTO_ROTATE_SEC_MAX = 30;

/**
 * The keys each object may carry. The loader reads these names only, so a
 * misspelt `autoRotate` or `endsAt` would pass boot and quietly do nothing.
 */
const LAYOUT_KEYS = new Set(["version", "sections"]);
const CAROUSEL_KEYS = new Set(["type", "id", "aspectRatio", "autoRotateSec", "items"]);
const GRID_KEYS = new Set(["type", "id", "title", "tiles"]);
const ID_TILE_KEYS = new Set(["kind", "id"]);
const LINK_TILE_KEYS = new Set(["kind", "id", "title", "icon", "actionType", "actionValue"]);
const EMOJI_ICON_KEYS = new Set(["kind", "emoji"]);
const MEDIA_ICON_KEYS = new Set(["kind", "url"]);
const IMAGE_KEYS = new Set([
  "type",
  "id",
  "imageUrl",
  "alt",
  "actionType",
  "actionValue",
  "startAt",
  "endAt",
]);
const DEFAULT_KEYS = new Set(["type"]);
const I18N_KEYS = new Set(["ko", "en", "zh"]);

/** Thrown by the checks below; each entry point prefixes it with the file it guards. */
class SchemaError extends Error {}

function fail(message: string): never {
  throw new SchemaError(message);
}

function labelled(label: string, check: () => void): void {
  try {
    check();
  } catch (err) {
    if (err instanceof SchemaError) throw new Error(`${label}: ${err.message}`, { cause: err });
    throw err;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(where: string, value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`unknown key "${key}" in ${where}`);
  }
}

function assertI18n(where: string, value: unknown): asserts value is I18n {
  if (!isObject(value)) fail(`${where} must be an object of languages`);
  assertKnownKeys(where, value, I18N_KEYS);
  for (const [lang, text] of Object.entries(value)) {
    if (typeof text !== "string" || text.trim() === "") {
      fail(`${where}.${lang} must be non-blank text`);
    }
  }
  if (value.ko === undefined) fail(`${where}.ko is required`);
}

function parseInstant(where: string, value: unknown): number {
  if (typeof value !== "string" || !OFFSET_RE.test(value)) {
    fail(`${where} must be an ISO 8601 time with an explicit offset`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) fail(`${where} is not a valid time`);
  return ms;
}

/** Same per-type rules the event map applies to its sheet buttons. */
function isValidActionValue(type: HomeActionType, value: string): boolean {
  if (value === "" || WHITESPACE_RE.test(value)) return false;
  switch (type) {
    case "miniapp":
      return isKnownMiniAppTarget(value);
    case "external":
      return ABSOLUTE_HTTPS_RE.test(value);
    case "webview":
      return toWebviewUrl(value) !== null;
    case "route":
      return ROOT_RELATIVE_PATH_RE.test(value);
  }
}

/** `actionType` + `actionValue`, both present. Shared by banners and link tiles. */
function assertAction(where: string, item: Record<string, unknown>): void {
  const { actionType, actionValue } = item;
  if (!HOME_ACTION_TYPES.includes(actionType as HomeActionType)) {
    fail(`${where}.actionType must be one of ${HOME_ACTION_TYPES.join(", ")}`);
  }
  if (
    typeof actionValue !== "string" ||
    !isValidActionValue(actionType as HomeActionType, actionValue)
  ) {
    fail(`${where}.actionValue "${String(actionValue)}" is not valid for "${String(actionType)}"`);
  }
}

function assertBannerImage(where: string, item: Record<string, unknown>): void {
  assertKnownKeys(where, item, IMAGE_KEYS);
  if (!isMediaUrl(item.imageUrl)) fail(`${where}.imageUrl must be an object on the media bucket`);
  assertI18n(`${where}.alt`, item.alt);

  if ((item.actionType === undefined) !== (item.actionValue === undefined)) {
    fail(`${where} needs both actionType and actionValue, or neither`);
  }
  if (item.actionType !== undefined) assertAction(where, item);

  const start = item.startAt === undefined ? null : parseInstant(`${where}.startAt`, item.startAt);
  const end = item.endAt === undefined ? null : parseInstant(`${where}.endAt`, item.endAt);
  if (start !== null && end !== null && start >= end) fail(`${where}.startAt must be before endAt`);
}

function assertCarousel(
  where: string,
  section: Record<string, unknown>,
  ids: Set<string>,
  allowDefault: boolean,
): void {
  assertKnownKeys(where, section, CAROUSEL_KEYS);
  const { aspectRatio, autoRotateSec, items } = section;
  if (
    typeof aspectRatio !== "number" ||
    !(aspectRatio >= ASPECT_RATIO_MIN && aspectRatio <= ASPECT_RATIO_MAX)
  ) {
    fail(`${where}.aspectRatio must be a number from ${ASPECT_RATIO_MIN} to ${ASPECT_RATIO_MAX}`);
  }
  if (
    typeof autoRotateSec !== "number" ||
    !Number.isInteger(autoRotateSec) ||
    (autoRotateSec !== 0 &&
      (autoRotateSec < AUTO_ROTATE_SEC_MIN || autoRotateSec > AUTO_ROTATE_SEC_MAX))
  ) {
    fail(
      `${where}.autoRotateSec must be 0 (off) or a whole number from ${AUTO_ROTATE_SEC_MIN} to ${AUTO_ROTATE_SEC_MAX}`,
    );
  }
  if (!Array.isArray(items) || items.length === 0) fail(`${where}.items must be a non-empty array`);

  let defaults = 0;
  items.forEach((item: unknown, i) => {
    const at = `${where}.items[${i}]`;
    if (!isObject(item)) fail(`${at} must be an object`);
    if (item.type === "default" && allowDefault) {
      assertKnownKeys(at, item, DEFAULT_KEYS);
      defaults += 1;
      return;
    }
    if (item.type !== "image") {
      fail(`${at}.type must be ${allowDefault ? '"image" or "default"' : '"image"'}`);
    }
    assertUniqueId(at, item.id, ids);
    assertBannerImage(at, item);
  });
  // Two would be the same banner twice in one rotation.
  if (defaults > 1) fail(`${where} may place the default banner once`);
}

/** A link tile's icon: the registry's `emoji` or `media` logo spelling. */
function assertIcon(where: string, icon: unknown): void {
  if (!isObject(icon)) fail(`${where} must be an object`);
  if (icon.kind === "emoji") {
    assertKnownKeys(where, icon, EMOJI_ICON_KEYS);
    if (typeof icon.emoji !== "string" || !isSingleEmoji(icon.emoji)) {
      fail(`${where}.emoji must be exactly one emoji`);
    }
  } else if (icon.kind === "media") {
    assertKnownKeys(where, icon, MEDIA_ICON_KEYS);
    if (!isMediaUrl(icon.url)) fail(`${where}.url must be an object on the media bucket`);
  } else {
    fail(`${where}.kind must be "emoji" or "media"`);
  }
}

function assertTile(
  where: string,
  tile: unknown,
  registeredMiniApps: ReadonlySet<string>,
): asserts tile is Record<string, unknown> & { id: string } {
  if (!isObject(tile)) fail(`${where} must be an object`);
  if (typeof tile.id !== "string" || !SLUG_RE.test(tile.id)) fail(`${where}.id must be a slug`);
  switch (tile.kind) {
    case "miniapp":
      assertKnownKeys(where, tile, ID_TILE_KEYS);
      if (!registeredMiniApps.has(tile.id)) {
        fail(`${where}.id "${tile.id}" is not a registered mini app`);
      }
      return;
    case "game":
      // Which games a build ships is the app's to know; a build without this
      // one drops the tile.
      assertKnownKeys(where, tile, ID_TILE_KEYS);
      return;
    case "link":
      assertKnownKeys(where, tile, LINK_TILE_KEYS);
      assertI18n(`${where}.title`, tile.title);
      assertIcon(`${where}.icon`, tile.icon);
      assertAction(where, tile);
      return;
    default:
      fail(`${where}.kind must be "miniapp", "game" or "link"`);
  }
}

function assertGrid(
  where: string,
  section: Record<string, unknown>,
  registeredMiniApps: ReadonlySet<string>,
  placedTiles: Set<string>,
): void {
  assertKnownKeys(where, section, GRID_KEYS);
  if (section.title !== undefined) assertI18n(`${where}.title`, section.title);
  const { tiles } = section;
  if (!Array.isArray(tiles) || tiles.length === 0) fail(`${where}.tiles must be a non-empty array`);
  tiles.forEach((tile: unknown, i) => {
    const at = `${where}.tiles[${i}]`;
    assertTile(at, tile, registeredMiniApps);
    // Twice on one screen is a tile the user sees duplicated. One namespace for
    // every kind: the tile id is also the analytics item id for a tap.
    if (placedTiles.has(tile.id)) fail(`tile "${tile.id}" is placed more than once`);
    placedTiles.add(tile.id);
  });
}

function assertUniqueId(where: string, id: unknown, ids: Set<string>): void {
  if (typeof id !== "string" || !SLUG_RE.test(id)) fail(`${where}.id must be a slug`);
  // Section and banner ids share one namespace: both are analytics item ids.
  if (ids.has(id)) fail(`duplicate id "${id}"`);
  ids.add(id);
}

export function assertValidHomeLayout(
  raw: unknown,
  registeredMiniApps: ReadonlySet<string>,
): asserts raw is HomeLayoutRaw {
  labelled("home layout", () => assertHomeLayout(raw, registeredMiniApps));
}

function assertHomeLayout(raw: unknown, registeredMiniApps: ReadonlySet<string>): void {
  if (!isObject(raw)) fail("root must be an object");
  assertKnownKeys("root", raw, LAYOUT_KEYS);
  if (raw.version !== HOME_LAYOUT_VERSION) fail(`version must be ${HOME_LAYOUT_VERSION}`);
  if (!Array.isArray(raw.sections)) fail("sections must be an array");

  const ids = new Set<string>();
  const placedTiles = new Set<string>();
  raw.sections.forEach((section: unknown, i) => {
    const where = `sections[${i}]`;
    if (!isObject(section)) fail(`${where} must be an object`);
    assertUniqueId(where, section.id, ids);
    if (section.type === "banner_carousel") {
      assertCarousel(where, section, ids, true);
    } else if (section.type === "tile_grid") {
      assertGrid(where, section, registeredMiniApps, placedTiles);
    } else {
      fail(`${where}.type must be "banner_carousel" or "tile_grid"`);
    }
  });
}

/**
 * The campus sheet's carousel (campus-banners.json): one carousel section on
 * its own, under the home rules minus the `default` item. That item is the home
 * screen's built-in HeroBanner, which the campus sheet does not have.
 */
export function assertValidCampusCarousel(raw: unknown): asserts raw is CampusBannerCarouselRaw {
  labelled("campus banners", () => {
    if (!isObject(raw)) fail("root must be an object");
    if (raw.type !== "banner_carousel") fail('type must be "banner_carousel"');
    const ids = new Set<string>();
    assertUniqueId("root", raw.id, ids);
    assertCarousel("root", raw, ids, false);
  });
}

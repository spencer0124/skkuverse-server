/**
 * Boot-time shape + referential-integrity check for the home layout.
 *
 * Same split as miniapps.schema.ts: this is OUR OWN config, so a typo is a bug
 * and throws at module load, before the deploy can serve anything. The client
 * receives the result as an untrusted payload and parses it tolerantly.
 */
import { isMediaUrl } from "../../infra/media-url";
import type { I18n } from "../../infra/types";
import { ROOT_RELATIVE_PATH_RE, toWebviewUrl } from "../../infra/webview-url";
import { isKnownMiniAppTarget } from "../../miniapps/miniapp-target";
import {
  HOME_ACTION_TYPES,
  HOME_LAYOUT_VERSION,
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
const GRID_KEYS = new Set(["type", "id", "title", "miniAppIds"]);
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

function fail(message: string): never {
  throw new Error(`home layout: ${message}`);
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

function assertBannerImage(where: string, item: Record<string, unknown>): void {
  assertKnownKeys(where, item, IMAGE_KEYS);
  if (!isMediaUrl(item.imageUrl)) fail(`${where}.imageUrl must be an object on the media bucket`);
  assertI18n(`${where}.alt`, item.alt);

  const { actionType, actionValue } = item;
  if ((actionType === undefined) !== (actionValue === undefined)) {
    fail(`${where} needs both actionType and actionValue, or neither`);
  }
  if (actionType !== undefined) {
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

  const start = item.startAt === undefined ? null : parseInstant(`${where}.startAt`, item.startAt);
  const end = item.endAt === undefined ? null : parseInstant(`${where}.endAt`, item.endAt);
  if (start !== null && end !== null && start >= end) fail(`${where}.startAt must be before endAt`);
}

function assertCarousel(where: string, section: Record<string, unknown>, ids: Set<string>): void {
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
    if (item.type === "default") {
      assertKnownKeys(at, item, DEFAULT_KEYS);
      defaults += 1;
      return;
    }
    if (item.type !== "image") fail(`${at}.type must be "image" or "default"`);
    assertUniqueId(at, item.id, ids);
    assertBannerImage(at, item);
  });
  // Two would be the same banner twice in one rotation.
  if (defaults > 1) fail(`${where} may place the default banner once`);
}

function assertGrid(
  where: string,
  section: Record<string, unknown>,
  registeredMiniApps: ReadonlySet<string>,
  placedMiniApps: Set<string>,
): void {
  assertKnownKeys(where, section, GRID_KEYS);
  if (section.title !== undefined) assertI18n(`${where}.title`, section.title);
  const { miniAppIds } = section;
  if (!Array.isArray(miniAppIds) || miniAppIds.length === 0) {
    fail(`${where}.miniAppIds must be a non-empty array`);
  }
  for (const id of miniAppIds) {
    if (typeof id !== "string" || !registeredMiniApps.has(id)) {
      fail(`${where}.miniAppIds names "${String(id)}", which is not a registered mini app`);
    }
    // Twice on one screen is a tile the user sees duplicated.
    if (placedMiniApps.has(id)) fail(`mini app "${id}" is placed in more than one grid`);
    placedMiniApps.add(id);
  }
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
  if (!isObject(raw)) fail("root must be an object");
  assertKnownKeys("root", raw, LAYOUT_KEYS);
  if (raw.version !== HOME_LAYOUT_VERSION) fail(`version must be ${HOME_LAYOUT_VERSION}`);
  if (!Array.isArray(raw.sections)) fail("sections must be an array");

  const ids = new Set<string>();
  const placedMiniApps = new Set<string>();
  raw.sections.forEach((section: unknown, i) => {
    const where = `sections[${i}]`;
    if (!isObject(section)) fail(`${where} must be an object`);
    assertUniqueId(where, section.id, ids);
    if (section.type === "banner_carousel") {
      assertCarousel(where, section, ids);
    } else if (section.type === "miniapp_grid") {
      assertGrid(where, section, registeredMiniApps, placedMiniApps);
    } else {
      fail(`${where}.type must be "banner_carousel" or "miniapp_grid"`);
    }
  });
}

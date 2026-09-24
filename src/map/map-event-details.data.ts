import { createCachedLoader } from "../common/cache/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { hasAnyText } from "../infra/i18n";
import logger from "../infra/logger";
import { isMediaUrl } from "../infra/media-url";
import type { I18n } from "../infra/types";
import { activeEventConfig } from "./map-active-layerset";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "./map-event-cache";
import { isAbsoluteHttpsUrl, isRenderable, toWire } from "./map-event-overlays.data";
import { presentationFor } from "./map-layerset.types";
import type { I18nWire } from "./map-overlay.types";
import {
  PLACE_KINDS,
  type EventPlaceDetails,
  type PlaceBlockWire,
  type PlaceDetailActionWire,
  type PlaceDetailWire,
  type PlaceKind,
  type PlaceListItemOf,
  type PlaceTableRowOf,
} from "./map-place-detail.types";
import { getPlacesCollection } from "./map-places.data";
import type { MapPlaceDoc } from "./map-places.types";

/**
 * Event places' DETAILS — the sheet body behind each pin, keyed by the same id
 * the overlay's `tap.placeId` carries.
 *
 * A second view of the same documents `map-event-overlays.data.ts` serves, and
 * deliberately a second ROUTE: the overlay is what every renderer shares, the
 * detail is read by the sheet alone. The app fetches this once beside the
 * overlays and looks a place up synchronously when its sheet rises.
 *
 * ## Why everything is re-checked here
 *
 * The importer already refuses a malformed detail, so on the happy path every
 * check below passes. They exist for the two things the importer never sees:
 *
 *  - **A hand edit in Mongo** — the ops workflow this repo blesses for a
 *    festival-night correction, with no reader in front of it.
 *  - **Drift between the importer's JS copies and the server's constants.**
 *    `MEDIA_ORIGIN` here is the authority; a stale copy can only produce a
 *    dropped image, never an off-host URL on a device.
 *
 * And one that is not optional at all: `toWire` reads `.ko` off whatever it is
 * handed, so one block with a missing body would throw out of the route and 500
 * every sheet of the festival.
 *
 * Failure is SOFT and as narrow as possible, the posture the overlay producer
 * takes with a bad button: a broken block or action is dropped on its own; a
 * detail is dropped whole only when its head is unreadable. Every drop is logged,
 * because a fail-soft drop nobody can find out about is just a silent one.
 */

// --- Instagram --------------------------------------------------------------

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_RESERVED_PATHS = new Set([
  "accounts",
  "direct",
  "explore",
  "p",
  "reel",
  "reels",
  "stories",
]);
const INSTAGRAM_MEDIA_KINDS = new Set(["p", "reel", "reels"]);

function instagramSegments(value: unknown): string[] | null {
  if (!isAbsoluteHttpsUrl(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url.pathname.split("/").filter(Boolean);
}

/**
 * Exactly what the app will open (skkuverse-app `instagram.ts`): one path
 * segment that is not one of Instagram's own pages. A looser check would ship
 * a button that does nothing on tap.
 */
function isInstagramProfileUrl(value: unknown): value is string {
  const segments = instagramSegments(value);
  return (
    segments !== null &&
    segments.length === 1 &&
    !INSTAGRAM_RESERVED_PATHS.has(segments[0]!.toLowerCase())
  );
}

/** `/p/<code>`, `/reel/<code>` or `/reels/<code>`. */
function isInstagramPostUrl(value: unknown): value is string {
  const segments = instagramSegments(value);
  return (
    segments !== null &&
    segments.length === 2 &&
    INSTAGRAM_MEDIA_KINDS.has(segments[0]!.toLowerCase())
  );
}

// --- Projection -------------------------------------------------------------

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Resolved text, or null when there is none in any language. */
function textOrNull(value: unknown): I18nWire | null {
  return isObject(value) && hasAnyText(value as unknown as I18n)
    ? toWire(value as unknown as I18n)
    : null;
}

/** Every element resolved, or null if any one of them is unusable. */
function allOrNull<T>(value: unknown, read: (raw: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: T[] = [];
  for (const raw of value) {
    const item = read(raw);
    if (item === null) return null;
    out.push(item);
  }
  return out;
}

function toWireListItem(raw: unknown): PlaceListItemOf<I18nWire> | null {
  if (!isObject(raw)) return null;
  const title = textOrNull(raw.title);
  if (!title) return null;
  return {
    emoji: typeof raw.emoji === "string" && raw.emoji.trim() !== "" ? raw.emoji : null,
    title,
    description: textOrNull(raw.description),
  };
}

function toWireTableRow(raw: unknown): PlaceTableRowOf<I18nWire> | null {
  if (!isObject(raw)) return null;
  const label = textOrNull(raw.label);
  const value = textOrNull(raw.value);
  return label && value ? { label, value } : null;
}

/** One block, or null — with the reason pushed onto `dropped`. */
function toWireBlock(raw: unknown, where: string, dropped: string[]): PlaceBlockWire | null {
  if (!isObject(raw) || !isNonBlankId(raw.id)) {
    dropped.push(`${where}: not a block with an id`);
    return null;
  }
  const at = `${where}.${raw.id}`;
  const id = raw.id;
  const title = textOrNull(raw.title);

  switch (raw.type) {
    case "text": {
      const body = textOrNull(raw.body);
      if (body) return { type: "text", id, title, body };
      break;
    }
    case "list": {
      const items = allOrNull(raw.items, toWireListItem);
      if (items) return { type: "list", id, title, items };
      break;
    }
    case "table": {
      const rows = allOrNull(raw.rows, toWireTableRow);
      if (rows) return { type: "table", id, title, rows };
      break;
    }
    case "image":
      if (isMediaUrl(raw.url)) {
        return { type: "image", id, title, url: raw.url as string, caption: textOrNull(raw.caption) };
      }
      dropped.push(`${at}: image url "${String(raw.url)}" is not on the media host`);
      return null;
    case "notice": {
      const items = allOrNull(raw.items, textOrNull);
      if (items) return { type: "notice", id, title, items };
      break;
    }
    default:
      dropped.push(`${at}: unknown block type "${String(raw.type)}"`);
      return null;
  }
  dropped.push(`${at}: ${String(raw.type)} block is missing a required field`);
  return null;
}

function toWireDetailAction(
  raw: unknown,
  where: string,
  dropped: string[],
): PlaceDetailActionWire | null {
  if (!isObject(raw) || !isNonBlankId(raw.id)) {
    dropped.push(`${where}: not an action with an id`);
    return null;
  }
  const at = `${where}.${raw.id}`;
  const label = textOrNull(raw.label);
  if (!label) {
    dropped.push(`${at}: label is blank in every language`);
    return null;
  }
  if (raw.type === "instagram") {
    if (!isInstagramProfileUrl(raw.profileUrl)) {
      dropped.push(`${at}: profileUrl "${String(raw.profileUrl)}" is not an Instagram profile`);
      return null;
    }
    // A bad post URL costs the post, not the button: the profile still opens.
    const postUrl = isInstagramPostUrl(raw.postUrl) ? raw.postUrl : null;
    if (raw.postUrl != null && postUrl === null) {
      dropped.push(`${at}: postUrl "${String(raw.postUrl)}" is not an Instagram post`);
    }
    return { type: "instagram", id: raw.id, label, profileUrl: raw.profileUrl, postUrl };
  }
  if (raw.type === "link") {
    if (isAbsoluteHttpsUrl(raw.url)) return { type: "link", id: raw.id, label, url: raw.url };
    dropped.push(`${at}: url "${String(raw.url)}" is not an absolute https URL`);
    return null;
  }
  dropped.push(`${at}: unknown action type "${String(raw.type)}"`);
  return null;
}

/**
 * One place's detail on the wire, or null when its head is unreadable.
 *
 * An unknown `kind` drops the whole detail rather than one field: the app's
 * union is closed, so a kind it does not know is not something it can file.
 */
function toWireDetail(doc: MapPlaceDoc, dropped: string[]): PlaceDetailWire | null {
  const raw: unknown = doc.detail;
  if (
    !isObject(raw) ||
    !PLACE_KINDS.includes(raw.kind as PlaceKind) ||
    !Array.isArray(raw.blocks) ||
    !Array.isArray(raw.actions)
  ) {
    dropped.push(`${doc._id}: detail is unreadable (kind, blocks or actions)`);
    return null;
  }
  const blocks: PlaceBlockWire[] = [];
  raw.blocks.forEach((b, i) => {
    const block = toWireBlock(b, `${doc._id}.blocks[${i}]`, dropped);
    if (block) blocks.push(block);
  });
  const actions: PlaceDetailActionWire[] = [];
  raw.actions.forEach((a, i) => {
    const action = toWireDetailAction(a, `${doc._id}.actions[${i}]`, dropped);
    if (action) actions.push(action);
  });
  return {
    placeId: doc._id,
    kind: raw.kind as PlaceKind,
    org: textOrNull(raw.org),
    isUnion: raw.isUnion === true,
    locationLabel: textOrNull(raw.locationLabel),
    actions,
    blocks,
  };
}

/**
 * Every detail in the currently active layer set, keyed by place id.
 *
 * Same gate as the overlays: no live festival is an ordinary empty answer, and
 * Mongo is not consulted. Only a place the overlay route would also serve, on a
 * category a tap can reach, gets a detail — anything else has no sheet to open.
 */
async function loadEventPlaceDetails(): Promise<EventPlaceDetails> {
  const config = await activeEventConfig(new Date());
  if (!config) return { details: {} };

  const docs = await getPlacesCollection()
    .find(
      { layerSetId: config.layerSetId, detail: { $ne: null } },
      { maxTimeMS: HOT_READ_MAX_TIME_MS },
    )
    .toArray();

  const dropped: string[] = [];
  const details: Record<string, PlaceDetailWire> = {};
  for (const doc of docs) {
    if (!isRenderable(doc)) {
      dropped.push(`${doc._id}: place is not renderable`);
      continue;
    }
    const presentation = presentationFor(config, doc.category);
    if (!presentation.interactive) {
      dropped.push(`${doc._id}: category "${doc.category}" is not tappable`);
      continue;
    }
    if (presentation.tapChip) {
      // Its tap runs a chip, so no sheet ever opens for it.
      dropped.push(`${doc._id}: category "${doc.category}" taps to chip "${presentation.tapChip}"`);
      continue;
    }
    const detail = toWireDetail(doc, dropped);
    if (detail) details[doc._id] = detail;
  }

  if (dropped.length > 0) {
    logger.warn(
      `[map] ${dropped.length} place-detail item(s) dropped in "${config.layerSetId}": ${dropped.join("; ")}`,
    );
  }
  return { details };
}

// Cached whole, like the overlays it pairs with (map-event-cache.ts).
const detailsCache = createCachedLoader({
  name: "event place details",
  ttlMs: EVENT_CACHE_TTL_MS,
  staleWindowMs: EVENT_STALE_WINDOW_MS,
  load: loadEventPlaceDetails,
});

function getEventPlaceDetails(): Promise<EventPlaceDetails> {
  return detailsCache.get();
}

/** Drops the cached details. For tests. */
function clearEventDetailsCache(): void {
  detailsCache.clear();
}

export {
  clearEventDetailsCache,
  getEventPlaceDetails,
  isInstagramPostUrl,
  isInstagramProfileUrl,
};

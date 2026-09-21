import type { I18nWire } from "./map-overlay.types";

/**
 * A festival place's DETAIL — what its sheet says beyond the pin.
 *
 * The overlay (`map-overlay.types.ts`) is the SUMMARY every renderer shares: a
 * title, a subtitle, hours, buttons. The detail is read by the sheet alone — an
 * operator, an intro, a menu table, photos — so it rides its own route
 * (`GET /map/overlays/event/details`) instead of widening a type the map, the
 * list and the pin-collision ladder all touch. Folding it in would ship every
 * menu and photo URL to a client that only wanted to draw pins.
 *
 * The shape is the app's `PlaceDetail`
 * (skkuverse-app `packages/shared/src/types/placeDetail.ts`), which was authored
 * client-first against a mock so the sheet could be built before this field
 * existed. Mirrored one-to-one so the app's lookup can swap the mock for this
 * route with no translation layer.
 *
 * ## Why the body is blocks
 *
 * The council's requirement sheet names a dozen categories whose bodies share
 * almost nothing — a booth has games, a truck has a priced menu, a toilet has
 * nothing. A field per category would mean a client release per new category.
 * So the head stays typed and the body is an ordered list of typed blocks the
 * operator composes; a new category is an authoring change.
 *
 * Each shape takes its text type as a parameter, so the stored form (`I18n`,
 * `en` optional) and the wire form (`I18nWire`, `en` filled) are the SAME shape
 * and cannot drift apart when a block grows a field.
 */

/**
 * CLOSED on the client: the app's `PlaceKind` is a union with no fallback, so a
 * kind it does not know is a bug there. A new kind therefore ships in the app
 * first and here second. Carried for the list's filters — nothing branches its
 * rendering on it.
 */
export const PLACE_KINDS = [
  "pub",
  "booth",
  "promo",
  "foodTruck",
  "goods",
  "facility",
  "stage",
  "etc",
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/**
 * OPEN on the client: a block whose type a build does not know is dropped on its
 * own, so a new type can ship here before every installed app can draw it. The
 * server still refuses anything outside this list — at import, so a typo fails
 * the sheet, and at serve time, so a hand edit in Mongo drops one block.
 */
export const PLACE_BLOCK_TYPES = ["text", "list", "table", "image", "notice"] as const;
export type PlaceBlockType = (typeof PLACE_BLOCK_TYPES)[number];

/** One row of a `list` block — a game, a mission, a giveaway. */
export interface PlaceListItemOf<T> {
  emoji: string | null;
  title: T;
  description: T | null;
}

/** One row of a `table` block. `value` is a formatted string (`5,000원`), as ops writes it. */
export interface PlaceTableRowOf<T> {
  label: T;
  value: T;
}

/** `title` is the block's optional heading. Style belongs to the type, never to the block. */
export type PlaceBlockOf<T> =
  | { type: "text"; id: string; title: T | null; body: T }
  | { type: "list"; id: string; title: T | null; items: PlaceListItemOf<T>[] }
  | { type: "table"; id: string; title: T | null; rows: PlaceTableRowOf<T>[] }
  /** `url` is always on MEDIA_ORIGIN — see `src/infra/media-url.ts`. */
  | { type: "image"; id: string; title: T | null; url: string; caption: T | null }
  | { type: "notice"; id: string; title: T | null; items: T[] };

/** The profile is the fallback destination; a post, when authored, is preferred. */
export interface PlaceInstagramActionOf<T> {
  type: "instagram";
  id: string;
  label: T;
  profileUrl: string;
  postUrl: string | null;
}

/** A labelled page. Always an absolute https URL — the app opens it as `external`. */
export interface PlaceLinkActionOf<T> {
  type: "link";
  id: string;
  label: T;
  url: string;
}

export const PLACE_DETAIL_ACTION_TYPES = ["instagram", "link"] as const;

/**
 * Named `…DetailAction` rather than the app's `PlaceAction`, because
 * `PlaceAction` on this server already means the overlay's sheet button
 * (`map-places.types.ts`). Same wire shape, different local name.
 */
export type PlaceDetailActionOf<T> = PlaceInstagramActionOf<T> | PlaceLinkActionOf<T>;

export interface PlaceDetailOf<T> {
  kind: PlaceKind;
  /** The organisation running it — a student council, a club, a sponsor. */
  org: T | null;
  /** A 학생단체협의체 joint booth. Display-only; the council filters on it. */
  isUnion: boolean;
  /** Where to find it, in words — "102번 부스". */
  locationLabel: T | null;
  actions: PlaceDetailActionOf<T>[];
  /** The body, in the order the operator composed it. */
  blocks: PlaceBlockOf<T>[];
}

// --- Wire -------------------------------------------------------------------

export type PlaceBlockWire = PlaceBlockOf<I18nWire>;
export type PlaceDetailActionWire = PlaceDetailActionOf<I18nWire>;

/** The app's `PlaceDetail`, exactly. `placeId` is the overlay's `tap.placeId`. */
export interface PlaceDetailWire extends PlaceDetailOf<I18nWire> {
  placeId: string;
}

/** `data` of `GET /map/overlays/event/details`. Only places that carry a detail appear. */
export interface EventPlaceDetails {
  details: Record<string, PlaceDetailWire>;
}

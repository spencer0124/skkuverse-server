/**
 * Home layout types — the server-side SSOT for GET /ui/home.
 *
 * Mirrored by packages/shared/src/home/schema.ts in skkuverse-app, which is a
 * CONSUMER of this shape. Keep the two in step: the client parses tolerantly,
 * so a mismatch degrades silently (a section or a banner page disappears)
 * rather than erroring.
 *
 * The layout references mini apps by id only. Names and logos stay in the
 * mini-app registry (GET /miniapps), which the client already holds and joins
 * against — so a rename or a new logo is one edit in one place, and the home
 * layout decides nothing but arrangement.
 *
 * Released clients never call this endpoint. They still draw one flat grid from
 * the registry's `order` + `hidden`, which is why `hidden` stays in index.json.
 */
import type { I18n } from "../../infra/types";

/**
 * Bump only on BREAKING changes (removed/renamed/retyped field). A new section
 * type or banner item type is not breaking: clients skip what they do not know.
 */
export const HOME_LAYOUT_VERSION = 1;

/** Action types a banner may carry. A subset of the app's SDUI `ActionType`. */
export const HOME_ACTION_TYPES = ["miniapp", "external", "webview", "route"] as const;
export type HomeActionType = (typeof HOME_ACTION_TYPES)[number];

// ── On disk (home-layout.json) ──

/** An uploaded image, optionally shown only inside [startAt, endAt). */
export interface HomeBannerImageRaw {
  type: "image";
  /** Stable slug; the analytics item id for a tap. */
  id: string;
  /** Absolute URL on the media bucket, content-hashed and immutable. */
  imageUrl: string;
  /** Screen-reader label. Required: an image banner has no other text. */
  alt: I18n;
  actionType?: HomeActionType;
  actionValue?: string;
  /** ISO 8601 with an explicit offset. Absent means already showing. */
  startAt?: string;
  /** ISO 8601 with an explicit offset, exclusive. Absent means no end. */
  endAt?: string;
}

/**
 * The app's own built-in banner (HeroBanner), placed where it sits in the list.
 * A list item rather than an `includeDefault` flag, so one entry decides both
 * whether the default shows and where in the rotation it falls.
 */
export interface HomeBannerDefaultRaw {
  type: "default";
}

export type HomeBannerItemRaw = HomeBannerImageRaw | HomeBannerDefaultRaw;

export interface HomeBannerCarouselRaw {
  type: "banner_carousel";
  id: string;
  /** width / height of every page in the slot. */
  aspectRatio: number;
  /** Seconds per page. 0 turns auto-rotation off. */
  autoRotateSec: number;
  items: HomeBannerItemRaw[];
}

/**
 * The campus sheet's carousel (src/ui/ui/campus-banners.json, served inside
 * GET /ui/home/campus). Same shape and rules as the home one, but images only:
 * the campus sheet has no built-in banner for a `default` item to stand for.
 */
export interface CampusBannerCarouselRaw extends HomeBannerCarouselRaw {
  items: HomeBannerImageRaw[];
}

export interface HomeMiniAppGridRaw {
  type: "miniapp_grid";
  id: string;
  /** Section heading. Absent means the grid is drawn with no heading. */
  title?: I18n;
  /** Registered mini-app ids, in display order. */
  miniAppIds: string[];
}

export type HomeSectionRaw = HomeBannerCarouselRaw | HomeMiniAppGridRaw;

export interface HomeLayoutRaw {
  version: number;
  sections: HomeSectionRaw[];
}

// ── On the wire ──

export interface HomeBannerImage {
  type: "image";
  id: string;
  imageUrl: string;
  alt: string;
  actionType?: HomeActionType;
  actionValue?: string;
}

export type HomeBannerItem = HomeBannerImage | HomeBannerDefaultRaw;

export interface HomeBannerCarousel {
  type: "banner_carousel";
  id: string;
  aspectRatio: number;
  autoRotateSec: number;
  items: HomeBannerItem[];
}

export interface HomeMiniAppGrid {
  type: "miniapp_grid";
  id: string;
  title?: string;
  miniAppIds: string[];
}

export type HomeSection = HomeBannerCarousel | HomeMiniAppGrid;

export interface HomeLayout {
  version: number;
  sections: HomeSection[];
}

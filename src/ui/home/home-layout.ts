/**
 * Home layout loader — GET /ui/home.
 *
 * Reads home-layout.json once at module load, validates it against the mini-app
 * registry (throws at boot on a bad file), and freezes it. Requests then only
 * resolve it: drop banners outside their window, pick one language.
 *
 * Mirrors miniapps/miniapps.ts, including the __dirname path resolution: at
 * runtime this is dist/src/ui/home/, and scripts/copy-build-assets.js stages the
 * JSON next to the compiled .js. Forgetting that entry breaks production only.
 */
import fs from "fs";
import path from "path";
import { pick } from "../../infra/i18n";
import type { I18n, SupportedLang } from "../../infra/types";
import { map as miniAppRegistry } from "../../miniapps/miniapps";
import { assertValidHomeLayout } from "./home-layout.schema";
import type {
  HomeBannerCarousel,
  HomeBannerCarouselRaw,
  HomeBannerImageRaw,
  HomeBannerItem,
  HomeLayout,
  HomeLayoutRaw,
  HomeSection,
  HomeSectionRaw,
} from "./home-layout.types";

/**
 * Validate and freeze a raw layout. Exported for tests, which feed it layouts
 * the committed file does not contain.
 */
export function loadHomeLayout(raw: unknown): Readonly<HomeLayoutRaw> {
  assertValidHomeLayout(raw, new Set(miniAppRegistry.keys()));
  return Object.freeze(raw);
}

const layout = loadHomeLayout(
  JSON.parse(fs.readFileSync(path.join(__dirname, "home-layout.json"), "utf8")),
);

/** `ko` is required and non-blank (schema), so the fallback is only for the type. */
function text(value: I18n, lang: SupportedLang): string {
  return pick(value, lang) ?? value.ko;
}

function isShowing(item: HomeBannerImageRaw, now: number): boolean {
  if (item.startAt !== undefined && now < Date.parse(item.startAt)) return false;
  if (item.endAt !== undefined && now >= Date.parse(item.endAt)) return false;
  return true;
}

/**
 * Built from named fields rather than `...raw`, so the on-disk window and the
 * untranslated text can never reach the wire.
 *
 * Exported for the campus sheet's carousel, which resolves the same way.
 */
export function toWireCarousel(
  section: HomeBannerCarouselRaw,
  lang: SupportedLang,
  now: number,
): HomeBannerCarousel {
  const items: HomeBannerItem[] = [];
  for (const item of section.items) {
    if (item.type === "default") {
      items.push({ type: "default" });
    } else if (isShowing(item, now)) {
      items.push({
        type: "image",
        id: item.id,
        imageUrl: item.imageUrl,
        alt: text(item.alt, lang),
        ...(item.actionType !== undefined
          ? { actionType: item.actionType, actionValue: item.actionValue }
          : {}),
      });
    }
  }
  return {
    type: "banner_carousel",
    id: section.id,
    aspectRatio: section.aspectRatio,
    autoRotateSec: section.autoRotateSec,
    items,
  };
}

function toWireSection(section: HomeSectionRaw, lang: SupportedLang, now: number): HomeSection {
  if (section.type === "miniapp_grid") {
    return {
      type: "miniapp_grid",
      id: section.id,
      ...(section.title !== undefined ? { title: text(section.title, lang) } : {}),
      miniAppIds: [...section.miniAppIds],
    };
  }
  // Kept even when every image has expired and no default was placed: the app
  // draws its default banner for an empty carousel, never an empty slot.
  return toWireCarousel(section, lang, now);
}

export function resolveHomeLayout(
  lang: SupportedLang,
  now: Date,
  source: Readonly<HomeLayoutRaw> = layout,
): HomeLayout {
  const at = now.getTime();
  return {
    version: source.version,
    sections: source.sections.map((section) => toWireSection(section, lang, at)),
  };
}

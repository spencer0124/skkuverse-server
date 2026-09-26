/**
 * Unit tests for the campus sheet's banner carousel: the boot-time guard
 * (assertValidCampusCarousel, via loadCampusBanners) and how getCampusSections
 * places the resolved carousel.
 *
 * The guard shares its carousel rules with the home layout (home-layout.test.ts
 * covers those one by one), so this file pins what differs for campus.
 */
import { getCampusSections, loadCampusBanners } from "../../../src/ui/ui/ui.campus";
import type { CampusBannerCarouselRaw } from "../../../src/ui/home/home-layout.types";

const IMAGE_URL = "https://media.skkuverse.com/campus/banners/test-00000000.webp";

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: { ko: "현수막" }, ...overrides };
}

function carousel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "banner_carousel",
    id: "campus_banners",
    aspectRatio: 6,
    autoRotateSec: 4,
    items: [image()],
    ...overrides,
  };
}

describe("committed campus-banners.json", () => {
  it("loads, so the module import in this file did not throw", () => {
    const [first] = getCampusSections("ko").sections;
    expect(first).toMatchObject({ type: "banner_carousel", id: "campus_banners" });
  });
});

describe("assertValidCampusCarousel (via loadCampusBanners)", () => {
  it("accepts a 6:1 image-only carousel", () => {
    expect(() => loadCampusBanners(carousel())).not.toThrow();
  });

  it.each<[string, unknown]>([
    ["a non-object root", []],
    ["a section type other than banner_carousel", carousel({ type: "miniapp_grid" })],
    ["a missing id", carousel({ id: undefined })],
    ["the home default item", carousel({ items: [image(), { type: "default" }] })],
    ["a banner id equal to the carousel id", carousel({ items: [image({ id: "campus_banners" })] })],
    ["an aspect ratio above 6", carousel({ aspectRatio: 7 })],
    ["an image off the media bucket", carousel({ items: [image({ imageUrl: "https://evil.com/a.webp" })] })],
    ["an empty items list", carousel({ items: [] })],
  ])("rejects %s", (_label, raw) => {
    expect(() => loadCampusBanners(raw)).toThrow(/^campus banners: /);
  });
});

describe("getCampusSections", () => {
  const WINDOW = { startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-03T00:00:00+09:00" };

  function sectionsAt(iso: string, raw: Record<string, unknown>) {
    const banners = loadCampusBanners(raw) as CampusBannerCarouselRaw;
    return getCampusSections("ko", new Date(iso), banners).sections;
  }

  it("puts the carousel before the service tiles, in wire shape", () => {
    const sections = sectionsAt("2026-10-02T00:00:00+09:00", carousel({ items: [image(WINDOW)] }));
    expect(sections.map((s) => s.type)).toEqual(["banner_carousel", "button_grid"]);
    expect(sections[0]).toEqual({
      type: "banner_carousel",
      id: "campus_banners",
      aspectRatio: 6,
      autoRotateSec: 4,
      items: [{ type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: "현수막" }],
    });
  });

  it("drops the carousel once every banner is outside its window", () => {
    const sections = sectionsAt("2026-10-03T00:00:00+09:00", carousel({ items: [image(WINDOW)] }));
    expect(sections.map((s) => s.type)).toEqual(["button_grid"]);
  });
});

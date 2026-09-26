/**
 * Unit tests for the home layout: the boot-time guard (assertValidHomeLayout,
 * via loadHomeLayout) and the per-request resolution (resolveHomeLayout).
 *
 * The guard runs against OUR OWN config, so each rejection here is a deploy
 * that must not start. Mini-app ids are checked against the real registry.
 */
import { loadHomeLayout, resolveHomeLayout } from "../../../src/ui/home/home-layout";
import type { HomeLayoutRaw } from "../../../src/ui/home/home-layout.types";

const IMAGE_URL = "https://media.skkuverse.com/home/banners/test-00000000.jpg";

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "image",
    id: "banner-a",
    imageUrl: IMAGE_URL,
    alt: { ko: "배너", en: "Banner" },
    actionType: "miniapp",
    actionValue: "eskara-2026",
    ...overrides,
  };
}

function carousel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "banner_carousel",
    id: "home_top",
    aspectRatio: 2.25,
    autoRotateSec: 5,
    items: [image(), { type: "default" }],
    ...overrides,
  };
}

function grid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "tile_grid", id: "main", tiles: [{ kind: "miniapp", id: "mukja" }], ...overrides };
}

function link(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "link",
    id: "campus-map",
    title: { ko: "캠퍼스 지도", en: "Campus map" },
    icon: { kind: "emoji", emoji: "🗺️" },
    actionType: "route",
    actionValue: "/(tabs)/campus",
    ...overrides,
  };
}

const tiles = (...list: Record<string, unknown>[]) => grid({ tiles: list });

function layout(...sections: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, sections };
}

describe("committed home-layout.json", () => {
  it("loads, so the module import in this file did not throw", () => {
    const resolved = resolveHomeLayout("ko", new Date());
    expect(resolved.version).toBe(1);
    expect(resolved.sections.map((s) => s.type)).toContain("banner_carousel");
  });
});

describe("assertValidHomeLayout (via loadHomeLayout)", () => {
  it("accepts a well-formed layout", () => {
    expect(() => loadHomeLayout(layout(carousel(), grid()))).not.toThrow();
  });

  it("accepts every tile kind in one grid", () => {
    const mixed = tiles(
      { kind: "game", id: "wave-run" },
      { kind: "miniapp", id: "mukja" },
      link(),
      link({ id: "notice", icon: { kind: "media", url: IMAGE_URL }, actionType: "miniapp", actionValue: "inja" }),
    );
    expect(() => loadHomeLayout(layout(mixed))).not.toThrow();
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown root key", { ...layout(), extra: 1 }],
    ["a version other than 1", { version: 2, sections: [] }],
    ["an unknown section type", layout({ type: "hero", id: "x" })],
    ["a duplicate id across sections and banners", layout(carousel(), grid({ id: "banner-a" }))],
    ["an unknown carousel key", layout(carousel({ autoRotate: 5 }))],
    ["an aspect ratio below 1", layout(carousel({ aspectRatio: 0.5 }))],
    ["an aspect ratio given as a string", layout(carousel({ aspectRatio: "2.25" }))],
    ["a rotation of 1 second", layout(carousel({ autoRotateSec: 1 }))],
    ["a fractional rotation", layout(carousel({ autoRotateSec: 4.5 }))],
    ["an empty items list", layout(carousel({ items: [] }))],
    ["the default placed twice", layout(carousel({ items: [{ type: "default" }, { type: "default" }] }))],
    ["a key on the default item", layout(carousel({ items: [{ type: "default", id: "x" }] }))],
    ["an image off the media bucket", layout(carousel({ items: [image({ imageUrl: "https://evil.com/a.jpg" })] }))],
    ["an image with no ko alt", layout(carousel({ items: [image({ alt: { en: "Banner" } })] }))],
    ["an actionType without an actionValue", layout(carousel({ items: [image({ actionValue: undefined })] }))],
    ["an unregistered miniapp action", layout(carousel({ items: [image({ actionValue: "nope" })] }))],
    ["a relative external action", layout(carousel({ items: [image({ actionType: "external", actionValue: "/x" })] }))],
    ["an unknown action type", layout(carousel({ items: [image({ actionType: "map" })] }))],
    ["a window with no offset", layout(carousel({ items: [image({ endAt: "2026-10-03T00:00:00" })] }))],
    [
      "a window that ends before it starts",
      layout(carousel({ items: [image({ startAt: "2026-10-03T00:00:00+09:00", endAt: "2026-10-01T00:00:00+09:00" })] })),
    ],
    ["an unregistered mini app in a grid", layout(tiles({ kind: "miniapp", id: "nope" }))],
    ["an empty grid", layout(grid({ tiles: [] }))],
    ["the old miniAppIds key", layout(grid({ tiles: undefined, miniAppIds: ["mukja"] }))],
    ["one mini app in two grids", layout(grid(), grid({ id: "games" }))],
    ["one tile id under two kinds", layout(tiles({ kind: "miniapp", id: "mukja" }, link({ id: "mukja" })))],
    ["an unknown tile kind", layout(tiles({ kind: "screen", id: "campus" }))],
    ["a game id that is not a slug", layout(tiles({ kind: "game", id: "Wave Run" }))],
    ["an extra key on an id tile", layout(tiles({ kind: "game", id: "wave-run", title: { ko: "파도" } }))],
    ["a link with no title", layout(tiles(link({ title: undefined })))],
    ["a link with no action", layout(tiles(link({ actionType: undefined, actionValue: undefined })))],
    ["a link with a relative route", layout(tiles(link({ actionValue: "campus" })))],
    ["a link icon of two emoji", layout(tiles(link({ icon: { kind: "emoji", emoji: "🗺️🗺️" } })))],
    ["a link icon off the media bucket", layout(tiles(link({ icon: { kind: "media", url: "https://evil.com/a.png" } })))],
    ["a link icon in the registry's legacy path spelling", layout(tiles(link({ icon: { kind: "remote", path: "/a.png" } })))],
    ["a blank title", layout(grid({ title: { ko: " " } }))],
  ])("rejects %s", (_label, raw) => {
    expect(() => loadHomeLayout(raw)).toThrow(/^home layout: /);
  });
});

describe("resolveHomeLayout", () => {
  const WINDOW = {
    startAt: "2026-10-01T00:00:00+09:00",
    endAt: "2026-10-03T00:00:00+09:00",
  };

  function resolveAt(iso: string, raw: Record<string, unknown>, lang: "ko" | "en" | "zh" = "ko") {
    return resolveHomeLayout(lang, new Date(iso), loadHomeLayout(raw) as HomeLayoutRaw);
  }

  it("shows a windowed banner only inside [startAt, endAt)", () => {
    const raw = layout(carousel({ items: [image(WINDOW), { type: "default" }] }));
    const ids = (iso: string) =>
      (resolveAt(iso, raw).sections[0] as { items: { type: string }[] }).items.map((i) => i.type);

    expect(ids("2026-09-30T23:59:59+09:00")).toEqual(["default"]);
    expect(ids("2026-10-01T00:00:00+09:00")).toEqual(["image", "default"]);
    expect(ids("2026-10-03T00:00:00+09:00")).toEqual(["default"]);
  });

  it("keeps a carousel whose every image has expired, with no items", () => {
    const raw = layout(carousel({ items: [image(WINDOW)] }));
    expect(resolveAt("2026-10-05T00:00:00+09:00", raw).sections[0]).toMatchObject({
      type: "banner_carousel",
      items: [],
    });
  });

  it("resolves text to the request language, falling back to ko", () => {
    const raw = layout(carousel(), grid({ title: { ko: "미니게임", en: "Mini games" } }));
    const en = resolveAt("2026-09-25T00:00:00Z", raw, "en");
    const zh = resolveAt("2026-09-25T00:00:00Z", raw, "zh");
    expect(en.sections[1]).toMatchObject({ title: "Mini games" });
    expect((en.sections[0] as { items: { alt?: string }[] }).items[0]?.alt).toBe("Banner");
    expect(zh.sections[1]).toMatchObject({ title: "Mini games" });
  });

  it("ships no on-disk-only field", () => {
    const raw = layout(carousel({ items: [image(WINDOW)] }), grid());
    const wire = resolveAt("2026-10-01T12:00:00+09:00", raw);
    expect(wire.sections[0]).toEqual({
      type: "banner_carousel",
      id: "home_top",
      aspectRatio: 2.25,
      autoRotateSec: 5,
      items: [
        {
          type: "image",
          id: "banner-a",
          imageUrl: IMAGE_URL,
          alt: "배너",
          actionType: "miniapp",
          actionValue: "eskara-2026",
        },
      ],
    });
    expect(wire.sections[1]).toEqual({
      type: "tile_grid",
      id: "main",
      tiles: [{ kind: "miniapp", id: "mukja" }],
    });
  });

  it("resolves a link tile's title to the request language and its media icon to a uri", () => {
    const raw = layout(
      tiles(
        { kind: "game", id: "wave-run" },
        link({ icon: { kind: "media", url: IMAGE_URL } }),
      ),
    );
    expect(resolveAt("2026-09-25T00:00:00Z", raw, "en").sections[0]).toEqual({
      type: "tile_grid",
      id: "main",
      tiles: [
        { kind: "game", id: "wave-run" },
        {
          kind: "link",
          id: "campus-map",
          title: "Campus map",
          icon: { kind: "remote", uri: IMAGE_URL },
          actionType: "route",
          actionValue: "/(tabs)/campus",
        },
      ],
    });
  });
});

/**
 * The authoring reader's `detail` — the sheet body behind a pin.
 *
 * Stricter than the rest of the reader on purpose. Every other key a place
 * carries is either required or harmless when misspelled; a misspelled key in a
 * detail (`captoin`) imports clean and renders as nothing, which is exactly the
 * silent failure the detail was built to end. So every level refuses a key it
 * does not know, and every URL is checked against the rule the app or the
 * server will apply later — a URL that passes here and fails there is a button
 * or a photo that quietly does not exist.
 */

import fs from "fs";
import path from "path";
import { MEDIA_ORIGIN } from "../../../src/infra/origins";
import { isMediaUrl } from "../../../src/infra/media-url";
import {
  PLACE_BLOCK_TYPES,
  PLACE_DETAIL_ACTION_TYPES,
  PLACE_KINDS,
} from "../../../src/map/map-place-detail.types";
import { isAbsoluteHttpsUrl } from "../../../src/map/map-event-overlays.data";
import {
  isInstagramPostUrl,
  isInstagramProfileUrl,
} from "../../../src/map/map-event-details.data";
import { getLayerSetConfig } from "../../../src/map/map-layerset.config";
import { parseMiniAppTarget } from "../../../src/miniapps/miniapp-target";
import { presentationFor } from "../../../src/map/map-layerset.types";

// scripts/ is plain CommonJS excluded from tsconfig, so this is a require.
const reader = require("../../../scripts/lib/map-places-file");
const { parsePlacesFile } = reader;

const LAYER_SET_ID = "eskara-2026";
const REAL_FILE = path.join(__dirname, "../../../scripts/data/eskara-2026-places.json");
const PHOTO = `${MEDIA_ORIGIN}/eskara-2026/food-trucks/truck-x/01-abcdef12.jpg`;

function withDetail(detail: unknown) {
  const doc = {
    layerSetId: LAYER_SET_ID,
    campus: "nsc",
    places: [
      {
        id: "truck-x",
        category: "food",
        lat: 37.29542,
        lng: 126.971501,
        title: "오야봉",
        order: 20,
        detail,
      },
    ],
  };
  return parsePlacesFile(JSON.stringify(doc), { layerSetId: LAYER_SET_ID });
}

/** A detail with one of every block and both action types. */
function fullDetail(): Record<string, unknown> {
  return {
    kind: "foodTruck",
    org: "뉴플레이스컴퍼니",
    locationLabel: { ko: "푸드트럭존 1번", en: "Food truck 1" },
    actions: [
      {
        type: "instagram",
        id: "insta",
        label: "인스타",
        profileUrl: "https://www.instagram.com/skku_speak",
        postUrl: "https://www.instagram.com/p/ABC123",
      },
      { type: "link", id: "guide", label: "안내", url: "https://eskara.miniapp.skkuverse.com/eskara/entry" },
    ],
    blocks: [
      { type: "table", id: "menu", rows: [{ label: "닭꼬치", value: "5,000원" }] },
      { type: "image", id: "photo-1", url: PHOTO, caption: "닭꼬치" },
      { type: "text", id: "intro", title: "소개", body: "숯불에 굽습니다." },
      { type: "list", id: "games", items: [{ emoji: "🎯", title: "다트", description: "3번 던지기" }, { title: "퀴즈" }] },
      { type: "notice", id: "pay", items: ["현금 가능", { ko: "카드 가능", en: "Cards OK" }] },
    ],
  };
}

describe("parsePlacesFile — detail", () => {
  it("stores null when a place has no detail, so the key is always present", () => {
    const { docs, errors } = withDetail(undefined);
    expect(errors).toEqual([]);
    expect(docs[0].detail).toBeNull();
  });

  it("reads a full detail, filling every optional value with an explicit null", () => {
    const { docs, errors } = withDetail(fullDetail());

    expect(errors).toEqual([]);
    expect(docs[0].detail).toEqual({
      kind: "foodTruck",
      org: { ko: "뉴플레이스컴퍼니" },
      // Absent, so false — stated, never undefined.
      isUnion: false,
      locationLabel: { ko: "푸드트럭존 1번", en: "Food truck 1" },
      actions: [
        {
          type: "instagram",
          id: "insta",
          label: { ko: "인스타" },
          profileUrl: "https://www.instagram.com/skku_speak",
          postUrl: "https://www.instagram.com/p/ABC123",
        },
        {
          type: "link",
          id: "guide",
          label: { ko: "안내" },
          url: "https://eskara.miniapp.skkuverse.com/eskara/entry",
        },
      ],
      blocks: [
        { type: "table", id: "menu", title: null, rows: [{ label: { ko: "닭꼬치" }, value: { ko: "5,000원" } }] },
        { type: "image", id: "photo-1", title: null, url: PHOTO, caption: { ko: "닭꼬치" } },
        { type: "text", id: "intro", title: { ko: "소개" }, body: { ko: "숯불에 굽습니다." } },
        {
          type: "list",
          id: "games",
          title: null,
          items: [
            { emoji: "🎯", title: { ko: "다트" }, description: { ko: "3번 던지기" } },
            { emoji: null, title: { ko: "퀴즈" }, description: null },
          ],
        },
        {
          type: "notice",
          id: "pay",
          title: null,
          items: [{ ko: "현금 가능" }, { ko: "카드 가능", en: "Cards OK" }],
        },
      ],
    });
  });

  it("writes no undefined anywhere, so a re-import compares equal", () => {
    // BSON stores undefined as null, so an undefined here would differ from its
    // own stored copy on every import and stamp every place as changed forever.
    const { docs } = withDetail(fullDetail());
    const walk = (v: unknown): void => {
      expect(v).not.toBeUndefined();
      if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(docs[0].detail);
  });

  it("keeps the whole place out when its detail is bad — one verdict per place", () => {
    const { docs, errors } = withDetail({ kind: "truck" });
    expect(docs).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  const rejections: [string, unknown, RegExp][] = [
    ["a detail that is not an object", ["foodTruck"], /detail must be an object/],
    ["a missing kind", { blocks: [] }, /kind must be one of/],
    ["an unknown kind", { kind: "truck" }, /kind must be one of/],
    ["isUnion written as a string", { kind: "booth", isUnion: "true" }, /isUnion must be true or false/],
    ["an unknown key on the detail", { kind: "booth", orgName: "x" }, /orgName is not a known key/],
    ["an unknown block type", { kind: "booth", blocks: [{ type: "video", id: "v" }] }, /type must be one of/],
    ["a block with no id", { kind: "booth", blocks: [{ type: "text", body: "x" }] }, /id must be a non-empty string/],
    [
      "two blocks sharing an id",
      { kind: "booth", blocks: [{ type: "text", id: "a", body: "x" }, { type: "text", id: "a", body: "y" }] },
      /"a" is used twice/,
    ],
    ["a misspelled optional key", { kind: "booth", blocks: [{ type: "image", id: "p", url: PHOTO, captoin: "x" }] }, /captoin is not a known key/],
    ["a text block with no body", { kind: "booth", blocks: [{ type: "text", id: "t" }] }, /body/],
    ["an empty table", { kind: "booth", blocks: [{ type: "table", id: "m", rows: [] }] }, /rows must be a non-empty array/],
    ["a table row with no value", { kind: "booth", blocks: [{ type: "table", id: "m", rows: [{ label: "x" }] }] }, /value/],
    ["an empty list", { kind: "booth", blocks: [{ type: "list", id: "l", items: [] }] }, /items must be a non-empty array/],
    ["a list item with no title", { kind: "booth", blocks: [{ type: "list", id: "l", items: [{ emoji: "🎯" }] }] }, /title/],
    ["a blank emoji", { kind: "booth", blocks: [{ type: "list", id: "l", items: [{ emoji: " ", title: "x" }] }] }, /emoji/],
    ["an empty notice", { kind: "booth", blocks: [{ type: "notice", id: "n", items: [] }] }, /items must be a non-empty array/],
    ["an unknown action type", { kind: "booth", actions: [{ type: "call", id: "c", label: "x" }] }, /type must be one of/],
    ["a relative link", { kind: "booth", actions: [{ type: "link", id: "l", label: "x", url: "/eskara/entry" }] }, /absolute https/],
    ["an http link", { kind: "booth", actions: [{ type: "link", id: "l", label: "x", url: "http://skku.edu/" }] }, /absolute https/],
    [
      "an Instagram profile that is a post",
      { kind: "booth", actions: [{ type: "instagram", id: "i", label: "x", profileUrl: "https://www.instagram.com/p/ABC" }] },
      /profileUrl/,
    ],
    [
      "an Instagram post that is a profile",
      {
        kind: "booth",
        actions: [
          { type: "instagram", id: "i", label: "x", profileUrl: "https://www.instagram.com/a", postUrl: "https://www.instagram.com/b" },
        ],
      },
      /postUrl/,
    ],
    [
      "two instagram actions",
      {
        kind: "booth",
        actions: [
          { type: "instagram", id: "a", label: "x", profileUrl: "https://www.instagram.com/a" },
          { type: "instagram", id: "b", label: "y", profileUrl: "https://www.instagram.com/b" },
        ],
      },
      /more than one instagram/,
    ],
  ];

  it.each(rejections)("rejects %s", (_name, detail, message) => {
    const { docs, errors } = withDetail(detail);
    expect(docs).toEqual([]);
    expect(errors.join(" ")).toMatch(message);
  });

  it("names every problem in one run, not the first", () => {
    const { errors } = withDetail({
      kind: "booth",
      blocks: [
        { type: "text", id: "t" },
        { type: "image", id: "p", url: "https://example.com/a.jpg" },
      ],
    });
    expect(errors).toHaveLength(2);
  });

  it.each([
    ["plain http", `http://media.skkuverse.com/a.jpg`],
    ["another host", "https://i.imgur.com/a.jpg"],
    ["a lookalike suffix", `${MEDIA_ORIGIN}.evil.com/a.jpg`],
    ["userinfo", "https://media.skkuverse.com@evil.com/a.jpg"],
    ["a trailing newline", `${PHOTO}\n`],
    ["the bare origin", `${MEDIA_ORIGIN}/`],
  ])("rejects an image on %s", (_name, url) => {
    const { errors } = withDetail({ kind: "booth", blocks: [{ type: "image", id: "p", url }] });
    expect(errors.join(" ")).toMatch(/must be an object on https:\/\/media\.skkuverse\.com/);
  });
});

describe("the importer's copies agree with the server", () => {
  // scripts/ cannot import TypeScript, so the reader holds copies. These pin
  // each copy to its source; the serve path re-checks every URL anyway, so a
  // drift that slips past here drops a block rather than shipping a bad URL.
  it("holds the same constants", () => {
    expect(reader.MEDIA_ORIGIN).toBe(MEDIA_ORIGIN);
    expect(reader.PLACE_KINDS).toEqual([...PLACE_KINDS]);
    expect(reader.BLOCK_TYPES).toEqual([...PLACE_BLOCK_TYPES]);
    expect(reader.DETAIL_ACTION_TYPES).toEqual([...PLACE_DETAIL_ACTION_TYPES]);
  });

  const URLS = [
    PHOTO,
    `${MEDIA_ORIGIN}:443/a.jpg`,
    "https://MEDIA.SKKUVERSE.COM/a.jpg",
    `${MEDIA_ORIGIN}/a.jpg#x`,
    `${MEDIA_ORIGIN}/`,
    `${MEDIA_ORIGIN}`,
    `${MEDIA_ORIGIN}.evil.com/a.jpg`,
    "https://u:p@media.skkuverse.com/a.jpg",
    "http://media.skkuverse.com/a.jpg",
    `${PHOTO} `,
    "https://www.instagram.com/skku_speak",
    "https://instagram.com/skku_speak/",
    "https://www.instagram.com/p/ABC123",
    "https://www.instagram.com/reel/ABC123/",
    "https://www.instagram.com/explore",
    "https://www.instagram.com/p",
    "https://www.instagram.com/a/b/c",
    "http://www.instagram.com/skku_speak",
    "https://instagram.com.evil.com/skku_speak",
    "https://eskara.miniapp.skkuverse.com/eskara/entry",
    "/relative",
    "",
  ];

  it.each([
    ["isMediaUrl", reader.isMediaUrl, isMediaUrl],
    ["isAbsoluteHttpsUrl", reader.isAbsoluteHttpsUrl, isAbsoluteHttpsUrl],
    ["isInstagramProfileUrl", reader.isInstagramProfileUrl, isInstagramProfileUrl],
    ["isInstagramPostUrl", reader.isInstagramPostUrl, isInstagramPostUrl],
  ])("%s gives the same verdict on every URL", (_name, copy, source) => {
    for (const url of URLS) {
      expect([url, copy(url)]).toEqual([url, (source as (v: unknown) => boolean)(url)]);
    }
  });

  it("parseMiniAppTarget gives the same parse on every value", () => {
    const TARGETS = [
      ...URLS,
      "eskara-2026",
      "eskara-2026/",
      "eskara-2026/eskara/wristband",
      "eskara-2026/eskara/lineup?day=2#top",
      "eskara-2026//evil.com",
      "eskara-2026/\\evil.com",
      "eskara-2026/a b",
      "eskara-2026/x\n",
      "Eskara-2026/x",
      "eskara_2026/x",
      "/eskara-2026/x",
      "eskara-2026?x=1",
    ];
    for (const value of TARGETS) {
      expect([value, reader.parseMiniAppTarget(value)]).toEqual([value, parseMiniAppTarget(value)]);
    }
  });
});

describe("the committed sheet's food trucks", () => {
  const { docs } = parsePlacesFile(fs.readFileSync(REAL_FILE, "utf8"), {
    layerSetId: LAYER_SET_ID,
  });
  const trucks = docs.filter((d: { _id: string }) => d._id.startsWith(`${LAYER_SET_ID}-truck-`));
  const detailed = docs.filter((d: { detail: unknown }) => d.detail !== null);

  it("gives every truck a food-truck detail that opens on its menu", () => {
    expect(trucks.length).toBeGreaterThan(0);
    for (const t of trucks) {
      expect([t._id, t.detail?.kind]).toEqual([t._id, "foodTruck"]);
      // First, because the sheet lifts the first table into the collapsed card.
      expect([t._id, t.detail.blocks[0]?.type]).toEqual([t._id, "table"]);
      expect(t.detail.blocks[0].rows.length).toBeGreaterThan(0);
    }
  });

  it("puts every image on the media host, by the SERVER's rule", () => {
    // The reader already checked with its copy; this checks with the source, so
    // a drifted copy cannot let the committed sheet through with a URL the
    // server would drop.
    for (const d of detailed) {
      for (const b of d.detail.blocks.filter((x: { type: string }) => x.type === "image")) {
        expect([d._id, b.url, isMediaUrl(b.url)]).toEqual([d._id, b.url, true]);
      }
    }
  });

  it("gives a detail only to places a tap can reach", () => {
    // A detail on an inert category is served to no one — the pin has no tap.
    const loaded = getLayerSetConfig(LAYER_SET_ID);
    if (!loaded?.config) throw new Error(`${LAYER_SET_ID} failed to load: ${loaded?.error}`);
    for (const d of detailed) {
      expect([d._id, presentationFor(loaded.config, d.category).interactive]).toEqual([d._id, true]);
    }
  });
});

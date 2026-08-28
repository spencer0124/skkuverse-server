/**
 * The chip contract served inside GET /map/config.
 *
 * Two kinds of assertion here, and they fail for different reasons:
 *
 *  - The SHIPPED lists are checked against the same rules the boot-time
 *    validator enforces. Those can only fail if someone edits a chip, and they
 *    fail in CI rather than at deploy.
 *  - `validateChipSpecs` is exercised with deliberately broken input, because
 *    the shipped lists being correct proves nothing about whether a wrong one
 *    would be caught.
 *
 * The label assertions are the important ones. `t()` returns the KEY on a miss
 * — no throw, no log — so a chip whose i18n key is missing ships
 * "map.chip.foo" as its visible label. The layer suite already guards its half
 * of this; chips need the same, in all three languages.
 */

import { WEBVIEW_ORIGIN } from "../../../src/infra/origins";
import { ESKARA26_LAYERS } from "../../../src/map/map-eskara26-markers.data";
import { chipGroupOf } from "../../../src/map/map-layers.data";
import {
  BASE_CHIPS,
  ESKARA26_CHIPS,
  getChips,
  validateChipSpecs,
  type MapChipSpec,
} from "../../../src/map/map-chips.data";

const LANGS = ["ko", "en", "zh"] as const;

/** Broken input has to bypass the compile-time MapLayerId check on purpose. */
const asSpecs = (specs: unknown): MapChipSpec[] => specs as MapChipSpec[];

describe("chip lists", () => {
  it("ships at least one festival chip", () => {
    // Guards every `for (const chip of ...)` below against vacuous truth. Only
    // the festival list is asserted non-empty: every loop below reads
    // getChips(lang, true), which is the festival-inclusive row.
    expect(ESKARA26_CHIPS.length).toBeGreaterThan(0);
  });

  it("serves no chip row at all off-season", () => {
    // BASE_CHIPS being empty is a decision, not an oversight — 분실물 was
    // removed and the campus SDUI still carries that action. Asserting the
    // count means putting a permanent chip back has to be deliberate.
    expect(BASE_CHIPS).toHaveLength(0);
  });

  it("has no duplicate chip id across the two lists", () => {
    const ids = [...BASE_CHIPS, ...ESKARA26_CHIPS].map((chip) => chip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getChips", () => {
  it("serves only the base chips when no festival is live", () => {
    const chips = getChips("ko", false);
    expect(chips).toHaveLength(BASE_CHIPS.length);
    // A festival chip lingering out of season is the dead-toggle failure the
    // layer set already avoids; chips must inherit the same lever.
    for (const chip of chips) {
      expect(ESKARA26_CHIPS.some((spec) => spec.id === chip.id)).toBe(false);
    }
  });

  it("adds the festival chips while one is live", () => {
    const chips = getChips("ko", true);
    expect(chips).toHaveLength(BASE_CHIPS.length + ESKARA26_CHIPS.length);
  });

  it.each(LANGS)("resolves every chip label in %s", (lang) => {
    const chips = getChips(lang, true);
    for (const chip of chips) {
      // t() hands back the key on a miss, so this is the only thing standing
      // between a forgotten translation and a chip labelled "map.chip.foo".
      expect(chip.label).not.toMatch(/^map\.chip\./);
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every chip an icon and a known action kind", () => {
    for (const chip of getChips("ko", true)) {
      expect(chip.icon).not.toBeNull();
      expect(["webview", "focus"]).toContain(chip.action.kind);
    }
  });
});

describe("focus actions", () => {
  const focusChips = () =>
    getChips("ko", true).filter((chip) => chip.action.kind === "focus");

  it("names layers that all resolve to one non-null chip group", () => {
    const chips = focusChips();
    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      if (chip.action.kind !== "focus") continue;
      const groups = new Set(
        chip.action.layerIds.map((layerId) => chipGroupOf(layerId)),
      );
      expect(groups.size).toBe(1);
      const group = [...groups][0];
      // undefined = not a layer at all; null = a layer no chip may touch.
      expect(group).not.toBeUndefined();
      expect(group).not.toBeNull();
    }
  });

  it("the reset chip restores the default set, not literally every layer", () => {
    const all = getChips("ko", true).find((c) => c.id === "eskara26_view_all");
    expect(all).toBeDefined();
    if (all!.action.kind !== "focus") throw new Error("expected a focus chip");

    const expected = ESKARA26_LAYERS.filter((l) => l.defaultVisible).map((l) => l.id);
    expect([...all!.action.layerIds].sort()).toEqual([...expected].sort());

    // The bug this guards: naming every festival layer makes "축제 전체" turn
    // ON eskara26_facility, which ships defaultVisible: false. The user would
    // land on a map carrying a layer they never opted into, with no chip left
    // that gets back to the ordinary festival view.
    expect(all!.action.layerIds).not.toContain("eskara26_facility");
    expect(ESKARA26_LAYERS.find((l) => l.id === "eskara26_facility")!.defaultVisible).toBe(
      false,
    );
  });

  it("sends a complete camera, coordinates inside Korea", () => {
    for (const chip of focusChips()) {
      if (chip.action.kind !== "focus") continue;
      const { lat, lng, zoom, tilt, bearing, durationMs } = chip.action.camera;
      // A [lng, lat] swap lands in the ocean, so the bound is worth stating.
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThan(33);
      expect(lng).toBeGreaterThan(124);
      expect(zoom).toBeGreaterThan(0);
      expect(tilt).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(durationMs).toBeGreaterThan(0);
    }
  });
});

describe("webview actions", () => {
  it("resolves every webview URL to an absolute one on our own origin", () => {
    const chips = getChips("ko", true).filter(
      (chip) => chip.action.kind === "webview",
    );
    // None ship today — 분실물 was the only one. The count is asserted rather
    // than the loop simply left to run empty, so this cannot rot into a
    // silently vacuous test: adding a webview chip fails here, and the
    // assertions below are already waiting for it. The rule itself lives in
    // toWebviewUrl and is unit-tested in __tests__/nest/infra/webview-url.test.ts.
    expect(chips).toHaveLength(0);

    for (const chip of chips) {
      if (chip.action.kind !== "webview") continue;
      // toWebviewUrl resolves the authored root-relative path, so the client
      // only ever sees a complete URL — never a relative string handed to an
      // opener.
      expect(chip.action.url.startsWith(`${WEBVIEW_ORIGIN}/`)).toBe(true);
      expect(new URL(chip.action.url).origin).toBe(WEBVIEW_ORIGIN);
    }
  });
});

describe("validateChipSpecs", () => {
  const focusSpec = (layerIds: readonly string[]): unknown => ({
    id: "test_chip",
    emoji: "\u{1F3AF}",
    action: {
      kind: "focus",
      camera: { lat: 37.29, lng: 126.97, zoom: 17, tilt: 0, bearing: 0, durationMs: 500 },
      layerIds,
    },
  });

  it("accepts the lists this server actually ships", () => {
    expect(() => validateChipSpecs([...BASE_CHIPS, ...ESKARA26_CHIPS])).not.toThrow();
  });

  it("rejects a layer id that is not a layer", () => {
    expect(() => validateChipSpecs(asSpecs([focusSpec(["eskara26_ghost"])]))).toThrow(
      /eskara26_ghost/,
    );
  });

  it("rejects a layer no chip may reach", () => {
    // building_numbers is chipGroupId: null — the whole point of the flag.
    expect(() => validateChipSpecs(asSpecs([focusSpec(["building_numbers"])]))).toThrow(
      /building_numbers/,
    );
  });

  it("rejects layer ids straddling two chip groups", () => {
    // Nothing shares a group with a festival layer today, so the cross-group
    // case is built by pairing one with a null-group layer: both rules would
    // reject it, and the message must name the group problem specifically once
    // a second group exists. Asserting the throw is what matters here.
    expect(() =>
      validateChipSpecs(asSpecs([focusSpec(["eskara26_stage", "building_labels"])])),
    ).toThrow();
  });

  it("rejects a webview URL that does not land on our origin", () => {
    expect(() =>
      validateChipSpecs(
        asSpecs([
          {
            id: "evil",
            emoji: "\u{1F6A9}",
            action: { kind: "webview", url: "https://evil.com/x" },
          },
        ]),
      ),
    ).toThrow(/evil\.com/);
  });

  it("rejects a webview URL whose fragment never reaches the origin", () => {
    // `/eskara#/entry` keeps a real pathname, so an origin-and-path check waves
    // it through while the user lands on the wrong page. toWebviewUrl is the
    // one place that rule lives; this proves chips go through it.
    expect(() =>
      validateChipSpecs(
        asSpecs([
          {
            id: "fragment",
            emoji: "\u{1F6A9}",
            action: { kind: "webview", url: "/eskara#/entry" },
          },
        ]),
      ),
    ).toThrow(/eskara/);
  });

  it("rejects a duplicate chip id", () => {
    expect(() =>
      validateChipSpecs(asSpecs([focusSpec(["eskara26_stage"]), focusSpec(["eskara26_bar"])])),
    ).toThrow(/test_chip/);
  });
});

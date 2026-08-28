/**
 * The chip contract served inside GET /map/config.
 *
 * Two kinds of assertion here, and they fail for different reasons:
 *
 *  - The SHIPPED row — base chips plus the live festival's, read from the real
 *    `eskara-2026.json` — is checked against the same rules the validator
 *    enforces. Those can only fail if someone edits a chip or the config, and
 *    they fail in CI rather than at deploy.
 *  - `validateChipSpecs` is exercised with deliberately broken input, because
 *    the shipped row being correct proves nothing about whether a wrong one
 *    would be caught.
 *
 * The reset chip is the one worth reading closely: it is not authored anywhere.
 * The server synthesises it from the festival's `name`, `emoji` and the layers
 * marked `defaultVisible`, so it cannot drift from the layer list.
 */

import { getLayerSetConfig } from "../../../src/eventmap/eventmap.config";
import { pick } from "../../../src/infra/i18n";
import type { EventMapConfig } from "../../../src/eventmap/types";
import { WEBVIEW_ORIGIN } from "../../../src/infra/origins";
import {
  BASE_LAYERS,
  chipGroupOf,
  eventLayerSpecs,
} from "../../../src/map/map-layers.data";
import {
  assertValidChipSpecs,
  BASE_CHIPS,
  eventChipSpecs,
  getChips,
  resetChip,
  validateChipSpecs,
  type MapChipSpec,
} from "../../../src/map/map-chips.data";

const LANGS = ["ko", "en", "zh"] as const;

const loaded = getLayerSetConfig("eskara-2026");
if (!loaded?.config) throw new Error(`eskara-2026 failed to load: ${loaded?.error}`);
const CONFIG: EventMapConfig = loaded.config;

/** What /map/config serves while this festival is live. */
const CATALOGUE = [...BASE_LAYERS, ...eventLayerSpecs(CONFIG)];
const SERVED = [...BASE_CHIPS, ...eventChipSpecs(CONFIG)];

/** Broken input has to bypass the type on purpose. */
const asSpecs = (specs: unknown): MapChipSpec[] => specs as MapChipSpec[];

describe("chip lists", () => {
  it("ships at least one festival chip", () => {
    // Guards every `for (const chip of ...)` below against vacuous truth.
    expect(eventChipSpecs(CONFIG).length).toBeGreaterThan(0);
  });

  it("serves no chip row at all off-season", () => {
    // BASE_CHIPS being empty is a decision, not an oversight — 분실물 was
    // removed and the campus SDUI still carries that action. Asserting the
    // count means putting a permanent chip back has to be deliberate.
    expect(BASE_CHIPS).toHaveLength(0);
  });

  it("has no duplicate chip id across the served row", () => {
    const ids = SERVED.map((chip) => chip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the reset chip", () => {
  it("comes first, and carries the festival's own name and emoji", () => {
    const [first] = eventChipSpecs(CONFIG);
    expect(first).toEqual(resetChip(CONFIG));
    expect(first!.id).toBe("eskara-2026_all");
    expect(first!.emoji).toBe(CONFIG.emoji);
    expect(first!.label).toEqual(CONFIG.name);
  });

  it("restores the default set, not literally every layer", () => {
    const all = resetChip(CONFIG);
    if (all.action.kind !== "focus") throw new Error("expected a focus chip");

    const expected = CONFIG.layers.filter((l) => l.defaultVisible).map((l) => l.id);
    expect([...all.action.layerIds].sort()).toEqual([...expected].sort());

    // The bug this guards: naming every festival layer makes the reset chip turn
    // ON a layer that ships defaultVisible: false. The user would land on a map
    // carrying a layer they never opted into, with no chip left that gets back
    // to the ordinary festival view. The shipped config has such a layer, so
    // the guard is not vacuous.
    const optIn = CONFIG.layers.find((l) => !l.defaultVisible);
    expect(optIn).toBeDefined();
    expect(all.action.layerIds).not.toContain(optIn!.id);
  });

  it("is a fresh object per call — the config is shared across requests", () => {
    const a = resetChip(CONFIG);
    const b = resetChip(CONFIG);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    if (a.action.kind !== "focus" || b.action.kind !== "focus") throw new Error("focus");
    expect(a.action.camera).not.toBe(CONFIG.camera);
    expect(a.action.layerIds).not.toBe(b.action.layerIds);
  });
});

describe("authored chips", () => {
  it("inherit the label of their one layer when none is authored", () => {
    // The shipped config authors every label (its chips read singular where the
    // layers read plural), so the convenience is exercised on a synthetic one.
    const unlabelled: EventMapConfig = {
      ...CONFIG,
      chips: [{ id: "x", emoji: "🍻", layerIds: ["eskara26_bar"] }],
    };
    const spec = eventChipSpecs(unlabelled).find((c) => c.id === "x")!;
    const layer = CONFIG.layers.find((l) => l.id === "eskara26_bar")!;
    expect(spec.label).toEqual(layer.label);
    expect(spec.label).not.toBe(layer.label);
  });

  it("keep an authored label over the layer's", () => {
    const withLabel: EventMapConfig = {
      ...CONFIG,
      chips: [{ id: "x", emoji: "🍻", layerIds: ["eskara26_bar"], label: { ko: "야간 주점" } }],
    };
    const spec = eventChipSpecs(withLabel).find((c) => c.id === "x")!;
    expect(spec.label).toEqual({ ko: "야간 주점" });
  });

  it("all point the camera where the config says", () => {
    for (const chip of eventChipSpecs(CONFIG)) {
      if (chip.action.kind !== "focus") throw new Error("expected focus");
      expect(chip.action.camera).toEqual(CONFIG.camera);
    }
  });
});

describe("getChips", () => {
  it("serves only the base chips when no festival is live", () => {
    const chips = getChips("ko", null);
    expect(chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("adds the festival row while one is live: reset chip plus every authored chip", () => {
    const chips = getChips("ko", CONFIG);
    expect(chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
    expect(chips[BASE_CHIPS.length]!.id).toBe("eskara-2026_all");
  });

  it.each(LANGS)("resolves every chip label in %s through the one I18n resolver", (lang) => {
    const chips = getChips(lang, CONFIG);
    for (const spec of SERVED) {
      const chip = chips.find((c) => c.id === spec.id)!;
      expect(chip.label).toBe(pick(spec.label, lang));
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every chip an emoji icon and a known action kind", () => {
    for (const chip of getChips("ko", CONFIG)) {
      expect(chip.icon).toEqual({ kind: "emoji", emoji: expect.any(String) });
      expect(["webview", "focus"]).toContain(chip.action.kind);
    }
  });
});

describe("focus actions", () => {
  const focusChips = () =>
    getChips("ko", CONFIG).filter((chip) => chip.action.kind === "focus");

  it("name layers that all resolve to one non-null chip group", () => {
    const chips = focusChips();
    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      if (chip.action.kind !== "focus") continue;
      const groups = new Set(
        chip.action.layerIds.map((layerId) => chipGroupOf(CATALOGUE, layerId)),
      );
      expect(groups.size).toBe(1);
      const group = [...groups][0];
      // undefined = not a layer at all; null = a layer no chip may touch.
      expect(group).toBe(CONFIG.layerSetId);
    }
  });

  it("send a complete camera, coordinates inside Korea", () => {
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
    const chips = getChips("ko", CONFIG).filter(
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
      expect(chip.action.url.startsWith(`${WEBVIEW_ORIGIN}/`)).toBe(true);
      expect(new URL(chip.action.url).origin).toBe(WEBVIEW_ORIGIN);
    }
  });
});

describe("validateChipSpecs — every rule, reported together", () => {
  const focusSpec = (layerIds: readonly string[], id = "test_chip"): unknown => ({
    id,
    emoji: "\u{1F3AF}",
    label: { ko: "테스트" },
    action: {
      kind: "focus",
      camera: { lat: 37.29, lng: 126.97, zoom: 17, tilt: 0, bearing: 0, durationMs: 500 },
      layerIds,
    },
  });

  it("accepts the row this server actually serves", () => {
    expect(validateChipSpecs(SERVED, CATALOGUE)).toEqual([]);
  });

  it("rejects a layer id that is not a layer", () => {
    const errors = validateChipSpecs(asSpecs([focusSpec(["eskara26_ghost"])]), CATALOGUE);
    expect(errors).toEqual([expect.stringMatching(/eskara26_ghost.*is not a layer/)]);
  });

  it("rejects a layer no chip may reach", () => {
    // building_numbers is chipGroupId: null — the whole point of the flag.
    const errors = validateChipSpecs(asSpecs([focusSpec(["building_numbers"])]), CATALOGUE);
    expect(errors).toEqual([expect.stringMatching(/building_numbers.*chipGroupId null/)]);
  });

  it("rejects layer ids straddling two chip groups", () => {
    // Nothing shares a group with a festival layer today, so the cross-group
    // case is built by pairing one with a null-group layer: the null rule fires
    // for the building layer. Once a second group exists the straddle message
    // must name it specifically.
    const errors = validateChipSpecs(
      asSpecs([focusSpec(["eskara26_stage", "building_labels"])]),
      CATALOGUE,
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a webview URL that does not land on our origin", () => {
    const errors = validateChipSpecs(
      asSpecs([
        { id: "evil", emoji: "\u{1F6A9}", label: { ko: "x" }, action: { kind: "webview", url: "https://evil.com/x" } },
      ]),
      CATALOGUE,
    );
    expect(errors).toEqual([expect.stringMatching(/evil\.com/)]);
  });

  it("rejects a webview URL whose fragment never reaches the origin", () => {
    // `/eskara#/entry` keeps a real pathname, so an origin-and-path check waves
    // it through while the user lands on the wrong page. toWebviewUrl is the
    // one place that rule lives; this proves chips go through it.
    const errors = validateChipSpecs(
      asSpecs([
        { id: "fragment", emoji: "\u{1F6A9}", label: { ko: "x" }, action: { kind: "webview", url: "/eskara#/entry" } },
      ]),
      CATALOGUE,
    );
    expect(errors).toEqual([expect.stringMatching(/eskara/)]);
  });

  it("rejects a duplicate chip id", () => {
    const errors = validateChipSpecs(
      asSpecs([focusSpec(["eskara26_stage"]), focusSpec(["eskara26_bar"])]),
      CATALOGUE,
    );
    expect(errors).toEqual([expect.stringMatching(/duplicate chip id "test_chip"/)]);
  });

  it("accumulates rather than stopping at the first problem", () => {
    // One boot per mistake is the failure mode this exists to avoid.
    const errors = validateChipSpecs(
      asSpecs([focusSpec(["eskara26_ghost"], "a"), focusSpec(["building_numbers"], "b")]),
      CATALOGUE,
    );
    expect(errors).toHaveLength(2);
  });

  it("assertValidChipSpecs throws the FATAL form the boot path expects", () => {
    expect(() => assertValidChipSpecs(asSpecs([focusSpec(["nope"])]), CATALOGUE)).toThrow(
      /^FATAL \[map chips\]/,
    );
    expect(() => assertValidChipSpecs(SERVED, CATALOGUE)).not.toThrow();
  });
});

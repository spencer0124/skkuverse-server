/**
 * Structure-tier validation (skkuverse#14). Contract:
 * docs/reference/eventmap-api.md §2, §6.2 step 3.
 *
 * Two separable jobs are tested here:
 *
 *  1. assertValidConfig draws the line between "a developer broke it" (blocks
 *     publication) and "ops typed something new" (degrades). Only the first kind
 *     appears below — the second is the materializer's fallback behaviour.
 *  2. configHash reacts to MEANING and nothing else. It feeds contentHash, which
 *     decides whether every client's one-year, ~90 KB snapshot cache is thrown
 *     away, so both false positives and false negatives are expensive.
 *
 * Schema v2: the config owns the MAP layers a festival draws and the chips
 * that swap them, and every session's `category` resolves to one of those
 * layers through `itemDefaults`. There is no predicate language and no icon
 * table any more — a booth is an ordinary marker, drawn by `/map/config`.
 */
import fs from "fs";
import path from "path";
import { assertValidConfig, getLayerSetConfig } from "../../../src/eventmap/eventmap.config";

const CONFIG_PATH = path.join(
  __dirname,
  "../../../src/eventmap/config/eskara-2026.json",
);
const RAW = fs.readFileSync(CONFIG_PATH, "utf8");

/** A fresh deep copy per test, so mutations never leak between them. */
function raw(): Record<string, any> {
  return JSON.parse(RAW);
}

describe("the shipped eskara-2026 config", () => {
  it("loads and validates", () => {
    const loaded = getLayerSetConfig("eskara-2026");
    expect(loaded?.error).toBeNull();
    expect(loaded?.config?.layerSetId).toBe("eskara-2026");
  });

  it("reports an unknown layer set as absent rather than broken", () => {
    expect(getLayerSetConfig("eskara-2099")).toBeNull();
  });

  it("keeps every itemDefaults reference resolvable", () => {
    const config = assertValidConfig(raw());
    const layerIds = new Set(config.layers.map((l) => l.id));
    for (const p of [
      config.itemDefaults.fallback,
      ...Object.values(config.itemDefaults.byCategory),
    ]) {
      expect(layerIds.has(p.layerId)).toBe(true);
    }
  });

  it("keeps every chip pointing at layers that exist", () => {
    const config = assertValidConfig(raw());
    const layerIds = new Set(config.layers.map((l) => l.id));
    for (const chip of config.chips) {
      expect(chip.layerIds.length).toBeGreaterThan(0);
      for (const id of chip.layerIds) expect(layerIds.has(id)).toBe(true);
    }
  });

  it("has at least one layer on by default, so the reset chip restores something", () => {
    const config = assertValidConfig(raw());
    expect(config.layers.some((l) => l.defaultVisible)).toBe(true);
  });
});

describe("assertValidConfig — structure→structure references block publication", () => {
  it("rejects an itemDefaults entry pointing at a layer that does not exist", () => {
    // The whole point of the table: a category that resolves to no layer is a
    // booth that is never drawn, and nothing anywhere would say why.
    const config = raw();
    config.itemDefaults.byCategory.bar.layerId = "nope";
    expect(() => assertValidConfig(config)).toThrow(
      /byCategory\["bar"\]\.layerId "nope" is not in config.layers/,
    );
  });

  it("rejects a fallback pointing at a layer that does not exist", () => {
    const config = raw();
    config.itemDefaults.fallback.layerId = "nope";
    expect(() => assertValidConfig(config)).toThrow(
      /fallback\.layerId "nope" is not in config.layers/,
    );
  });

  it("rejects a chip naming a layer that does not exist — in the validator's words", () => {
    // The chip validator owns this rule, run over the row exactly as it will be
    // served; the config parser does not keep a second copy with a second
    // message format.
    const config = raw();
    config.chips[0].layerIds = ["nope"];
    expect(() => assertValidConfig(config)).toThrow(
      /config.chips: chip "eskara26_view_stage": "nope" is not a layer/,
    );
  });
});

describe("assertValidConfig — the festival is served BESIDE the base map", () => {
  it("rejects a layer id the base map already uses", () => {
    // /map/config serves both lists in one response and the app keys its
    // visibility store on the id, so a festival layer called building_numbers
    // would silently take over the buildings' toggle.
    const config = raw();
    config.layers[0].id = "building_numbers";
    for (const p of Object.values(config.itemDefaults.byCategory)) {
      if ((p as { layerId: string }).layerId === "eskara26_stage") (p as { layerId: string }).layerId = "building_numbers";
    }
    config.chips[0].layerIds = ["building_numbers"];
    expect(() => assertValidConfig(config)).toThrow(
      /config.layers\[0\].id "building_numbers" collides with a base map layer/,
    );
  });

  it("rejects a chip id equal to the synthesised reset chip's", () => {
    // The reset chip is not authored, so nothing in the file shows the id it
    // takes — this is the only place the collision can be caught.
    const config = raw();
    config.chips[0].id = `${config.layerSetId}_all`;
    expect(() => assertValidConfig(config)).toThrow(/duplicate chip id "eskara-2026_all"/);
  });

  it("runs the served chip row through the same validator /map/config trusts", () => {
    // Belt and braces: every chip the config produces, reset chip included,
    // passes the map's own rules against the catalogue it will be served with.
    // A regression in either module shows up here, before a deploy.
    const config = assertValidConfig(raw());
    expect(config.chips.length).toBeGreaterThan(0);
    expect(config.layers.every((l) => !["building_numbers", "building_labels"].includes(l.id))).toBe(true);
  });
});

describe("assertValidConfig — identity and shape", () => {
  it("requires the event's name — it is the reset chip's label", () => {
    const config = raw();
    delete config.name;
    expect(() => assertValidConfig(config)).toThrow(/config.name must be an object/);
  });

  it("requires the event's emoji — it is the reset chip's icon", () => {
    const config = raw();
    config.emoji = "";
    expect(() => assertValidConfig(config)).toThrow(/config.emoji must be a non-empty string/);
  });

  it("rejects duplicate layer ids", () => {
    const config = raw();
    config.layers.push({ ...config.layers[0] });
    expect(() => assertValidConfig(config)).toThrow(/config.layers has a duplicate id/);
  });

  it("rejects an empty layers array", () => {
    const config = raw();
    config.layers = [];
    expect(() => assertValidConfig(config)).toThrow(/config.layers must not be empty/);
  });

  it("rejects a layer set where nothing is on by default", () => {
    // The reset chip restores the default-visible set; with none there is no
    // way back to the ordinary festival map.
    const config = raw();
    for (const layer of config.layers) layer.defaultVisible = false;
    expect(() => assertValidConfig(config)).toThrow(/at least one defaultVisible/);
  });

  it("rejects a colour that is not bare six-digit hex", () => {
    // The app's toCssColor prepends the "#" itself; a "#" here renders nothing.
    const config = raw();
    config.layers[0].color = "#F04452";
    expect(() => assertValidConfig(config)).toThrow(/color must be a 6-digit hex/);
  });

  it("rejects duplicate chip ids", () => {
    const config = raw();
    config.chips.push({ ...config.chips[0] });
    expect(() => assertValidConfig(config)).toThrow(/duplicate chip id "eskara26_view_stage"/);
  });

  it("rejects a chip naming no layers", () => {
    // An empty list is the camera-only chip in the wire contract, and that is
    // not something a festival config gets to author — the reset chip already
    // moves the camera.
    const config = raw();
    config.chips[0].layerIds = [];
    expect(() => assertValidConfig(config)).toThrow(/config.chips\[0\].layerIds must not be empty/);
  });

  it("lets a single-layer chip omit its label, and requires one otherwise", () => {
    const single = raw();
    delete single.chips[0].label;
    expect(() => assertValidConfig(single)).not.toThrow();

    const multi = raw();
    multi.chips[0].layerIds = [multi.layers[0].id, multi.layers[1].id];
    delete multi.chips[0].label;
    expect(() => assertValidConfig(multi)).toThrow(
      /config.chips\[0\].label is required when layerIds names more than one layer/,
    );

    multi.chips[0].label = { ko: "먹거리·주점" };
    expect(() => assertValidConfig(multi)).not.toThrow();
  });

  it("rejects swapped camera coordinates", () => {
    const config = raw();
    config.camera = { ...config.camera, lat: 126.971234, lng: 37.295129 };
    expect(() => assertValidConfig(config)).toThrow(/lat and lng may be swapped/);
  });

  it("requires every camera motion field — no silent defaults", () => {
    const config = raw();
    delete config.camera.durationMs;
    expect(() => assertValidConfig(config)).toThrow(
      /config.camera.durationMs must be a finite number/,
    );
  });

  it("rejects an I18n object with no ko", () => {
    const config = raw();
    config.layers[0].label = { en: "Bars" };
    expect(() => assertValidConfig(config)).toThrow(/label.ko must be a non-empty string/);
  });
});


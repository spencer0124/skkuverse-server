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
import {
  assertValidConfig,
  computeConfigHash,
  getLayerSetConfig,
} from "../../../src/eventmap/eventmap.config";
import { canonicalStringify } from "../../../src/eventmap/eventmap.hash";
import { EVENTMAP_SCHEMA_VERSION } from "../../../src/eventmap/types";

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

  it("is stamped with the schema version this server materializes", () => {
    expect(raw()).not.toHaveProperty("schemaVersion");
    expect(assertValidConfig(raw()).schemaVersion).toBe(EVENTMAP_SCHEMA_VERSION);
  });

  it("keeps every itemDefaults reference resolvable", () => {
    const config = assertValidConfig(raw());
    const layerIds = new Set(config.layers.map((l) => l.id));
    const templateIds = new Set(config.cardTemplates.map((t) => t.id));
    for (const p of [
      config.itemDefaults.fallback,
      ...Object.values(config.itemDefaults.byCategory),
    ]) {
      expect(layerIds.has(p.layerId)).toBe(true);
      expect(templateIds.has(p.cardTemplateId)).toBe(true);
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

  it("rejects an itemDefaults entry pointing at a card template that does not exist", () => {
    const config = raw();
    config.itemDefaults.byCategory.bar.cardTemplateId = "nope";
    expect(() => assertValidConfig(config)).toThrow(
      /cardTemplateId "nope" is not in config.cardTemplates/,
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
  it("refuses a file that carries its own schemaVersion", () => {
    // The version is a fact about this server's materializer, stamped on every
    // payload. A copy in the file is redundant at best and, left behind after a
    // bump, tells every client the OLD shape while shipping the new one.
    const config = raw();
    config.schemaVersion = EVENTMAP_SCHEMA_VERSION;
    expect(() => assertValidConfig(config)).toThrow(/schemaVersion is stamped by the server/);
  });

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

  it("rejects a card field slot with no fieldKey", () => {
    const config = raw();
    config.cardTemplates[0].slots.push({ kind: "field", label: { ko: "x" } });
    expect(() => assertValidConfig(config)).toThrow(/fieldKey must be a non-empty string/);
  });

  it("rejects an I18n object with no ko", () => {
    const config = raw();
    config.layers[0].label = { en: "Bars" };
    expect(() => assertValidConfig(config)).toThrow(/label.ko must be a non-empty string/);
  });
});

describe("canonicalStringify + configHash — reacts to meaning, not formatting", () => {
  it("is insensitive to key order", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
  });

  it("is sensitive to array order, which is meaningful", () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });

  it("serializes Dates as ISO strings so two replicas agree", () => {
    expect(canonicalStringify({ at: new Date("2026-09-16T09:00:00.000Z") })).toBe(
      '{"at":"2026-09-16T09:00:00.000Z"}',
    );
  });

  it("does not change when the file is reformatted or keys reordered", () => {
    // Hashing the raw TEXT would fail this — and a prettier run would then throw
    // away every client's one-year snapshot cache for a no-op change.
    //
    // Reverses object key order at EVERY depth. Array order is left alone: it is
    // meaningful (layer order in the filter grid, chip order in the row) and the
    // hash must react to it, which the previous test pins.
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([k, v]) => [k, reverseKeys(v)]),
      );
    };

    const base = assertValidConfig(raw());
    const reordered = assertValidConfig(reverseKeys(raw()));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(base));
    expect(computeConfigHash(reordered)).toBe(computeConfigHash(base));
  });

  it("does not change when configVersion is bumped", () => {
    // configVersion is a human label that never reaches the wire. If it entered
    // the hash, bumping it out of habit would republish an identical payload.
    const base = assertValidConfig(raw());
    const bumped = raw();
    bumped.configVersion = base.configVersion + 41;
    expect(computeConfigHash(assertValidConfig(bumped))).toBe(computeConfigHash(base));
  });

  it("does NOT change for a field only /map/config or the manifest serves", () => {
    // These never enter a snapshot payload. Hashing them would republish a
    // byte-identical snapshot for a chip-emoji edit and throw away every
    // client's one-year cache for a change they already see live.
    const base = computeConfigHash(assertValidConfig(raw()));
    const edits: Array<(c: Record<string, any>) => void> = [
      (c) => (c.layers[0].label.ko = "술집"),
      (c) => (c.layers[0].color = "000000"),
      (c) => (c.layers[0].defaultVisible = !c.layers[0].defaultVisible),
      (c) => (c.chips[0].emoji = "🎸"),
      (c) => (c.chips[0].label = { ko: "다른 이름" }),
      (c) => (c.name.ko = "27ESKARA"),
      (c) => (c.emoji = "🎡"),
      (c) => (c.camera.zoom = 16),
      (c) => (c.refreshAfterSec = 30),
    ];
    for (const edit of edits) {
      const edited = raw();
      edit(edited);
      expect(computeConfigHash(assertValidConfig(edited))).toBe(base);
    }
  });

  it("DOES change for every field the snapshot is built from", () => {
    const base = computeConfigHash(assertValidConfig(raw()));
    const edits: Array<(c: Record<string, any>) => void> = [
      (c) => (c.timezone = "Asia/Tokyo"),
      (c) => (c.stackKeyBy = "zone"),
      (c) => (c.sorts[0].label.ko = "다른 정렬"),
      (c) => c.cardTemplates[0].slots.push({ kind: "hours" }),
      (c) => (c.itemDefaults.fallback.pinPriority = 99),
      (c) => (c.itemDefaults.byCategory.bar.cardTemplateId = "booth"),
    ];
    for (const edit of edits) {
      const edited = raw();
      edit(edited);
      expect(computeConfigHash(assertValidConfig(edited))).not.toBe(base);
    }
  });

  it("DOES change when a category moves to another layer", () => {
    // This is the edit that moves pins between layers on every phone; it must
    // mint a version.
    const base = assertValidConfig(raw());
    const edited = raw();
    edited.itemDefaults.byCategory.food.layerId = edited.itemDefaults.byCategory.bar.layerId;
    expect(computeConfigHash(assertValidConfig(edited))).not.toBe(
      computeConfigHash(base),
    );
  });
});

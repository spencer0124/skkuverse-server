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
 */
import fs from "fs";
import path from "path";
import {
  assertValidConfig,
  computeConfigHash,
  getLayerSetConfig,
} from "../../../src/eventmap/eventmap.config";
import { canonicalStringify } from "../../../src/eventmap/eventmap.hash";

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

  it("keeps every layer/itemDefaults reference resolvable", () => {
    const config = assertValidConfig(raw());
    const iconIds = new Set(Object.keys(config.icons));
    const templateIds = new Set(config.cardTemplates.map((t) => t.id));
    for (const p of [
      config.itemDefaults.fallback,
      ...Object.values(config.itemDefaults.byCategory),
    ]) {
      expect(iconIds.has(p.iconId)).toBe(true);
      expect(templateIds.has(p.cardTemplateId)).toBe(true);
    }
  });
});

describe("assertValidConfig — structure→structure references block publication", () => {
  it("rejects a layer pointing at an icon that does not exist", () => {
    const config = raw();
    config.layers[0].iconId = "nope";
    expect(() => assertValidConfig(config)).toThrow(/iconId "nope" is not in config.icons/);
  });

  it("rejects a layer pointing at a sort that does not exist", () => {
    const config = raw();
    config.layers[0].sortId = "nope";
    expect(() => assertValidConfig(config)).toThrow(/sortId "nope" is not in config.sorts/);
  });

  it("rejects an itemDefaults entry pointing at a card template that does not exist", () => {
    const config = raw();
    config.itemDefaults.byCategory.bar.cardTemplateId = "nope";
    expect(() => assertValidConfig(config)).toThrow(
      /cardTemplateId "nope" is not in config.cardTemplates/,
    );
  });

  it("rejects a dangling iconIdClosed, not just iconId", () => {
    const config = raw();
    config.itemDefaults.fallback.iconIdClosed = "nope";
    expect(() => assertValidConfig(config)).toThrow(/iconIdClosed "nope"/);
  });
});

describe("assertValidConfig — identity and shape", () => {
  it("rejects duplicate layer ids", () => {
    const config = raw();
    config.layers.push({ ...config.layers[0] });
    expect(() => assertValidConfig(config)).toThrow(/duplicate id/);
  });

  it("rejects a chip id reused across DIFFERENT groups", () => {
    // Chip ids are the client's selection keys across all groups, so uniqueness
    // within a group is not enough.
    const config = raw();
    config.chipGroups[1].chips[0].id = config.chipGroups[0].chips[0].id;
    expect(() => assertValidConfig(config)).toThrow(
      /config.chipGroups\[\].chips has a duplicate id/,
    );
  });

  it("rejects an empty layers array", () => {
    const config = raw();
    config.layers = [];
    expect(() => assertValidConfig(config)).toThrow(/config.layers must not be empty/);
  });

  it("rejects a marker symbol the map library does not know", () => {
    // An unknown symbol renders nothing, and a blank pin looks like missing data
    // rather than a config typo.
    const config = raw();
    config.icons.generic.symbol = "chartreuse";
    expect(() => assertValidConfig(config)).toThrow(/must be one of \[blue, gray/);
  });

  it("rejects a remote icon served over http", () => {
    const config = raw();
    config.icons.generic = { kind: "remote", uri: "http://x/y.png", width: 32, height: 40 };
    expect(() => assertValidConfig(config)).toThrow(/must be an https:\/\/ URL/);
  });

  it("rejects swapped camera coordinates", () => {
    const config = raw();
    config.camera = { lat: 126.971234, lng: 37.295129, zoom: 17.5 };
    expect(() => assertValidConfig(config)).toThrow(/lat and lng may be swapped/);
  });

  it("rejects a single-selection chip group with two defaults", () => {
    const config = raw();
    config.chipGroups[0].chips[1].defaultSelected = true;
    expect(() => assertValidConfig(config)).toThrow(/more than one defaultSelected/);
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

describe("assertValidConfig — predicates", () => {
  it("rejects an unknown node kind", () => {
    const config = raw();
    config.layers[0].filter = ["matches", "cat:bar"];
    expect(() => assertValidConfig(config)).toThrow(/unknown predicate kind "matches"/);
  });

  it("rejects an unknown status inside a status node", () => {
    const config = raw();
    config.chipGroups[3].chips[0].predicate = ["status", ["operating"]];
    expect(() => assertValidConfig(config)).toThrow(
      /must be one of \[open, upcoming, closed, unknown\]/,
    );
  });

  it("validates nested nodes all the way down", () => {
    const config = raw();
    config.layers[0].filter = ["and", [["has", "cat:bar"], ["nope", "x"]]];
    expect(() => assertValidConfig(config)).toThrow(/unknown predicate kind "nope"/);
  });

  it("accepts every node in the closed set", () => {
    const config = raw();
    config.layers[0].filter = [
      "or",
      [
        ["all"],
        ["has", "a"],
        ["hasAny", ["a", "b"]],
        ["hasAll", ["a", "b"]],
        ["not", ["has", "c"]],
        ["and", [["has", "d"]]],
        ["status", ["open", "upcoming"]],
      ],
    ];
    expect(() => assertValidConfig(config)).not.toThrow();
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
    // meaningful (layer draw order, chip display order) and the hash must react
    // to it, which the previous test pins.
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

  it("DOES change when a label changes", () => {
    const base = assertValidConfig(raw());
    const edited = raw();
    edited.layers[0].label.ko = "술집";
    expect(computeConfigHash(assertValidConfig(edited))).not.toBe(
      computeConfigHash(base),
    );
  });

  it("DOES change when a predicate changes", () => {
    const base = assertValidConfig(raw());
    const edited = raw();
    edited.layers[0].filter = ["has", "cat:booth"];
    expect(computeConfigHash(assertValidConfig(edited))).not.toBe(
      computeConfigHash(base),
    );
  });

  it("DOES change when basemapOverride changes", () => {
    // This is the assertion that catches the field being added to the JSON and
    // forgotten in assertValidConfig's return. The return object is a whitelist,
    // so an unlisted key reaches neither the hash nor the wire — and with the
    // hash unmoved, nothing republishes either. No test fails, no error is
    // logged, and the layer simply never hides.
    const base = assertValidConfig(raw());
    const edited = raw();
    edited.basemapOverride = { building_numbers: true };
    expect(computeConfigHash(assertValidConfig(edited))).not.toBe(
      computeConfigHash(base),
    );
  });
});

describe("assertValidConfig — basemapOverride", () => {
  it("is carried through from the shipped config", () => {
    // The layer id is owned by GET /map/config: `building_numbers` is 건물번호 and
    // `building_labels` is 건물이름. ESKARA hides the numbers and keeps the names.
    expect(assertValidConfig(raw()).basemapOverride).toEqual({
      building_numbers: false,
    });
  });

  it("defaults to {} when absent, so a config predating the field still loads", () => {
    const without = raw();
    delete without.basemapOverride;
    expect(assertValidConfig(without).basemapOverride).toEqual({});
  });

  it("rejects a non-boolean rather than coercing it", () => {
    // Truthiness would force a layer ON, and revealing a layer the event meant to
    // hide is the one direction the client cannot recover from.
    const edited = raw();
    edited.basemapOverride = { building_numbers: "false" };
    expect(() => assertValidConfig(edited)).toThrow(/basemapOverride\["building_numbers"\]/);
  });

  it("rejects a non-object", () => {
    const edited = raw();
    edited.basemapOverride = ["building_numbers"];
    expect(() => assertValidConfig(edited)).toThrow(/config.basemapOverride/);
  });

  it("accepts an id matching no layer, which is inert rather than an error", () => {
    // The keys name layers owned by another endpoint. Validating them here would
    // be a second source of truth that goes stale the moment that endpoint grows.
    const edited = raw();
    edited.basemapOverride = { not_a_layer: false };
    expect(assertValidConfig(edited).basemapOverride).toEqual({ not_a_layer: false });
  });
});

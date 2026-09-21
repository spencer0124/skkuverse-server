/**
 * Structure-tier validation (skkuverse#14). Contract:
 * docs/reference/event-places.md §1.
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
import { assertValidConfig, getLayerSetConfig } from "../../../src/map/map-layerset.config";

const CONFIG_PATH = path.join(
  __dirname,
  "../../../src/map/config/eskara-2026.json",
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

  it("gives the two 통제구역 their own layer, their own colour, and no default", () => {
    // Three things the 총학생회 asked for on 2026-09-22, and this file is the
    // only place any of them is expressible. Colour is a property of the LAYER,
    // so two colours require two layers — splitting them is not organisation,
    // it is the mechanism. And "선택 시에만" is `never`, not a schedule.
    const config = assertValidConfig(raw());
    const entry = config.itemDefaults.byCategory.control_entry!;
    const vehicle = config.itemDefaults.byCategory.control_vehicle!;
    expect(entry.layerId).not.toBe(vehicle.layerId);

    const layerOf = (id: string) => config.layers.find((l) => l.id === id)!;
    expect(layerOf(entry.layerId).color).not.toBe(layerOf(vehicle.layerId).color);
    for (const id of [entry.layerId, vehicle.layerId]) {
      expect(layerOf(id).defaultVisibleWhen).toEqual({ kind: "never" });
    }

    // Still ONE chip over both. Two layers is a colour decision; it must not
    // become a second control for the reader to find, and a chip naming more
    // than one layer is exactly the shape the validator asks to carry its own
    // label for.
    const chips = config.chips.filter((c) => c.layerIds.includes(entry.layerId));
    expect(chips).toHaveLength(1);
    expect(chips[0]!.layerIds).toEqual(
      expect.arrayContaining([entry.layerId, vehicle.layerId]),
    );
    expect(chips[0]!.label).toBeDefined();
  });

  it("names each 통제구역 on the zone's own layer, and makes all of it inert", () => {
    // A polygon has no caption, so a zone's name is a second, point-shaped place.
    // It works only if the name lands on the SAME layer as the zone — the layer
    // is what a toggle or a chip switches, so that is the whole mechanism by which
    // the two appear and disappear together.
    //
    // All four are inert as of 2026-09-22: the 총학생회's zones are a backdrop to
    // read, not a place to open, so neither the area nor its word takes a tap.
    // The label keeps its own category anyway, so the day a zone becomes
    // tappable again its word does not quietly become a second tap target.
    const config = assertValidConfig(raw());
    const by = config.itemDefaults.byCategory;
    for (const [zone, label] of [
      ["control_entry", "control_entry_label"],
      ["control_vehicle", "control_vehicle_label"],
    ] as const) {
      expect(by[label]!.layerId).toBe(by[zone]!.layerId);
      expect(by[label]!.interactive).toBe(false);
      expect(by[zone]!.interactive).toBe(false);
      // A bare caption, not a pin: the layer draws its points as `textLabel`.
      const layer = config.layers.find((l) => l.id === by[zone]!.layerId)!;
      expect(layer.markerStyle).toBe("textLabel");
    }
  });

  it("frames the 통제구역 on 운용재 from further out, and moves no other chip", () => {
    // The zones are long north-south bands, and between the chip row and the
    // bottom sheet a phone shows about 511 pt of map — at the festival's zoom
    // their southern tip sits under the sheet. So that ONE chip steps back and
    // recentres on 운용재 (building 49), which sits nearer the middle of both
    // zones than 대운동장 does; every other chip keeps the camera they shared.
    const config = assertValidConfig(raw());
    const control = config.chips.find((c) => c.id === "eskara26_view_control")!;
    expect(control.camera!.zoom).toBeLessThan(config.camera.zoom);
    // 운용재 as /map/overlays/campus serves it, which is campusMap.do's pair.
    expect([control.camera!.lat, control.camera!.lng]).toEqual([37.294555, 126.971921]);
    // Only the framing moved. The motion is the festival's, not this chip's.
    const { tilt, bearing, durationMs } = control.camera!;
    expect({ tilt, bearing, durationMs }).toEqual({
      tilt: config.camera.tilt,
      bearing: config.camera.bearing,
      durationMs: config.camera.durationMs,
    });
    for (const chip of config.chips.filter((c) => c.id !== "eskara26_view_control")) {
      expect(chip.camera).toEqual(config.camera);
    }
  });

  it("maps every category the committed sheet actually uses", () => {
    // The two committed files are edited in different tiers and deployed on
    // different clocks: the sheet reaches Mongo through an importer and needs no
    // release, while this config needs one. So a category added to the sheet and
    // forgotten here does not fail — it falls through `itemDefaults.fallback` to
    // the grey 기타 layer and draws, which is the failure that looks like success.
    //
    // The fallback is not thereby useless: it exists for a category typed into
    // MONGO at 22:00 (ADR 0004 invariant 2). Nothing in the reviewed sheet may
    // rely on it.
    const config = assertValidConfig(raw());
    const sheet = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../../scripts/data/eskara-2026-places.json"),
        "utf8",
      ),
    ) as { places: { category: string }[] };

    const unmapped = [...new Set(sheet.places.map((p) => p.category))].filter(
      (category) => !(category in config.itemDefaults.byCategory),
    );
    expect(unmapped).toEqual([]);
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
    expect(
      config.layers.some((l) => l.defaultVisibleWhen.kind !== "never"),
    ).toBe(true);
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
    // The reset chip restores the layers that come on by themselves — always-on
    // plus scheduled. With none there is no way back to the ordinary festival
    // map, and the default view is an empty one.
    const config = raw();
    for (const layer of config.layers) layer.defaultVisibleWhen = { kind: "never" };
    expect(() => assertValidConfig(config)).toThrow(
      /at least one layer that is not defaultVisibleWhen\.kind "never"/,
    );
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

  it("holds a chip's own camera to the same rule — whole or not at all", () => {
    // A chip camera missing one field must NOT borrow it from the config's. That
    // would be the silent default the rule above forbids, only moved one level
    // down, and a zoom override that quietly inherited the wrong duration is
    // exactly the kind of motion bug nobody can see from the file.
    const config = raw();
    delete config.chips[0].camera.durationMs;
    expect(() => assertValidConfig(config)).toThrow(
      /config\.chips\[0\]\.camera\.durationMs must be a finite number/,
    );
  });

  it("runs the swap detector on a chip's camera too", () => {
    const config = raw();
    const cam = config.chips[0].camera;
    config.chips[0].camera = { ...cam, lat: cam.lng, lng: cam.lat };
    expect(() => assertValidConfig(config)).toThrow(
      /config\.chips\[0\]\.camera\.lat .* lat and lng may be swapped/,
    );
  });

  it("treats an absent chip camera as the config's, not as an error", () => {
    const config = raw();
    delete config.chips[0].camera;
    expect(assertValidConfig(config).chips[0]!.camera).toBeUndefined();
  });

  it("rejects an I18n object with no ko", () => {
    const config = raw();
    config.layers[0].label = { en: "Bars" };
    expect(() => assertValidConfig(config)).toThrow(/label.ko must be a non-empty string/);
  });
});


describe("assertValidConfig — defaultVisibleWhen, the WHEN axis", () => {
  it("keeps a scheduled layer's windows, wrapping past midnight included", () => {
    const config = assertValidConfig(raw());
    const bar = config.layers.find((l) => l.id === "eskara26_bar")!;
    // 주점 is the wrapping case: 18:00 is after 00:00, and that is what says
    // "past midnight" rather than being a swapped pair.
    expect(bar.defaultVisibleWhen).toEqual({
      kind: "scheduled",
      windows: [{ start: "18:00", end: "00:00" }],
    });

    const booth = config.layers.find((l) => l.id === "eskara26_booth")!;
    expect(booth.defaultVisibleWhen).toEqual({
      kind: "scheduled",
      windows: [{ start: "11:00", end: "18:00" }],
    });
  });

  it("reads an absent defaultVisibleWhen as always on — never fail closed", () => {
    // The boolean it replaces defaulted to `true` for the same reason: a layer
    // that forgot to decide must not silently vanish from the map.
    const config = raw();
    delete config.layers[0].defaultVisibleWhen;
    expect(assertValidConfig(config).layers[0]!.defaultVisibleWhen).toEqual({
      kind: "always",
    });
  });

  it("rejects an unknown kind rather than falling back to one", () => {
    const config = raw();
    config.layers[0].defaultVisibleWhen = { kind: "sometimes" };
    expect(() => assertValidConfig(config)).toThrow(
      /config\.layers\[0\]\.defaultVisibleWhen\.kind must be one of \[always, never, scheduled\]/,
    );
  });

  it("rejects windows on a kind that never reads them", () => {
    // Every validator here builds a fresh object, so an unknown key is normally
    // dropped without a word. A window list that looks authored and is read by
    // nothing is exactly the stray key worth failing on.
    const config = raw();
    config.layers[0].defaultVisibleWhen = {
      kind: "never",
      windows: [{ start: "18:00", end: "00:00" }],
    };
    expect(() => assertValidConfig(config)).toThrow(
      /config\.layers\[0\]\.defaultVisibleWhen\.windows is read only on kind "scheduled"/,
    );
  });

  it("rejects a scheduled layer with no windows, naming the spelling that means always", () => {
    const config = raw();
    config.layers[0].defaultVisibleWhen = { kind: "scheduled", windows: [] };
    expect(() => assertValidConfig(config)).toThrow(
      /config\.layers\[0\]\.defaultVisibleWhen\.windows must not be empty/,
    );
  });

  // Both bounds, not just `start`: the validator loops over the pair, and a
  // suite that only ever varies `start` stays green if the loop is reduced to
  // one member.
  it.each(["24:00", "7:00", "25:00", "18:60", "1800", "18:00:00", ""])(
    "rejects %p at either end of a window",
    (bound) => {
      // "24:00" is the one worth naming: it is a real spelling of midnight in
      // other formats, and allowing it would give 00:00 a second spelling.
      for (const key of ["start", "end"] as const) {
        const config = raw();
        config.layers[0].defaultVisibleWhen = {
          kind: "scheduled",
          windows: [{ start: "11:00", end: "23:00", [key]: bound }],
        };
        expect(() => assertValidConfig(config)).toThrow(
          new RegExp(`config\\.layers\\[0\\]\\.defaultVisibleWhen\\.windows\\[0\\]\\.${key}`),
        );
      }
    },
  );

  it.each(["always", "never"])("rejects windows on kind %p", (kind) => {
    const config = raw();
    config.layers[0].defaultVisibleWhen = {
      kind,
      windows: [{ start: "18:00", end: "00:00" }],
    };
    expect(() => assertValidConfig(config)).toThrow(
      /defaultVisibleWhen\.windows is read only on kind "scheduled"/,
    );
  });

  it.each([{}, 3, "18:00"])("rejects %p in place of a windows array", (windows) => {
    const config = raw();
    config.layers[0].defaultVisibleWhen = { kind: "scheduled", windows };
    expect(() => assertValidConfig(config)).toThrow(
      /config\.layers\[0\]\.defaultVisibleWhen\.windows must be an array/,
    );
  });

  it("reads an explicit null the way it reads an absent value", () => {
    // JSON has a null and config authors write it. It must not fall through to
    // asRecord, which would reject it as "must be an object".
    const config = raw();
    config.layers[0].defaultVisibleWhen = null;
    expect(assertValidConfig(config).layers[0]!.defaultVisibleWhen).toEqual({
      kind: "always",
    });
  });

  it("rejects equal bounds — ambiguous between no minutes and all day", () => {
    const config = raw();
    config.layers[0].defaultVisibleWhen = {
      kind: "scheduled",
      windows: [{ start: "18:00", end: "18:00" }],
    };
    expect(() => assertValidConfig(config)).toThrow(
      /config\.layers\[0\]\.defaultVisibleWhen\.windows\[0\] has equal bounds/,
    );
  });

  it("accepts a window that wraps past midnight", () => {
    const config = raw();
    config.layers[0].defaultVisibleWhen = {
      kind: "scheduled",
      windows: [{ start: "22:00", end: "02:00" }],
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });

  it("rejects a timezone the wire contract cannot honour", () => {
    // A DailyWindow bound is wall-clock, and the client resolves it as a fixed
    // +09:00. A zone this server cannot promise is a silent wrong answer, not a
    // degraded one — and "Asia/Seuol" passed the old non-empty-string check.
    const config = raw();
    config.timezone = "Asia/Seuol";
    expect(() => assertValidConfig(config)).toThrow(
      /config\.timezone must be one of \[Asia\/Seoul\]/,
    );
  });
});

/**
 * `interactive` — the per-category switch that makes a place a backdrop.
 *
 * A drawn-but-not-pressable zone (a 통제 구간 outline) resolves to `tap: null`,
 * a spelling that already existed. It sits on the CATEGORY rather than the
 * layer or the place: two categories may map to one layer, so one "구역" layer
 * can hold tappable stage zones and an inert boundary without a second layer.
 */
describe("assertValidConfig — interactive, the TAP axis", () => {
  it("defaults an absent value to interactive — never fail closed", () => {
    const config = raw();
    for (const p of Object.values<any>(config.itemDefaults.byCategory)) {
      delete p.interactive;
    }
    delete config.itemDefaults.fallback.interactive;

    const parsed = assertValidConfig(config);

    // A layer set written before this field existed must not silently lose
    // every tap on the map — the same rule userConfigurable follows.
    expect(parsed.itemDefaults.fallback.interactive).toBe(true);
    for (const p of Object.values(parsed.itemDefaults.byCategory)) {
      expect(p.interactive).toBe(true);
    }
  });

  it("treats an explicit null as absent, for the same reason", () => {
    const config = raw();
    config.itemDefaults.fallback.interactive = null;
    expect(assertValidConfig(config).itemDefaults.fallback.interactive).toBe(true);
  });

  it("carries an explicit false through", () => {
    const config = raw();
    config.itemDefaults.fallback.interactive = false;
    expect(assertValidConfig(config).itemDefaults.fallback.interactive).toBe(false);
  });

  it("refuses a non-boolean rather than coercing it", () => {
    // `"false"` is truthy, so coercion would make a backdrop tappable while the
    // sheet plainly says otherwise. An authoring mistake worth naming.
    const config = raw();
    config.itemDefaults.fallback.interactive = "false";
    expect(() => assertValidConfig(config)).toThrow(
      /config\.itemDefaults\.fallback\.interactive must be a boolean/,
    );
  });

  it("names the exact category when one of them is wrong", () => {
    const config = raw();
    const [category] = Object.keys(config.itemDefaults.byCategory);
    config.itemDefaults.byCategory[category!].interactive = 1;
    expect(() => assertValidConfig(config)).toThrow(
      new RegExp(`byCategory\\["${category}"\\]\\.interactive must be a boolean`),
    );
  });
});

describe("assertValidConfig — markerStyle, the HOW axis", () => {
  /** The first layer with its markerStyle replaced (or deleted, for undefined). */
  function withMarkerStyle(value: unknown) {
    const config = raw();
    if (value === undefined) delete config.layers[0].markerStyle;
    else config.layers[0].markerStyle = value;
    return config;
  }

  it("reads an absent markerStyle as the pin every festival layer drew before", () => {
    // Additive for every config already on disk: a file written before the
    // field existed must mean exactly what it meant then.
    expect(assertValidConfig(withMarkerStyle(undefined)).layers[0]!.markerStyle).toBe(
      "placeDot",
    );
  });

  it("accepts textLabel, the bare caption a zone's name is drawn with", () => {
    expect(assertValidConfig(withMarkerStyle("textLabel")).layers[0]!.markerStyle).toBe(
      "textLabel",
    );
  });

  it.each(["numberCircle", "numberDot", "pin", "TextLabel"])(
    "refuses %s, because the client would draw it as a building number",
    (value) => {
      // Failed at load rather than passed through: the client's allowlist sends
      // an unrecognised member to the building-number branch, so this would not
      // error anywhere — every booth would become a green numbered circle. The
      // two building renderings are refused too; they mean nothing for a place.
      expect(() => assertValidConfig(withMarkerStyle(value))).toThrow(
        /layers\[0\]\.markerStyle must be one of \[placeDot, textLabel\]/,
      );
    },
  );
});

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

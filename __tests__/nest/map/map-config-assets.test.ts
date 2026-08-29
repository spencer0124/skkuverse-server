/**
 * The build-asset registration guard (skkuverse#14).
 *
 * `tsc` does not copy JSON, so every structure config must be staged into dist/
 * by scripts/copy-build-assets.js. Missing one breaks PRODUCTION ONLY — the dev
 * watcher reads from src/ and never notices — and the symptom there is an event
 * map that simply is not there, which is indistinguishable from a finished
 * festival.
 *
 * Adding a layer set needs three coordinated edits (the JSON, CONFIG_FILES, the
 * asset list). This test is the cheapest thing that makes forgetting the third
 * one loud, and it is the reason CONFIG_FILES is an explicit list rather than a
 * readdir.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const CONFIG_DIR = path.join(ROOT, "src/map/config");
const ASSET_SCRIPT = path.join(ROOT, "scripts/copy-build-assets.js");
const CONFIG_MODULE = path.join(ROOT, "src/map/map-layerset.config.ts");

/** The filenames listed in map-layerset.config.ts's CONFIG_FILES. */
function declaredConfigFiles(): string[] {
  const source = fs.readFileSync(CONFIG_MODULE, "utf8");
  const block = /const CONFIG_FILES = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) throw new Error("CONFIG_FILES not found in map-layerset.config.ts");
  return [...block[1]!.matchAll(/"([^"]+\.json)"/g)].map((m) => m[1]!);
}

describe("event map structure configs", () => {
  it("registers every declared config in copy-build-assets.js", () => {
    const assetScript = fs.readFileSync(ASSET_SCRIPT, "utf8");
    for (const fileName of declaredConfigFiles()) {
      expect(assetScript).toContain(`src/map/config/${fileName}`);
      expect(assetScript).toContain(`dist/src/map/config/${fileName}`);
    }
  });

  it("declares every config file that exists on disk", () => {
    // The other direction: a JSON added to the directory but never listed is
    // simply inert, which is a quieter failure than a missing one.
    const onDisk = fs
      .readdirSync(CONFIG_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(declaredConfigFiles().sort()).toEqual(onDisk);
  });
});

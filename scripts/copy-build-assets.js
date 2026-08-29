// tsc only emits .js (from .ts) and copies-through .js files. JSON assets
// that are require()'d or fs.readFileSync'd at runtime must be staged into
// dist/ separately. List every such asset here.
const fs = require("fs");
const path = require("path");

const assets = [
  // notices/tabConfig + notices/sources read these with fs.readFileSync(__dirname/<name>)
  ["src/notices/categories.json", "dist/src/notices/categories.json"],
  ["src/notices/sources.json", "dist/src/notices/sources.json"],
  ["src/notices/exclude-reasons.json", "dist/src/notices/exclude-reasons.json"],
  // holiday-calendar reads this with fs.readFileSync(__dirname/<name>)
  ["src/bus/schedule/skku-rest-days.json", "dist/src/bus/schedule/skku-rest-days.json"],
  // jongro.registry reads this with fs.readFileSync(__dirname/<name>)
  ["src/bus/registry/jongro-routes.json", "dist/src/bus/registry/jongro-routes.json"],
  // miniapps/miniapps.ts reads these with fs.readFileSync(__dirname/<name>).
  // Every details/<id>.json listed in index.json must appear here too — the
  // loader reads them eagerly at boot, so a missing file is a startup crash.
  ["src/miniapps/index.json", "dist/src/miniapps/index.json"],
  [
    "src/miniapps/details/eskara-2026.json",
    "dist/src/miniapps/details/eskara-2026.json",
  ],
  ["src/miniapps/details/hssc.json", "dist/src/miniapps/details/hssc.json"],
  ["src/miniapps/details/nsc.json", "dist/src/miniapps/details/nsc.json"],
  ["src/miniapps/details/skkuw.json", "dist/src/miniapps/details/skkuw.json"],
  ["src/miniapps/details/skkuzine.json", "dist/src/miniapps/details/skkuzine.json"],
  // eventmap/eventmap.config.ts reads these with fs.readFileSync(__dirname/config/<name>).
  // Every entry in that module's CONFIG_FILES must appear here — it lists files
  // explicitly rather than readdir'ing precisely so a miss shows up as a named
  // ENOENT in the logs instead of a silently absent event map.
  [
    "src/map/config/eskara-2026.json",
    "dist/src/map/config/eskara-2026.json",
  ],
];

for (const [src, dest] of assets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest);
  process.stdout.write(`  copied ${src} → ${dest}\n`);
}

// tsc emits __tests__/helpers compiled output because they're in tsconfig.include
// (needed for typecheck). Strip from dist/ so Docker COPY doesn't ship them.
fs.rmSync("dist/__tests__", { recursive: true, force: true });
process.stdout.write("  stripped dist/__tests__\n");

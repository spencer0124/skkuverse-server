// tsc only emits .js (from .ts) and copies-through .js files. JSON assets
// that are require()'d or fs.readFileSync'd at runtime must be staged into
// dist/ separately. List every such asset here.
const fs = require("fs");
const path = require("path");

const assets = [
  // notices/tabConfig reads these with fs.readFileSync(__dirname/<name>)
  ["features/notices/categories.json", "dist/features/notices/categories.json"],
  ["features/notices/sources.json", "dist/features/notices/sources.json"],
  // dist/index.js requires swagger-output.json with relative path
  ["swagger/swagger-output.json", "dist/swagger/swagger-output.json"],
  // holiday-calendar reads this with fs.readFileSync(__dirname/<name>)
  ["features/bus/skku-rest-days.json", "dist/features/bus/skku-rest-days.json"],
  // jongro.registry reads this with fs.readFileSync(__dirname/<name>)
  ["features/bus/jongro-routes.json", "dist/features/bus/jongro-routes.json"],
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

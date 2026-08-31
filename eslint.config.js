const js = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

const sharedRules = {
  // Pre-TS hardening — catch implicit-coercion and scope bugs JS lets through
  // but TS strict mode treats as compile errors or hidden footguns.
  // `{ null: "ignore" }` preserves the `value == null` idiom (null + undefined in one check).
  "eqeqeq": ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
  // Only multi-line blocks need braces; `if (x) return;` stays terse.
  "curly": ["error", "multi-line"],
  "no-shadow": "error",
  "no-throw-literal": "error",
  "no-useless-concat": "error",
};

const sharedGlobals = {
  // Node.js globals
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  // Node 18+ globals
  fetch: "readonly",
  AbortController: "readonly",
};

const jestGlobals = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  jest: "readonly",
};

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: sharedGlobals,
    },
    rules: {
      // Promoted to error: incomplete refactor artifacts shouldn't pass CI.
      "no-unused-vars": ["error", { argsIgnorePattern: "^(_|next)", caughtErrorsIgnorePattern: "^_" }],
      ...sharedRules,
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: sharedGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Replace base no-unused-vars with @typescript-eslint version
      // (handles TS-specific cases: type imports, enum members, etc.)
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^(_|next)", caughtErrorsIgnorePattern: "^_" }],
      // TS handles undefined identifiers at compile time; the lint rule mis-flags
      // global type augmentations (NodeJS.Timeout, Express.Request, etc.).
      "no-undef": "off",
      ...sharedRules,
      // no-shadow base rule also disabled in TS (TS-specific version handles enums/types correctly)
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
    },
  },
  {
    // LEAF modules of the catalogue ⇄ layer-set seam. `map-layerset.config.ts`
    // runs `CONFIG_FILES.map(loadOne)` in its module body and imports these two
    // to validate a festival's chips against the served catalogue; if either
    // ever imported it — or anything that does — back, the half-initialised
    // module would be the one running loadOne, and `BASE_LAYERS` would be
    // `undefined` inside the import-time check with a TypeError naming nothing
    // useful. Their headers say so; this is what makes it fail lint instead.
    //
    // Living in one directory now does not make the cycle less real: these two
    // are imported BY the loader, so nothing they import may reach it again.
    files: ["src/map/map-layers.data.ts", "src/map/map-chips.data.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Both spellings: these modules are siblings now, so the import
              // that would close the cycle is written "./map-layerset.config",
              // which a "**/"-only glob does not reliably match.
              group: [
                "**/map-layerset.config",
                "./map-layerset.config",
                "**/map-active-layerset",
                "./map-active-layerset",
                "**/map-places.data",
                "./map-places.data",
                "**/map-config.data",
                "./map-config.data",
                "**/map-event-overlays.data",
                "./map-event-overlays.data",
              ],
              message:
                "leaf module: this import closes a cycle through map-layerset.config (see the file header).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["__tests__/**/*.{js,ts}"],
    languageOptions: {
      globals: jestGlobals,
    },
  },
  {
    ignores: ["node_modules/", "coverage/", "dist/", "swagger/swagger-output.json"],
  },
];

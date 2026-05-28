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
    files: ["__tests__/**/*.{js,ts}"],
    languageOptions: {
      globals: jestGlobals,
    },
  },
  {
    ignores: ["node_modules/", "coverage/", "dist/", "swagger/swagger-output.json"],
  },
];

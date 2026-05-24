const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
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
      },
    },
    rules: {
      // Promoted to error: incomplete refactor artifacts shouldn't pass CI.
      "no-unused-vars": ["error", { argsIgnorePattern: "^(_|next)", caughtErrorsIgnorePattern: "^_" }],

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
    },
  },
  {
    files: ["__tests__/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "coverage/", "swagger/swagger-output.json"],
  },
];

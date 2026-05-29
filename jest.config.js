module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.ts"],
  // ts-jest only transpiles. Type checking is the job of `npm run typecheck`
  // (tsc --noEmit + tsc -p tsconfig.test.json --noEmit), so `diagnostics: false`
  // avoids duplicate work and keeps the test loop fast. tsconfig path points to
  // the test-specific config (lax noUncheckedIndexedAccess / noUnusedLocals for
  // tests). `isolatedModules` moved to tsconfig.json compilerOptions per ts-jest
  // v30 deprecation migration path.
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false, tsconfig: "tsconfig.test.json" }],
  },
  moduleFileExtensions: ["ts", "js", "json", "node"],
  // Anything under __tests__/helpers is shared test infrastructure (mock factories,
  // app builders), not a test suite. Without this, Jest's default __tests__/**
  // matcher would treat each helper module as a test and fail it for having zero it() blocks.
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/helpers/"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/__tests__/helpers/",
    "building\\.sync\\.ts$", // external API sync — integration-only
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 75,
      statements: 75,
    },
  },
};

module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  // ts-jest only transpiles. Type checking is the job of `npm run typecheck`
  // (tsc --noEmit), so `diagnostics: false` avoids duplicate work and keeps the
  // test loop fast. PR7 will split tsconfig.test.json once .test.js → .test.ts.
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false, isolatedModules: true }],
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
    "building\\.sync\\.js$", // external API sync — integration-only
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

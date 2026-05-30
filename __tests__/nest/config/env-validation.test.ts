/**
 * Pins env.validation.findMissingRequired() parity with lib/config.ts's
 * required[] — specifically the api.hsscNew entry, the only one resolved via
 * apiUrl() (DEV-preferred-with-PROD-fallback) rather than read straight off
 * process.env.
 *
 * The parity bug: reading process.env.API_HSSC_NEW_PROD directly made the Nest
 * validator over-crash in Development / Staging-check modes where a dev sets
 * only API_HSSC_NEW_DEV (leaving _PROD empty) — a config lib/config accepts and
 * Express boots on. The fix mirrors apiUrl().
 *
 * findMissingRequired() reads NODE_ENV / USE_PROD_API at MODULE LOAD time
 * (top-level consts), so each scenario sets env then jest.isolateModules() to
 * re-evaluate the module fresh.
 */

const HSSC_KEYS = ["API_HSSC_NEW_PROD", "API_HSSC_NEW_DEV"] as const;

function withEnv(
  env: Record<string, string | undefined>,
  fn: (findMissing: () => string[]) => void,
): void {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "NODE_ENV",
    "USE_PROD_API",
    ...HSSC_KEYS,
  ];
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    jest.isolateModules(() => {
      const mod = require("../../../src/config/env.validation");
      fn(mod.findMissingRequired);
    });
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function hsscMissing(missing: string[]): boolean {
  return missing.some((m) => m.includes("api.hsscNew"));
}

describe("env.validation api.hsscNew parity with lib/config apiUrl()", () => {
  // Baseline: jest.setup.ts defines all other required vars, so api.hsscNew is
  // the only entry that flips based on the HSSC env we control here.

  it("Development with only API_HSSC_NEW_DEV set → NOT missing (matches Express boot)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        USE_PROD_API: undefined,
        API_HSSC_NEW_PROD: undefined,
        API_HSSC_NEW_DEV: "http://hssc-dev",
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(false);
      },
    );
  });

  it("Development with neither key set → missing", () => {
    withEnv(
      {
        NODE_ENV: "development",
        USE_PROD_API: undefined,
        API_HSSC_NEW_PROD: undefined,
        API_HSSC_NEW_DEV: undefined,
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(true);
      },
    );
  });

  it("Staging-check (USE_PROD_API=true) with only API_HSSC_NEW_DEV → missing (prod key required)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        USE_PROD_API: "true",
        API_HSSC_NEW_PROD: undefined,
        API_HSSC_NEW_DEV: "http://hssc-dev",
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(true);
      },
    );
  });

  it("Production with only API_HSSC_NEW_PROD set → NOT missing", () => {
    withEnv(
      {
        NODE_ENV: "production",
        USE_PROD_API: undefined, // production forces USE_PROD_API
        API_HSSC_NEW_PROD: "http://hssc-prod",
        API_HSSC_NEW_DEV: undefined,
      },
      (findMissing) => {
        expect(hsscMissing(findMissing())).toBe(false);
      },
    );
  });
});

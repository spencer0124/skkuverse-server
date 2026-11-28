/**
 * The server's .env is rendered from the maintainers' secret store by
 * scripts/render_env.py, which writes exactly the names in
 * config/env.{prd,dev}.keys and fails if the store holds one name more or
 * less. Those two lists are the contract between this code and the store, and
 * this file keeps them honest:
 *
 *   - a .env holding only the listed names passes the bootstrap validation, so
 *     a rendered file always boots;
 *   - every listed name is read somewhere in src/, so no dead key is rendered,
 *     except a name kept for rollback: one release after the code stops reading
 *     it, a name stays in both lists, read nowhere, so the image a failed deploy
 *     restarts against the new .env still finds a value it requires;
 *   - no listed name is also set inline in docker-compose.yml, where the inline
 *     value would silently win over the rendered one;
 *   - config.ts and the Nest bootstrap both check the one required list in
 *     src/infra/required-env.ts, so the two fail-loud layers cannot drift apart;
 *   - with every poller-scoped name gone, an api replica passes the check,
 *     boots every module and serves the bus, subway and map read routes from
 *     fakes (ADR 0012, D4), so no import, boot or read path needs a poller key;
 *   - README's Quick start .env, which an outsider writes by hand without the
 *     secret store, names exactly what `npm run dev` requires and boots as written.
 *
 * Files are read with patterns rather than parsers: their shape is fixed and
 * the repo avoids the dependency.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { isRequiredIn, requiredValues, validateEnv } from "../../../src/infra/required-env";

type BuildApiReplicaApp = typeof import("../../helpers/nest/api-replica-app")["buildApiReplicaApp"];

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function allowlist(rel: string): string[] {
  return read(rel)
    .split("\n")
    .map((line) => line.split("#", 1)[0]!.trim())
    .filter(Boolean);
}


function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    // A spec may name a variable without the app reading it.
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

const PRD = allowlist("config/env.prd.keys");
const DEV = allowlist("config/env.dev.keys");
// WHY: the deploy restarts the previous image against the newly rendered .env when a deploy fails health, so a
// name that image requires stays listed for one release after the code stops reading it; the next release deletes
// the entry, the name in both lists and the secret-store key.
const KEPT_FOR_ROLLBACK: Readonly<Record<string, string>> = {};
// Production adds SENTRY_DSN, and its overlay mode PERIMETER_SETTINGS, so its list is the longest.
const REQUIRED = requiredValues({ NODE_ENV: "production", PERIMETER_MODE: "overlay" }).map((v) => v.env);

/** Run describeMissingRequired() with exactly `names` set, under `nodeEnv` and, when given, `role` and `mode`. */
function missingWithOnly(names: string[], nodeEnv: string, role?: string, mode?: string): string[] {
  const touched = new Set([...REQUIRED, ...names, "NODE_ENV", "USE_PROD_API", "API_HSSC_NEW_DEV", "ROLE", "PERIMETER_MODE"]);
  const saved = new Map([...touched].map((k) => [k, process.env[k]]));
  try {
    for (const k of touched) delete process.env[k];
    for (const k of names) process.env[k] = `value-of-${k}`;
    process.env.NODE_ENV = nodeEnv;
    if (role !== undefined) process.env.ROLE = role;
    process.env.PERIMETER_MODE = mode ?? saved.get("PERIMETER_MODE");
    let missing: string[] = [];
    jest.isolateModules(() => {
      missing = require("../../../src/infra/required-env").describeMissingRequired();
    });
    return missing;
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("config/env.*.keys — the names render_env.py writes", () => {
  it("config.ts and ConfigModule check the shared list and keep none of their own", () => {
    for (const rel of ["src/infra/config.ts", "src/config/config.module.ts"]) {
      // Act & Assert
      expect(read(rel)).toMatch(/from "(?:\.\.\/infra|\.)\/required-env"/);
      expect(read(rel)).not.toMatch(/const required\b/);
    }
  });

  it.each([
    ["prd", PRD, "production"],
    ["dev", DEV, "development"],
  ])("a .env with only the %s names passes bootstrap validation", (_label, names, nodeEnv) => {
    // Act & Assert
    expect(missingWithOnly(names, nodeEnv)).toEqual([]);
  });

  // WHY: production runs the overlay, which reads its limits from PERIMETER_SETTINGS in every role (ADR 0023, D4).
  it.each(["api", "poller"])("a .env with only the prd names passes in overlay mode, ROLE=%s, and fails without PERIMETER_SETTINGS", (role) => {
    // Arrange
    const withoutSettings = PRD.filter((n) => n !== "PERIMETER_SETTINGS");

    // Act & Assert
    expect(missingWithOnly(PRD, "production", role, "overlay")).toEqual([]);
    expect(missingWithOnly(withoutSettings, "production", role, "overlay")).toEqual(["  perimeter.settings (env: PERIMETER_SETTINGS)"]);
  });

  // WHY: each settings section the overlay reads is a name of its own in the prd list, so render_env.py renders it.
  it.each(["api", "poller"])("a .env with only the prd names fails in overlay mode, ROLE=%s, without PERIMETER_SETTINGS_QUOTAS", (role) => {
    // Arrange
    const withoutQuotas = PRD.filter((n) => n !== "PERIMETER_SETTINGS_QUOTAS");

    // Act & Assert
    expect(missingWithOnly(withoutQuotas, "production", role, "overlay")).toEqual(["  perimeter.settings.quotas (env: PERIMETER_SETTINGS_QUOTAS)"]);
  });

  it("the validation really fails when a listed required name is absent", () => {
    // Arrange
    const withoutMongo = PRD.filter((n) => n !== "MONGO_URL");

    // Act & Assert
    expect(missingWithOnly(withoutMongo, "production")).toEqual(["  mongo.url (env: MONGO_URL)"]);
  });

  it("every listed name is read somewhere in src/", () => {
    // Arrange
    const source = sourceFiles(path.join(root, "src"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");

    // Act
    const unread = [...new Set([...PRD, ...DEV])].filter(
      (name) => !(name in KEPT_FOR_ROLLBACK) && !new RegExp(`\\b${name}\\b`).test(source),
    );

    // Assert
    expect(unread).toEqual([]);
  });

  it("a name kept for rollback is in both lists, read nowhere in src/, and no longer required", () => {
    // Arrange
    const source = sourceFiles(path.join(root, "src"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const required = new Set(REQUIRED);

    // Act
    const misplaced = Object.keys(KEPT_FOR_ROLLBACK).filter(
      (name) => !PRD.includes(name) || !DEV.includes(name) || required.has(name) || new RegExp(`\\b${name}\\b`).test(source),
    );

    // Assert
    expect(misplaced).toEqual([]);
  });

  it("no listed name is also set inline in docker-compose.yml", () => {
    // Act
    const inline = new Set(
      [...read("docker-compose.yml").matchAll(/^\s*-\s*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!),
    );

    // Assert
    expect(inline.size).toBeGreaterThan(0);
    expect(PRD.filter((name) => inline.has(name))).toEqual([]);
  });

  it.each([
    ["prd", PRD, "production", "api"],
    ["prd", PRD, "production", "poller"],
    ["prd", PRD, "production", "combined"],
    ["dev", DEV, "development", "combined"],
  ])("a %s .env without MONGO_CONTENT_DB_NAME fails the check in %s, ROLE=%s", (_label, names, nodeEnv, role) => {
    // Arrange
    const withoutContent = names.filter((n) => n !== "MONGO_CONTENT_DB_NAME");

    // Act & Assert
    expect(missingWithOnly(withoutContent, nodeEnv, role)).toEqual(["  content.dbName (env: MONGO_CONTENT_DB_NAME)"]);
  });

  it.each([
    ["prd", PRD],
    ["dev", DEV],
  ])("the %s list has no duplicates", (_label, names) => {
    // Act & Assert
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("an api replica without the pollers' keys", () => {
  const POLLER_NAMES = [...requiredValues({ NODE_ENV: "production" }).filter((v) => v.scope === "poller").map((v) => v.env), "API_HSSC_NEW_DEV"];
  const saved = new Map([...POLLER_NAMES, "ROLE"].map((name) => [name, process.env[name]]));
  let app: NestExpressApplication;

  beforeAll(async () => {
    for (const name of POLLER_NAMES) delete process.env[name];
    process.env.ROLE = "api";
    const { buildApiReplicaApp } = require("../../helpers/nest/api-replica-app") as { buildApiReplicaApp: BuildApiReplicaApp };
    app = await buildApiReplicaApp();
  });

  afterAll(async () => {
    await app?.close();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("passes the boot check with every poller-scoped name missing", () => {
    // Arrange
    const missing: string[] = [];

    // Act
    jest.isolateModules(() => {
      missing.push(...require("../../../src/infra/required-env").describeMissingRequired({ ...process.env, NODE_ENV: "production", SENTRY_DSN: "x" }));
    });

    // Assert
    expect(POLLER_NAMES.every((name) => process.env[name] === undefined)).toBe(true);
    expect(missing).toEqual([]);
  });

  it.each(["/bus/config", "/bus/realtime/data/jongro07", "/subway/stations/hyehwa/arrivals", "/map/overlays/transit"])(
    "serves %s from the stored data",
    async (url) => {
      // Act
      const res = await request(app.getHttpServer()).get(url);

      // Assert
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    },
  );
});

describe("README's Quick start .env", () => {
  // WHY: development reads API_HSSC_NEW_DEV before the required API_HSSC_NEW_PROD (apiUrl() in
  // src/infra/required-env.ts), so the README sets both and a reader sees which one development uses.
  const OPTIONAL_IN_README = ["API_HSSC_NEW_DEV"];
  const LOCAL_DEV_BOOT = { NODE_ENV: "development", PERIMETER_MODE: "local-dev", HOST: "127.0.0.1" };

  function readmeEnv(): Record<string, string> {
    const quickStart = read("README.md").split(/^## /m).find((section) => section.startsWith("Quick start"));
    const block = quickStart?.match(/```dotenv\n([\s\S]*?)```/)?.[1] ?? "";
    return Object.fromEntries([...block.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1]!, m[2]!]));
  }

  it("names exactly the values a local-dev development boot of the combined role requires, plus the allowed optional ones", () => {
    // Arrange
    const required = requiredValues(LOCAL_DEV_BOOT)
      .filter((v) => isRequiredIn(v.scope, "combined"))
      .map((v) => v.env);

    // Act
    const names = Object.keys(readmeEnv());

    // Assert
    expect(names.length).toBeGreaterThan(0);
    expect([...names].sort()).toEqual([...new Set([...required, ...OPTIONAL_IN_README])].sort());
  });

  it("passes the boot check with only its values set", () => {
    // Arrange
    const env = { ...readmeEnv(), ...LOCAL_DEV_BOOT };

    // Act & Assert
    expect(() => validateEnv(env)).not.toThrow();
  });
});

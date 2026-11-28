/**
 * An api replica writes nothing at boot (ADR 0012, D3): booted with ROLE=api on an
 * empty `mongod`, every module `src/app.module.ts` imports leaves the server
 * with no database, so no document, index or collection, and no seed. A poller
 * booted the same way ensures the indexes its repositories declare, which shows
 * the check can see a boot write within the same wait.
 *
 * Only `Clock` is overridden. The poller boot runs under a spy on
 * PollerRegistryService#registerPoller that registers nothing, so no tick calls
 * an upstream. An api boot fetches nothing (ADR 0012, D1): a stubbed
 * `fetch` records every URL it is asked for, and any other upstream call fails
 * the test through the network guard.
 *
 * The mirror for the poller (ADR 0012, D4): booted with ROLE=poller and every
 * api-scoped value deleted, each poller it registers runs once, its upstream
 * clients replaced by fakes, and none reads a value only api requires, which
 * src/infra/config.ts throws at that read. A poller may reject for another
 * reason (a fake answering nothing, an empty database).
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MongoClient } from "mongodb";
import { Clock } from "../../../src/infra/clock";
import { requiredValues } from "../../../src/infra/required-env";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod, MONGOD_STOP_TIMEOUT_MS } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BuildPollerApp = typeof import("../../helpers/nest/poller-app")["buildPollerApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];

const CLOCK = { now: (): Date => new Date("2026-10-20T01:00:00Z") };
const SYSTEM_DATABASES = new Set(["admin", "config", "local"]);
// WHY: an index setup still running when the boot returns finishes in the background (src/infra/mongo.ts).
const SETTLE_MS = 1_000;

let mongod: TestMongod;
let db: Db;
let config: Config;
let buildTestApp: BuildTestApp;
let PollerRegistryService: Registry;
let app: NestExpressApplication | undefined;
const realFetch = global.fetch;
const fetched: string[] = [];

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;
  PollerRegistryService = (require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry })
    .PollerRegistryService;
  global.fetch = (async (input: string | URL | Request) => {
    fetched.push(String(input));
    return new Response("", { status: 404 });
  }) as typeof fetch;
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  global.fetch = realFetch;
  try {
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
}, MONGOD_STOP_TIMEOUT_MS);

beforeEach(async () => {
  fetched.length = 0;
  for (const name of await userDatabases(db.getClient())) await db.getClient().db(name).dropDatabase();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

async function userDatabases(client: MongoClient): Promise<string[]> {
  const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
  return databases.map((d) => d.name).filter((name) => !SYSTEM_DATABASES.has(name));
}

async function bootAndSettle(role: "api" | "poller"): Promise<void> {
  jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation(() => undefined);
  app = await buildTestApp({
    imports: appModulesUnder("src/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role,
  });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

describe("booting every module on an empty database", () => {
  it("as an api replica creates no database, so no document, index or collection", async () => {
    // Act
    await bootAndSettle("api");

    // Assert
    expect(await userDatabases(db.getClient())).toEqual([]);
  }, APP_BOOT_TIMEOUT_MS);

  it("as an api replica fetches nothing", async () => {
    // Act
    await bootAndSettle("api");

    // Assert
    expect(fetched).toEqual([]);
  }, APP_BOOT_TIMEOUT_MS);

  it("as the poller ensures the indexes the repositories declare", async () => {
    // Act
    await bootAndSettle("poller");

    // Assert
    const busCacheIndexes = await db.getClient().db(config.mongo.dbName).collection(config.mongo.collections.busCache).indexes();
    expect(busCacheIndexes.map((index) => index.name)).toEqual(expect.arrayContaining(["_id_", expect.not.stringMatching(/^_id_$/)]));
    expect(await userDatabases(db.getClient())).toEqual(expect.arrayContaining([config.mongo.dbName, config.notices.dbName]));
  }, APP_BOOT_TIMEOUT_MS);
});

const isRoleScopeError = (err: unknown): boolean => err instanceof Error && /\(scope \w+\) is read in ROLE=/.test(err.message);

describe("running every poller once as ROLE=poller without the api-scoped values", () => {
  const API_NAMES = requiredValues({ NODE_ENV: "production" }).filter((v) => v.scope === "api").map((v) => v.env);
  const saved = new Map([...API_NAMES, "ROLE", "DISPATCH_SWEEP_ENABLED"].map((name) => [name, process.env[name]]));

  beforeAll(() => {
    for (const name of API_NAMES) delete process.env[name];
    process.env.ROLE = "poller";
    process.env.DISPATCH_SWEEP_ENABLED = "true";
  });

  afterAll(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("reads no value only api requires", async () => {
    // Arrange
    const pollers: Array<{ name: string; fn: () => unknown }> = [];
    jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation((fn, _intervalMs, name) => {
      pollers.push({ name, fn });
    });
    const { buildPollerApp } = require("../../helpers/nest/poller-app") as { buildPollerApp: BuildPollerApp };
    app = await buildPollerApp();

    // Act
    const outcomes = await Promise.all(
      pollers.map(async ({ name, fn }) => ({ name, err: await Promise.resolve().then(fn).then(() => null, (err: unknown) => err) })),
    );

    // Assert
    expect(API_NAMES).toEqual(expect.arrayContaining(["INTERNAL_DISPATCH_TOKEN"]));
    expect(pollers.map((poller) => poller.name)).toEqual(
      expect.arrayContaining(["hssc", "jongro-07", "jongro-path-07", "notices-dispatch-sweep", "shuttle-eta-live"]),
    );
    expect(outcomes.filter(({ err }) => isRoleScopeError(err))).toEqual([]);
  }, APP_BOOT_TIMEOUT_MS);
});

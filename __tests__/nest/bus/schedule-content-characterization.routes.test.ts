/**
 * Characterization of the shuttle schedule routes and the bus config
 * (ADR 0011, D6): the bytes, `Cache-Control`,
 * `Vary` and `ETag` that GET /bus/schedule/data/:serviceId/smart (in `ko`, `en`
 * and `zh`), /week (this week and the week of 2027-09-27) and /bus/config (in
 * all three) answer for every service, through the production pipeline with
 * only `Clock` overridden. The app boots every module `src/app.module.ts`
 * imports under `src/scheduling/` and `src/bus/`, over a real `mongod`.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The
 * expected values were pinned while each service's notices, its suspension and
 * SKKU's rest days were still committed in code, of which revision 1 of each
 * dataset, and so each fixture, is a copy; serving them from the content
 * database changed no byte here.
 *
 * The expected values are production's own answers
 * (fixtures/schedule-production.capture.json, source commit 5c0ee5a9), and the
 * clock stands at their capture instant, 01:56 KST on Tuesday 2026-10-20. The
 * `mongod` holds what production held then: the timetables as committed at
 * that source commit (fixtures/*-schedule.frozen.json, byte-identical copies
 * of scripts/data/*-schedule.json, built the way `npm run schedule` writes
 * them, with no override), the Jongno registry (fixtures/jongro-registry-routes.json
 * of bus), no stored public holiday, so date-holidays answers, and the content
 * database holds the fixtures of `bus-service-notices` and `skku-rest-days`
 * and the frozen copy of `bus-stops` (fixtures/bus-stops.frozen.dataset.json)
 * as revision 1, pushed the way `npm run data` stores them, through the tool's
 * own scripts/lib/datasets/store.js. The smart
 * view merges stored arrival estimates, which the pollers wrote from NAVER and
 * TMAP and no test can reproduce, so `shuttle_eta` is seeded from the captured
 * bodies themselves: one document per estimated run, its offsets the captured
 * stop times less the departure, its kind and time the captured source and
 * `updatedAt`. What the estimates feed is therefore taken from the capture;
 * every other byte (days, labels, notices, statuses, selected dates) and the
 * ETag over the whole body is production's.
 *
 * Cloudflare weakens the origin's ETag with `W/` when it compresses, so the
 * captured ETag is compared without that prefix.
 *
 * A suspension of `campus-inja` is pinned last, by an app of its own whose
 * clock stands inside the window, since the timetable caches a resolved week
 * and the suspension is read per request. Each case pushes the suspension as
 * the next revision before that app's first read and pushes revision 1's data
 * back after it.
 *
 * `/bus/config` changed on purpose after the capture: each realtime station carries its `stopId`, last. Its body is now
 * the captured one with exactly the stations' stop ids appended
 * (__tests__/helpers/bus/station-stop-ids.ts), its ETag the md5 of that JSON,
 * as `BusConfigService` computes it, and with every `stopId` removed it is the
 * captured body. The capture is unchanged.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod, MONGOD_STOP_TIMEOUT_MS } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { md5EtagOf, withStationStopIds, withoutStationStopIds } from "../../helpers/bus/station-stop-ids";
import { withLiveScreen, withoutLiveScreen } from "../../helpers/bus/live-screen";
import { withLineDirections, withoutLineDirections } from "../../helpers/bus/line-directions";
import captured from "./fixtures/schedule-production.capture.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BusRegistryHelpers = typeof import("../../helpers/bus/bus-registry");
type BusStopsHelpers = typeof import("../../helpers/bus/bus-stops");
type ScheduleContentHelpers = typeof import("../../helpers/bus/schedule-content");
type RestDaysHelpers = typeof import("../../helpers/calendar/rest-days");
type RouteAttributesHelpers = typeof import("../../helpers/bus/route-attributes");
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];
const SERVICE_IDS = Object.keys(captured.smart) as Array<keyof typeof captured.smart>;
const CAPTURED_AT = new Date(captured.capturedAt);
// 10:00 KST on Tuesday 2026-12-22, inside the suspension the last block sets.
const IN_SUSPENSION = new Date("2026-12-22T01:00:00.000Z");
const SUSPENSION = { from: "2026-12-21", until: "2027-02-28" };

interface Captured {
  status: number;
  etag: string;
  cacheControl: string;
  vary: string;
  body: { data: unknown };
}

interface CapturedEntry {
  time: string;
  routeType: string;
  stopTimes: Array<string | null>;
  eta?: { source: "frozen" | "predicted"; updatedAt: string };
}

interface CapturedDay {
  date: string;
  schedule: CapturedEntry[];
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const offsetSecOf = (departure: string, at: string | null): number => (at === null ? 0 : (((minutesOf(at) - minutesOf(departure)) % 1440) + 1440) % 1440) * 60;
const originEtagOf = (etag: string): string => etag.replace(/^W\//, "");

/** One `shuttle_eta` document per estimated run of a captured smart body, as the pollers stored it. */
function estimatesOf(serviceId: string, days: CapturedDay[]): Array<Record<string, unknown>> {
  return days.flatMap((day) =>
    day.schedule.flatMap((entry) => {
      if (!entry.eta) return [];
      const frozen = entry.eta.source === "frozen";
      const kind = frozen ? "live" : "baseline";
      const fetchedAt = new Date(entry.eta.updatedAt);
      return [
        {
          _id: `${serviceId}|${entry.routeType}|${day.date}|${entry.time}|${kind}`,
          kind,
          serviceId,
          routeType: entry.routeType,
          date: day.date,
          time: entry.time,
          departAt: new Date(`${day.date}T${entry.time}:00+09:00`),
          offsetsSec: entry.stopTimes.map((at) => offsetSecOf(entry.time, at)),
          source: frozen ? "naver" : "tmap",
          fetchedAt,
          ...(frozen ? { frozen: true, frozenAt: fetchedAt } : {}),
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        },
      ];
    }),
  );
}

const FROZEN_PATTERNS = ["campus-schedule.frozen.json", "commute-schedule.frozen.json"].flatMap((file) =>
  buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8")))),
);

let mongod: TestMongod;
let db: Db;
let buildTestApp: BuildTestApp;
let app: NestExpressApplication;
let content: import("mongodb").Db;

const STORED_BY = { by: "characterization@example.com", now: CAPTURED_AT };

/** Pushes `campus-inja` suspended as the next revision of bus-service-notices; the returned call pushes revision 1's data back. */
async function storeSuspension(suspend: { from: string; until: string }): Promise<() => Promise<void>> {
  const { serviceNoticesFixture, serviceNoticesWithSuspension } = require("../../helpers/bus/schedule-content") as ScheduleContentHelpers;
  const pushNext = async (data: unknown) => {
    const { revision } = await store.readDataset(content, "bus-service-notices");
    await store.push(content, "bus-service-notices", data, { baseRevision: revision, ...STORED_BY });
  };
  await pushNext(serviceNoticesWithSuspension("campus-inja", suspend));
  return () => pushNext(serviceNoticesFixture());
}

async function bootAt(at: Date): Promise<NestExpressApplication> {
  const clock: Clock = { now: () => at };
  return buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/"),
    overrides: [{ provide: Clock, useValue: clock }],
    role: "api",
  });
}

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;
  const { storedJongroRouteDocuments } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  const busDb = db.getClient().db(config.mongo.dbName);
  await busDb.collection("bus_schedules").insertMany(FROZEN_PATTERNS);
  await busDb.collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes).insertMany(storedJongroRouteDocuments());
  const estimates = SERVICE_IDS.flatMap((serviceId) => estimatesOf(serviceId, (captured.smart[serviceId].ko.body.data as { days: CapturedDay[] }).days));
  await busDb.collection("shuttle_eta").insertMany(estimates);
  content = db.getClient().db(config.content.dbName);
  const { serviceNoticesFixture } = require("../../helpers/bus/schedule-content") as ScheduleContentHelpers;
  const { restDaysFixture } = require("../../helpers/calendar/rest-days") as RestDaysHelpers;
  await store.create(content, "bus-service-notices", serviceNoticesFixture(), STORED_BY);
  await store.create(content, "skku-rest-days", restDaysFixture(), STORED_BY);
  const { routeAttributesFixture } = require("../../helpers/bus/route-attributes") as RouteAttributesHelpers;
  await store.create(content, "jongro-route-attributes", routeAttributesFixture(), STORED_BY);
  const { frozenBusStopsFixture } = require("../../helpers/bus/bus-stops") as BusStopsHelpers;
  await store.create(content, "bus-stops", frozenBusStopsFixture(), STORED_BY);
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  app = await bootAt(CAPTURED_AT);
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
}, MONGOD_STOP_TIMEOUT_MS);

function expectCaptured(res: request.Response, capture: Captured): void {
  expect(res.status).toBe(capture.status);
  expect(res.body).toEqual(capture.body);
  expect(res.text).toBe(JSON.stringify(capture.body));
  expect(res.headers["cache-control"]).toBe(capture.cacheControl);
  expect(res.headers.vary).toBe(capture.vary);
  expect(res.headers.etag).toBe(originEtagOf(capture.etag));
}

describe("GET /bus/schedule/data/:serviceId/smart at the capture", () => {
  it.each(SERVICE_IDS.flatMap((serviceId) => LANGS.map((lang) => [serviceId, lang] as const)))(
    "answers %s in %s with the bytes and ETag production served",
    async (serviceId, lang) => {
      // Act
      const res = await request(app.getHttpServer()).get(`/bus/schedule/data/${serviceId}/smart`).set("Accept-Language", lang);

      // Assert
      expectCaptured(res, captured.smart[serviceId][lang]);
    },
  );
});

describe("GET /bus/schedule/data/:serviceId/week at the capture", () => {
  it.each(SERVICE_IDS)("answers %s's current week with the bytes and ETag production served", async (serviceId) => {
    // Act
    const res = await request(app.getHttpServer()).get(`/bus/schedule/data/${serviceId}/week`).set("Accept-Language", "ko");

    // Assert
    expectCaptured(res, captured.week[serviceId]);
  });

  it.each(SERVICE_IDS)("answers %s's week of 2027-09-27 with the bytes and ETag production served", async (serviceId) => {
    // Act
    const res = await request(app.getHttpServer()).get(`/bus/schedule/data/${serviceId}/week?from=2027-09-27`).set("Accept-Language", "ko");

    // Assert
    expectCaptured(res, captured.week2027[serviceId]);
  });

  it("serves 2027-09-28 as a no-service day labelled 공자탄신일 on a holiday-respecting service only", async () => {
    // Act
    const inja = await request(app.getHttpServer()).get("/bus/schedule/data/campus-inja/week?from=2027-09-27");
    const fasttrack = await request(app.getHttpServer()).get("/bus/schedule/data/fasttrack-inja/week?from=2027-09-27");

    // Assert
    expect(inja.body.data.days[1]).toEqual({ date: "2027-09-28", dayOfWeek: 2, display: "noService", label: "공자탄신일", notices: [], schedule: [] });
    expect(fasttrack.body.data.days[1]).toMatchObject({ date: "2027-09-28", display: "hidden", label: null });
  });
});

describe("GET /bus/config at the capture", () => {
  it.each(LANGS)("answers in %s with the bytes production served with only the realtime stations' stop ids and screens' live fields appended, and their ETag", async (lang) => {
    // Arrange
    const capture = captured.config[lang];
    const groups = (capture.body.data as { groups: Array<{ id: string }> }).groups.map((group) => withLineDirections(withLiveScreen(withStationStopIds(group)), lang, { hasStoredLines: false }));
    const expected = { ...capture, etag: md5EtagOf(groups), body: { ...capture.body, data: { groups } } };

    // Act
    const res = await request(app.getHttpServer()).get("/bus/config").set("Accept-Language", lang);

    // Assert
    expectCaptured(res, expected);
    expect(withoutLineDirections(withoutStationStopIds(withoutLiveScreen(res.body.data)))).toEqual(capture.body.data);
    expect(res.headers.etag).not.toBe(originEtagOf(capture.etag));
  });
});

describe("GET /bus/schedule/data/campus-inja/smart inside a suspension", () => {
  const MESSAGES: Record<Lang, string> = { ko: "운휴 기간입니다", en: "Service is suspended", zh: "停运期间" };
  let suspended: NestExpressApplication;

  beforeAll(async () => {
    suspended = await bootAt(IN_SUSPENSION);
  }, APP_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await suspended?.close();
  });

  it.each(LANGS)("answers in %s suspended until the day after the window, with no day", async (lang) => {
    // Arrange
    const restore = await storeSuspension(SUSPENSION);
    const data = { serviceId: "campus-inja", status: "suspended", resumeDate: "2027-03-01", from: null, selectedDate: null, days: [], message: MESSAGES[lang] };
    let res: request.Response;

    // Act
    try {
      res = await request(suspended.getHttpServer()).get("/bus/schedule/data/campus-inja/smart").set("Accept-Language", lang);
    } finally {
      await restore();
    }

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify({ meta: { lang }, data }));
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(`"smart-campus-inja-suspended-${crypto.createHash("md5").update(JSON.stringify(data)).digest("hex")}"`);
  });
});

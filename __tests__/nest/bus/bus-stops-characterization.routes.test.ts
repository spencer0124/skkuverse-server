/**
 * Characterization of every route and poller that reads the stop catalog
 * (src/bus/stops/schedule-stops.json) or the HSSC line (`HSSC_STATIONS`),
 * before both move into the `bus-stops` dataset (ADR 0011, D6). `/bus/config` and each `/bus/config/:groupId`,
 * `/ui/home/transit` and `/ui/home/transitlist`, and `/smart` and `/week` of
 * every service answer, in `ko`, `en` and `zh`, the bytes, `Cache-Control`,
 * `Vary` and `ETag` production served on 2026-10-21
 * (fixtures/bus-stops-production.capture.json, source commit 607051df);
 * `/bus/realtime/data/:groupId` answers the bodies today's code gives the
 * `bus_cache` rows seeded below; one `shuttle-eta-live` and one
 * `shuttle-eta-baseline` tick store the estimates, and send NAVER and TMAP the
 * stop coordinates, pinned below.
 *
 * The api app boots every module `src/app.module.ts` imports under
 * `src/scheduling/`, `src/bus/`, `src/ui/transit-list/` and `src/ui/transit/`,
 * through the production pipeline with only `Clock` overridden, at the
 * capture's instant (22:52 KST on Wednesday 2026-10-21, after the day's last
 * run). The `mongod` holds what production held then: the timetables as
 * committed at the source commit (fixtures/*-schedule.frozen.json,
 * byte-identical copies of scripts/data/*-schedule.json, built the way
 * `npm run schedule` writes them), the Jongno registry and route lines
 * (fixtures/jongro-registry-routes.json and jongro-route-paths.json, the
 * stations versions the captures carry), the `bus_cache` rows below, and in
 * the content database revision 1 of `transit-layout`, `miniapps`,
 * `jongro-route-attributes`, `bus-service-notices`, `skku-rest-days` and
 * `bus-lane-corridor`, and of `bus-stops` as its frozen copy
 * (fixtures/bus-stops.frozen.dataset.json), stored through the tool's own
 * scripts/lib/datasets/store.js. The smart view merges stored estimates the
 * pollers wrote from NAVER and TMAP, so `shuttle_eta` is seeded from the
 * captured bodies themselves (one document per estimated run, its offsets the
 * captured stop times less the departure); every other byte and the ETag over
 * the whole body is production's.
 *
 * The ticks run on poller apps of their own, over scripted NAVER, TMAP and
 * TOPIS whose answers follow the stop coordinates sent (one second per 10 m
 * along the stops), with `shuttle_eta` emptied first: the live tick at 16:30
 * KST on Thursday 2026-10-22, when the 16:30 campus runs depart and the 17:00
 * commute runs are in their window, and the baseline tick at 20:00 KST on
 * Friday 2026-10-23.
 *
 * A regression pin: a failure is a regression to report, and an expected
 * value changes only with the behavior it pins (`.claude/rules/tests.md`).
 * Cloudflare weakens the origin's ETag with `W/` when it compresses, so ETags
 * are compared without that prefix.
 *
 * One pinned behavior changed on purpose after the capture: each realtime station of `/bus/config` and of the `hssc` and Jongro
 * groups carries its `stopId`, last. Those bodies are now the captured ones
 * with exactly the stations' stop ids appended
 * (__tests__/helpers/bus/station-stop-ids.ts), and their ETags the md5 of that
 * JSON, as `BusConfigService` computes every config ETag; with every `stopId`
 * removed each is the captured body, and the captured ETag no longer answers
 * 304. The capture itself is unchanged, and the schedule groups still answer
 * its bytes and ETags.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Db as MongoDb } from "mongodb";
import request from "supertest";
import type { BusCacheDocument } from "../../../src/bus/cache/bus-cache.document";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import type { JongroRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.document";
import { Clock } from "../../../src/infra/clock";
import type { LatLng } from "../../../src/shared/lat-lng.types";
import { hsscBusDoc, jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc, noArrivalBus } from "../../helpers/bus/bus-cache-docs";
import { FakeBusEtaForecastClient } from "../../helpers/fakes/bus/bus-eta-forecast.client.fake";
import { FakeBusEtaProbeClient } from "../../helpers/fakes/bus/bus-eta-probe.client.fake";
import { FakeBusEtaTravelClient } from "../../helpers/fakes/bus/bus-eta-travel.client.fake";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod, MONGOD_STOP_TIMEOUT_MS } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { md5EtagOf, withStationStopIds, withoutStationStopIds } from "../../helpers/bus/station-stop-ids";
import { withLiveScreen, withoutLiveScreen } from "../../helpers/bus/live-screen";
import { withLineDirections, withoutLineDirections } from "../../helpers/bus/line-directions";
import captured from "./fixtures/bus-stops-production.capture.json";
import storedRoutes from "./fixtures/jongro-registry-routes.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BuildBusPollerApp = typeof import("../../helpers/bus/bus-poller-app")["buildBusPollerApp"];
type BusRegistryHelpers = typeof import("../../helpers/bus/bus-registry");
type BusStopsHelpers = typeof import("../../helpers/bus/bus-stops");
type BusRoutePathHelpers = typeof import("../../helpers/bus/bus-route-path");
type BusLaneCorridorHelpers = typeof import("../../helpers/bus/bus-lane-corridor");
type ScheduleContentHelpers = typeof import("../../helpers/bus/schedule-content");
type RestDaysHelpers = typeof import("../../helpers/calendar/rest-days");
type RouteAttributesHelpers = typeof import("../../helpers/bus/route-attributes");
type RegistryFixture = typeof import("../../helpers/miniapps/registry-fixture");
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];
const GROUP_IDS = ["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"] as const;
const SCHEDULE_GROUP_IDS = GROUP_IDS.filter((groupId) => !["hssc", "jongro02", "jongro07", "jongro08"].includes(groupId));
const ROUTE_IDS = ["jongro02", "jongro07", "jongro08"] as const;
type RouteId = (typeof ROUTE_IDS)[number];
const SERVICE_IDS = Object.keys(captured.smart) as Array<keyof typeof captured.smart>;
const REALTIME_IDS = ["hssc", ...ROUTE_IDS] as const;

const CAPTURED_AT = new Date(captured.capturedAt);
const STORED_BY = { by: "characterization@example.com", now: CAPTURED_AT };
// WHY: mongod's TTL monitor drops a bus_cache key a minute after `_updatedAt` by the wall clock; a seed dated
// a year ahead outlives the suite. No reader of bus_cache reads `_updatedAt`.
const CACHE_UPDATED_AT = new Date(Date.now() + 365 * 24 * 60 * 60_000);
const VARY = "Accept-Language, Origin";

interface Captured {
  status: number;
  etag: string | null;
  cacheControl: string | null;
  vary: string;
  body: unknown;
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

interface GroupBody {
  id: string;
}

// QUIRK(express): the default weak ETag, W/"<length hex>-<first 27 chars of the base64 SHA-1>" of the body bytes.
function weakEtagOf(text: string): string {
  const body = Buffer.from(text, "utf8");
  const hash = crypto.createHash("sha1").update(body).digest("base64").substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

const originEtagOf = (etag: string | null | undefined): string | null | undefined => etag?.replace(/^W\//, "");
const configCapture = (lang: Lang) => captured.config[lang] as Captured & { groupEtags: Record<string, string>; body: { data: { groups: GroupBody[] } } };
const groupOf = (lang: Lang, groupId: string): GroupBody => configCapture(lang).body.data.groups.find((group) => group.id === groupId)!;

function smartDataOf(serviceId: keyof typeof captured.smart, lang: Lang): unknown {
  const data = captured.smart[serviceId].data as Record<string, unknown>;
  return data["*"] ?? data[lang];
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const offsetSecOf = (departure: string, at: string | null): number => (at === null ? 0 : (((minutesOf(at) - minutesOf(departure)) % 1440) + 1440) % 1440) * 60;

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

// Three HSSC buses as the poller writes them: after the turnaround (seq 6 → 2), at 혜화역 (seq 0 → 7) and the last
// bus before 600주년기념관 (seq 4 → 11).
const SEEDED_HSSC = [
  hsscBusDoc({ line_no: "32149", stop_no: "285688", seq: "6", stop_name: "600주년기념관 앞-하교", get_date: "2026-10-21 오후 10:51:10", sequence: "2", stationName: "600주년기념관", carNumber: "0000", eventDate: "2026-10-21 22:51:10", estimatedTime: 75 }),
  hsscBusDoc({ line_no: "32150", stop_no: "285682", seq: "0", stop_name: "혜화역 1번출구 셔틀버스 정류소", get_date: "2026-10-21 오후 10:50:05", sequence: "7", stationName: "혜화역 1번출구 (셔틀버스정류소)", carNumber: "0001", eventDate: "2026-10-21 22:50:05", estimatedTime: 140 }),
  hsscBusDoc({ line_no: "32151", stop_no: "285686", seq: "4", stop_name: "600주년기념관 앞-등교", get_date: "2026-10-21 오후 10:52:00", sequence: "11", stationName: "600주년기념관", carNumber: "0002", eventDate: "2026-10-21 22:52:00", estimatedTime: 25, isLastBus: true }),
];

function stationOf(routeId: RouteId, index: number): { topisId: string; arsId: string; stationName: string } {
  return storedRoutes.routes.find((route) => route.id === routeId)!.stations[index]!;
}

/** One bus between the stored stations 0 and 1 of a route, and its arrival row at station 1. */
function jongroSeed(routeId: RouteId, vehId: string, plainNo: string) {
  const at = stationOf(routeId, 0);
  const next = stationOf(routeId, 1);
  const first = jongroArrivalBus({ staOrd: 2, sectOrd: 1, vehId, plainNo, traTime: 150, arrmsg: "2분30초후[1번째 전]", rerideDiv: 2, rerideNum: 12 });
  return {
    arrivals: [
      jongroArrivalDoc({
        stationId: next.topisId,
        sequence: "2",
        stationName: next.stationName,
        stationNumber: next.arsId,
        eta: first.arrmsg,
        eventDate: "2026-10-21 22:51:30.0",
        buses: [first, noArrivalBus({ staOrd: 2, arrmsg: "출발대기" })],
      }),
    ],
    positions: [
      jongroPositionDoc({
        sequence: "1",
        stationName: at.stationName,
        stationId: at.topisId,
        carNumber: plainNo.slice(-4),
        vehicleId: vehId,
        eventDate: "2026-10-21T13:51:30.000Z",
        recordTime: "2026-10-21T13:51:30.000Z",
        observedAt: "2026-10-21T22:51:30+09:00",
      }),
    ],
  };
}

const SEEDED_JONGRO: Record<RouteId, ReturnType<typeof jongroSeed>> = {
  jongro02: jongroSeed("jongro02", "100000201", "서울74사1802"),
  jongro07: jongroSeed("jongro07", "100000207", "서울74사2707"),
  jongro08: jongroSeed("jongro08", "100000208", "서울74사0808"),
};

function fixtureTransitLayout(): Record<string, unknown> {
  const file = path.join(__dirname, "../ui/fixtures/transit-layout.dataset.json");
  const layout = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

let mongod: TestMongod;
let db: Db;
let config: Config;
let busDb: MongoDb;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  busDb = db.getClient().db(config.mongo.dbName);
  await busDb.collection("bus_schedules").insertMany(FROZEN_PATTERNS);
  const { storedJongroRouteDocuments } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  await busDb.collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes).insertMany(storedJongroRouteDocuments());
  const { storedJongroRoutePathDocuments } = require("../../helpers/bus/bus-route-path") as BusRoutePathHelpers;
  await busDb.collection<JongroRoutePathDocument>(config.mongo.collections.jongroRoutePaths).insertMany(storedJongroRoutePathDocuments());
  const cacheDocs = [
    { _id: "hssc", data: SEEDED_HSSC, _updatedAt: CACHE_UPDATED_AT },
    ...ROUTE_IDS.flatMap((routeId) => {
      const code = routeId.slice("jongro".length);
      return [
        { _id: `jongro_stations_${code}`, data: SEEDED_JONGRO[routeId].arrivals, _updatedAt: CACHE_UPDATED_AT },
        { _id: `jongro_locations_${code}`, data: SEEDED_JONGRO[routeId].positions, _updatedAt: CACHE_UPDATED_AT },
      ];
    }),
  ];
  await busDb.collection<BusCacheDocument>(config.mongo.collections.busCache).insertMany(cacheDocs as unknown as BusCacheDocument[]);
  const estimates = SERVICE_IDS.flatMap((serviceId) => estimatesOf(serviceId, (smartDataOf(serviceId, "ko") as { days?: CapturedDay[] }).days ?? []));
  await busDb.collection("shuttle_eta").insertMany(estimates);
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "transit-layout", fixtureTransitLayout(), STORED_BY);
  const { fixtureRegistry } = require("../../helpers/miniapps/registry-fixture") as RegistryFixture;
  await store.create(content, "miniapps", fixtureRegistry(), STORED_BY);
  const { routeAttributesFixture } = require("../../helpers/bus/route-attributes") as RouteAttributesHelpers;
  await store.create(content, "jongro-route-attributes", routeAttributesFixture(), STORED_BY);
  const { frozenBusStopsFixture } = require("../../helpers/bus/bus-stops") as BusStopsHelpers;
  await store.create(content, "bus-stops", frozenBusStopsFixture(), STORED_BY);
  const { serviceNoticesFixture } = require("../../helpers/bus/schedule-content") as ScheduleContentHelpers;
  const { restDaysFixture } = require("../../helpers/calendar/rest-days") as RestDaysHelpers;
  await store.create(content, "bus-service-notices", serviceNoticesFixture(), STORED_BY);
  await store.create(content, "skku-rest-days", restDaysFixture(), STORED_BY);
  const { corridorFixture } = require("../../helpers/bus/bus-lane-corridor") as BusLaneCorridorHelpers;
  await store.create(content, "bus-lane-corridor", corridorFixture(), STORED_BY);
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  const clock: Clock = { now: () => new Date(CAPTURED_AT) };
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/", "src/ui/transit-list/", "src/ui/transit/"),
    overrides: [{ provide: Clock, useValue: clock }],
    role: "api",
  });
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await clearCollections(busDb);
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
}, MONGOD_STOP_TIMEOUT_MS);

const get = (url: string, lang: Lang) => request(app.getHttpServer()).get(url).set("Accept-Language", lang);

function expectCaptured(res: request.Response, capture: Captured): void {
  expect(res.status).toBe(capture.status);
  expect(res.body).toEqual(capture.body);
  expect(res.text).toBe(JSON.stringify(capture.body));
  expect(res.headers["cache-control"]).toBe(capture.cacheControl ?? undefined);
  expect(res.headers.vary).toBe(capture.vary);
  expect(originEtagOf(res.headers.etag)).toBe(originEtagOf(capture.etag));
}

/** The capture with every realtime station's stop id and each realtime screen's live fields (ADR 0019) appended and its directions inserted (D16), as served after it, and its ETag. */
function configFromWave4(lang: Lang): Captured {
  const capture = configCapture(lang);
  const groups = capture.body.data.groups.map((group) => withLineDirections(withLiveScreen(withStationStopIds(group)), lang));
  return { ...capture, etag: md5EtagOf(groups), body: { ...capture.body, data: { ...capture.body.data, groups } } };
}

describe("GET /bus/config", () => {
  it.each(LANGS)("answers in %s the bytes production served with only the realtime stations' stop ids and screens' live fields appended, and their ETag", async (lang) => {
    // Act
    const res = await get("/bus/config", lang);

    // Assert
    expectCaptured(res, configFromWave4(lang));
    expect(withoutLineDirections(withoutStationStopIds(withoutLiveScreen(res.body.data)))).toEqual(configCapture(lang).body.data);
    expect(originEtagOf(res.headers.etag)).not.toBe(originEtagOf(configCapture(lang).etag));
  });

  it.each(LANGS)("answers 304 in %s to the ETag from wave 4, and 200 to the one production served before it", async (lang) => {
    // Act
    const current = await get("/bus/config", lang).set("If-None-Match", configFromWave4(lang).etag!);
    const before = await get("/bus/config", lang).set("If-None-Match", configCapture(lang).etag!);

    // Assert
    expect(current.status).toBe(304);
    expect(current.text).toBe("");
    expect(before.status).toBe(200);
  });
});

describe("GET /bus/config/:groupId", () => {
  it.each(LANGS.flatMap((lang) => (["hssc", "jongro02", "jongro07", "jongro08"] as const).map((groupId) => [lang, groupId] as const)))(
    "answers in %s for %s the group production served with only its stations' stop ids appended, and its ETag",
    async (lang, groupId) => {
      // Arrange
      const capture = configCapture(lang);
      const group = withLineDirections(withLiveScreen(withStationStopIds(groupOf(lang, groupId))), lang);
      const expected = { status: 200, etag: md5EtagOf(group), cacheControl: capture.cacheControl, vary: capture.vary, body: { meta: { lang }, data: group } };

      // Act
      const res = await get(`/bus/config/${groupId}`, lang);

      // Assert
      expectCaptured(res, expected);
      expect(withoutLineDirections(withoutStationStopIds(withoutLiveScreen(res.body.data)))).toEqual(groupOf(lang, groupId));
      expect(originEtagOf(res.headers.etag)).not.toBe(originEtagOf(capture.groupEtags[groupId]));
    },
  );

  it.each(LANGS.flatMap((lang) => SCHEDULE_GROUP_IDS.map((groupId) => [lang, groupId] as const)))(
    "answers in %s for %s the group production served, with its ETag",
    async (lang, groupId) => {
      // Arrange
      const capture = configCapture(lang);
      const expected = { status: 200, etag: capture.groupEtags[groupId]!, cacheControl: capture.cacheControl, vary: capture.vary, body: { meta: { lang }, data: groupOf(lang, groupId) } };

      // Act
      const res = await get(`/bus/config/${groupId}`, lang);

      // Assert
      expectCaptured(res, expected);
    },
  );
});

describe("GET /ui/home/transit and /ui/home/transitlist", () => {
  it.each(LANGS)("answers /ui/home/transit in %s with the bytes and ETag production served", async (lang) => {
    // Act
    const res = await get("/ui/home/transit", lang);

    // Assert
    expectCaptured(res, captured.transit[lang]);
  });

  it.each(LANGS)("answers /ui/home/transitlist in %s with the bytes and ETag production served, with no Cache-Control", async (lang) => {
    // Act
    const res = await get("/ui/home/transitlist", lang);

    // Assert
    expectCaptured(res, captured.transitlist[lang]);
  });
});

describe("GET /bus/schedule/data/:serviceId/smart and /week", () => {
  it.each(SERVICE_IDS.flatMap((serviceId) => LANGS.map((lang) => [serviceId, lang] as const)))(
    "answers %s's smart view in %s with the bytes and ETag production served",
    async (serviceId, lang) => {
      // Arrange
      const capture = captured.smart[serviceId];
      const expected = { status: capture.status, etag: capture.etag[lang], cacheControl: capture.cacheControl, vary: capture.vary, body: { meta: { lang }, data: smartDataOf(serviceId, lang) } };

      // Act
      const res = await get(`/bus/schedule/data/${serviceId}/smart`, lang);

      // Assert
      expectCaptured(res, expected);
    },
  );

  it.each(SERVICE_IDS.flatMap((serviceId) => LANGS.map((lang) => [serviceId, lang] as const)))(
    "answers %s's current week in %s with the bytes and ETag production served",
    async (serviceId, lang) => {
      // Act
      const res = await get(`/bus/schedule/data/${serviceId}/week`, lang);

      // Assert
      expectCaptured(res, captured.week[serviceId]);
    },
  );
});

// The bodies today's code answers for the seeded bus_cache, without `meta.lang`; the three languages differ only there.
const REALTIME_BODIES: Record<(typeof REALTIME_IDS)[number], { meta: Record<string, unknown>; data: Record<string, unknown> }> = {
  hssc: {
    meta: { currentTime: "10:52 PM", totalBuses: 3, serverNow: "2026-10-21T22:52:25+09:00" },
    data: {
      groupId: "hssc",
      buses: [
        { stationIndex: 1, carNumber: "0000", estimatedTime: 75, kind: "estimated" },
        { stationIndex: 6, carNumber: "0001", estimatedTime: 140, kind: "estimated" },
        { stationIndex: 10, carNumber: "0002", estimatedTime: 25, kind: "estimated" },
      ],
      stationEtas: [],
    },
  },
  jongro02: {
    meta: { currentTime: "10:52 PM", totalBuses: 1, serverNow: "2026-10-21T22:52:25+09:00" },
    data: {
      groupId: "jongro02",
      buses: [
        {
          stationIndex: 0,
          carNumber: "1802",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000201",
            observedAt: "2026-10-21T22:51:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 150,
            trajectory: [
              { at: "2026-10-21T22:51:30+09:00", s: 0.5 },
              { at: "2026-10-21T22:54:00+09:00", s: 1 },
            ],
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 1,
          eta: "2분30초후[1번째 전]",
          arrivals: [
            { minutes: 3, stopsAway: 1, state: "running", isLastBus: false, carNumber: "1802", crowding: "relaxed", passengerCount: 12, message: "2분30초후[1번째 전]" },
            { minutes: null, stopsAway: null, state: "waiting", isLastBus: false, carNumber: null, crowding: null, passengerCount: null, message: "출발대기" },
          ],
        },
      ],
      stationsVersion: "76d8e6770cda23aa",
    },
  },
  jongro07: {
    meta: { currentTime: "10:52 PM", totalBuses: 1, serverNow: "2026-10-21T22:52:25+09:00" },
    data: {
      groupId: "jongro07",
      buses: [
        {
          stationIndex: 0,
          carNumber: "2707",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000207",
            observedAt: "2026-10-21T22:51:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 150,
            trajectory: [
              { at: "2026-10-21T22:51:30+09:00", s: 0.5 },
              { at: "2026-10-21T22:54:00+09:00", s: 1 },
            ],
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 1,
          eta: "2분30초후[1번째 전]",
          arrivals: [
            { minutes: 3, stopsAway: 1, state: "running", isLastBus: false, carNumber: "2707", crowding: "relaxed", passengerCount: 12, message: "2분30초후[1번째 전]" },
            { minutes: null, stopsAway: null, state: "waiting", isLastBus: false, carNumber: null, crowding: null, passengerCount: null, message: "출발대기" },
          ],
        },
      ],
      stationsVersion: "0346768f2b776f45",
    },
  },
  jongro08: {
    meta: { currentTime: "10:52 PM", totalBuses: 1, serverNow: "2026-10-21T22:52:25+09:00" },
    data: {
      groupId: "jongro08",
      buses: [
        {
          stationIndex: 0,
          carNumber: "0808",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000208",
            observedAt: "2026-10-21T22:51:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 150,
            trajectory: [
              { at: "2026-10-21T22:51:30+09:00", s: 0.5 },
              { at: "2026-10-21T22:54:00+09:00", s: 1 },
            ],
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 1,
          eta: "2분30초후[1번째 전]",
          arrivals: [
            { minutes: 3, stopsAway: 1, state: "running", isLastBus: false, carNumber: "0808", crowding: "relaxed", passengerCount: 12, message: "2분30초후[1번째 전]" },
            { minutes: null, stopsAway: null, state: "waiting", isLastBus: false, carNumber: null, crowding: null, passengerCount: null, message: "출발대기" },
          ],
        },
      ],
      stationsVersion: "52e82cc449046288",
    },
  },
};

describe("GET /bus/realtime/data/:groupId", () => {
  it.each(LANGS.flatMap((lang) => REALTIME_IDS.map((groupId) => [lang, groupId] as const)))(
    "answers in %s for %s the seeded buses, uncached, with production's group id and stations version",
    async (lang, groupId) => {
      // Arrange
      const { meta, data } = REALTIME_BODIES[groupId];
      const expected = { meta: { lang, ...meta }, data };

      // Act
      const res = await get(`/bus/realtime/data/${groupId}`, lang);

      // Assert
      expect(res.status).toBe(captured.realtime[groupId].status);
      expect(res.body.data.groupId).toBe(captured.realtime[groupId].groupId);
      expect(res.body.data.stationsVersion).toBe(captured.realtime[groupId].stationsVersion ?? undefined);
      expect(res.text).toBe(JSON.stringify(expected));
      expect(res.headers["cache-control"]).toBe(captured.realtime[groupId].cacheControl);
      expect(res.headers.vary).toBe(VARY);
      expect(res.headers.etag).toBe(weakEtagOf(res.text));
    },
  );
});

/** One second per 10 m along the stops, so a moved stop changes every later offset. */
function offsetsAlong(stops: readonly LatLng[]): number[] {
  const { haversineM } = require("../../../src/shared/distance.util") as typeof import("../../../src/shared/distance.util");
  let sum = 0;
  return stops.map((stop, index) => {
    if (index > 0) sum += Math.round(haversineM(stops[index - 1]!, stop) / 10);
    return sum;
  });
}

interface PollerTick {
  naver: FakeBusEtaTravelClient;
  tmap: FakeBusEtaForecastClient;
  topis: FakeBusEtaProbeClient;
  tickAt(name: string, now: Date): Promise<unknown>;
  close(): Promise<void>;
}

async function bootPoller(): Promise<PollerTick> {
  const { buildBusPollerApp } = require("../../helpers/bus/bus-poller-app") as { buildBusPollerApp: BuildBusPollerApp };
  const { PollerRegistryService } = require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry };
  const ticks = new Map<string, () => unknown>();
  const spy = jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation((fn, _intervalMs, name) => {
    ticks.set(name, fn);
  });
  let now = CAPTURED_AT;
  const naver = new FakeBusEtaTravelClient();
  naver.offsetsOf = offsetsAlong;
  const tmap = new FakeBusEtaForecastClient();
  tmap.offsetsOf = offsetsAlong;
  const topis = new FakeBusEtaProbeClient();
  const poller = await buildBusPollerApp({ naver, topis, tmap, clock: { now: () => now } });
  spy.mockRestore();
  return {
    naver,
    tmap,
    topis,
    tickAt: async (name, instant) => {
      now = instant;
      const tick = ticks.get(name);
      if (!tick) throw new Error(`${name} was not registered`);
      return tick();
    },
    close: () => poller.close(),
  };
}

const storedEstimates = () => busDb.collection("shuttle_eta").find({}).sort({ _id: 1 }).toArray();

describe("the shuttle ETA ticks", () => {
  beforeEach(async () => {
    await busDb.collection("shuttle_eta").deleteMany({});
  });

  it("stores the live value of every run due at 16:30 KST on Thursday, from the catalog's stops", async () => {
    // Arrange
    const poller = await bootPoller();

    // Act
    let result: unknown;
    try {
      result = await poller.tickAt("shuttle-eta-live", new Date("2026-10-22T16:30:00+09:00"));
    } finally {
      await poller.close();
    }

    // Assert
    expect(result).toEqual({ calls: 8, written: 8 });
    expect(await storedEstimates()).toEqual([
      { _id: "campus-inja|regular|2026-10-22|16:30|live", kind: "live", serviceId: "campus-inja", routeType: "regular", date: "2026-10-22", time: "16:30", departAt: new Date("2026-10-22T07:30:00.000Z"), offsetsSec: [0, 3285], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), frozen: true, frozenAt: new Date("2026-10-22T07:30:00.000Z"), travel: { model: "car" }, expiresAt: new Date("2026-10-30T07:30:00.000Z") },
      { _id: "campus-jain|regular|2026-10-22|16:30|live", kind: "live", serviceId: "campus-jain", routeType: "regular", date: "2026-10-22", time: "16:30", departAt: new Date("2026-10-22T07:30:00.000Z"), offsetsSec: [0, 3281], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), frozen: true, frozenAt: new Date("2026-10-22T07:30:00.000Z"), travel: { model: "car" }, expiresAt: new Date("2026-10-30T07:30:00.000Z") },
      { _id: "commute-dogok|down|2026-10-22|16:30|live", kind: "live", serviceId: "commute-dogok", routeType: "down", date: "2026-10-22", time: "16:30", departAt: new Date("2026-10-22T07:30:00.000Z"), offsetsSec: [0, 2313], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), frozen: true, frozenAt: new Date("2026-10-22T07:30:00.000Z"), expiresAt: new Date("2026-10-30T07:30:00.000Z") },
      { _id: "commute-gangnam-yangjae|down|2026-10-22|17:00|live", kind: "live", serviceId: "commute-gangnam-yangjae", routeType: "down", date: "2026-10-22", time: "17:00", departAt: new Date("2026-10-22T08:00:00.000Z"), offsetsSec: [0, 2203, 2323], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), expiresAt: new Date("2026-10-30T08:00:00.000Z") },
      { _id: "commute-gwanggyo|down|2026-10-22|16:30|live", kind: "live", serviceId: "commute-gwanggyo", routeType: "down", date: "2026-10-22", time: "16:30", departAt: new Date("2026-10-22T07:30:00.000Z"), offsetsSec: [0, 683], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), frozen: true, frozenAt: new Date("2026-10-22T07:30:00.000Z"), expiresAt: new Date("2026-10-30T07:30:00.000Z") },
      { _id: "commute-gwanggyo|down|2026-10-22|17:00|live", kind: "live", serviceId: "commute-gwanggyo", routeType: "down", date: "2026-10-22", time: "17:00", departAt: new Date("2026-10-22T08:00:00.000Z"), offsetsSec: [0, 683], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), expiresAt: new Date("2026-10-30T08:00:00.000Z") },
      { _id: "commute-gwanggyo|down|2026-10-22|17:30|live", kind: "live", serviceId: "commute-gwanggyo", routeType: "down", date: "2026-10-22", time: "17:30", departAt: new Date("2026-10-22T08:30:00.000Z"), offsetsSec: [0, 683], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), expiresAt: new Date("2026-10-30T08:30:00.000Z") },
      { _id: "commute-jeongja|down|2026-10-22|16:30|live", kind: "live", serviceId: "commute-jeongja", routeType: "down", date: "2026-10-22", time: "16:30", departAt: new Date("2026-10-22T07:30:00.000Z"), offsetsSec: [0, 1434], source: "naver", fetchedAt: new Date("2026-10-22T07:30:00.000Z"), frozen: true, frozenAt: new Date("2026-10-22T07:30:00.000Z"), expiresAt: new Date("2026-10-30T07:30:00.000Z") },
    ]);
    expect(poller.naver.calls.map((call) => call.points)).toEqual([
      [{ at: { lat: 37.587367, lng: 126.993643 }, kind: "stop" }, { at: { lat: 37.512474, lng: 127.015177 }, kind: "via" }, { at: { lat: 37.292547, lng: 127.102684 }, kind: "via" }, { at: { lat: 37.292298, lng: 126.975057 }, kind: "stop" }],
      [{ lat: 37.587367, lng: 126.993643 }, { lat: 37.292298, lng: 126.975057 }],
      [{ at: { lat: 37.292536, lng: 126.975077 }, kind: "stop" }, { at: { lat: 37.292515, lng: 127.104096 }, kind: "via" }, { at: { lat: 37.51248, lng: 127.01536 }, kind: "via" }, { at: { lat: 37.587258, lng: 126.993904 }, kind: "stop" }],
      [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.587258, lng: 126.993904 }],
      [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.366014, lng: 127.10836 }],
      [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.490607, lng: 127.055048 }],
      [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.48499, lng: 127.034064 }, { lat: 37.495049, lng: 127.029076 }],
      [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.287978, lng: 127.052104 }],
    ]);
    expect(poller.topis.calls.map((call) => [call.routeId, call.now.toISOString()])).toEqual([["200000205", "2026-10-22T07:30:00.000Z"], ["228000174", "2026-10-22T07:30:00.000Z"], ["228000175", "2026-10-22T07:30:00.000Z"]]);
  }, APP_BOOT_TIMEOUT_MS);

  it("stores the baseline value of every run left at 20:00 KST on Friday, from the catalog's stops", async () => {
    // Arrange
    const poller = await bootPoller();

    // Act
    let result: unknown;
    try {
      result = await poller.tickAt("shuttle-eta-baseline", new Date("2026-10-23T20:00:00+09:00"));
    } finally {
      await poller.close();
    }

    // Assert
    expect(result).toEqual({ calls: 3, written: 3 });
    expect(await storedEstimates()).toEqual([
      { _id: "commute-gangnam-yangjae|down|2026-10-23|20:15|baseline", kind: "baseline", serviceId: "commute-gangnam-yangjae", routeType: "down", date: "2026-10-23", time: "20:15", departAt: new Date("2026-10-23T11:15:00.000Z"), offsetsSec: [0, 2203, 2323], source: "tmap", fetchedAt: new Date("2026-10-23T11:00:00.000Z"), expiresAt: new Date("2026-10-24T11:00:00.000Z") },
      { _id: "commute-jamsil|down|2026-10-23|21:00|baseline", kind: "baseline", serviceId: "commute-jamsil", routeType: "down", date: "2026-10-23", time: "21:00", departAt: new Date("2026-10-23T12:00:00.000Z"), offsetsSec: [0, 2685], source: "tmap", fetchedAt: new Date("2026-10-23T11:00:00.000Z"), expiresAt: new Date("2026-10-24T11:00:00.000Z") },
      { _id: "commute-jeongja|down|2026-10-23|20:30|baseline", kind: "baseline", serviceId: "commute-jeongja", routeType: "down", date: "2026-10-23", time: "20:30", departAt: new Date("2026-10-23T11:30:00.000Z"), offsetsSec: [0, 1434], source: "tmap", fetchedAt: new Date("2026-10-23T11:00:00.000Z"), expiresAt: new Date("2026-10-24T11:00:00.000Z") },
    ]);
    expect(poller.tmap.calls.map(({ stops, departAt }) => ({ stops, departAt }))).toEqual([
      { stops: [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.366014, lng: 127.10836 }], departAt: new Date("2026-10-23T11:30:00.000Z") },
      { stops: [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.513114, lng: 127.098842 }], departAt: new Date("2026-10-23T12:00:00.000Z") },
      { stops: [{ lat: 37.292536, lng: 126.975077 }, { lat: 37.48499, lng: 127.034064 }, { lat: 37.495049, lng: 127.029076 }], departAt: new Date("2026-10-23T11:15:00.000Z") },
    ]);
  }, APP_BOOT_TIMEOUT_MS);
});

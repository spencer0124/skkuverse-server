/**
 * Characterization of every route that serves the `arrival` shape or the smart view's run times, before the live
 * mappers produce domain stop calls and the stop page reads shuttle runs instead of re-parsing the smart view's
 * "HH:mm" strings (docs/archive/7800-unified-arrivals-2026-10.md §7, PR 5 and PR 6; ADR 0011, D6): GET
 * /bus/schedule/data/:serviceId/smart of every service, GET /bus/stops/:stopId/arrivals of the shuttle stops at both
 * campuses and the commute stations, two HSSC stops, a Jongno pole and the four 7800 stops, and GET /bus/live/jongro02,
 * jongro07, hssc and gyeonggi7800, each in ko, en and zh, answer the status, `Cache-Control`, `ETag` and bytes pinned in
 * fixtures/stop-calls-pinned.json on commit 90146c04, before either change.
 *
 * The api app boots every module `src/app.module.ts` imports under `src/scheduling/` and `src/bus/`, through the
 * production pipeline with only `Clock` overridden, once per instant: Friday 2026-10-23 08:30
 * KST (the UTC date is still Thursday) with the morning runs under way and HSSC buses on the line; Thursday 16:35, with
 * the afternoon commute runs in their estimate window; Thursday 23:40, while an override's 23:30 잠실 run whose
 * arrival is past midnight runs; Friday 00:20, after that midnight; Friday 22:00, after the week's last run; and
 * Saturday 17:51:10, ten seconds after 7800's capture. The `mongod` holds the timetables as committed at that commit
 * (fixtures/*-schedule.frozen.json, byte-identical copies of scripts/data/*-schedule.json, as `npm run schedule`
 * writes them) with that override, estimates of every kind and
 * precedence in `shuttle_eta` (one crossing midnight, one held at a scheduled stop, one too old to serve but newest),
 * the Jongno and 7800 registry and route lines, `bus_cache` rows for the HSSC line, 종로02 (ended) and 종로07 (a bus
 * standing at 비천당, another on its way), and 7800 as one poller tick over its capture stores it, and in the content
 * database revision 1 of `bus-stops` (its frozen copy, fixtures/bus-stops.frozen.dataset.json) with the four proposed
 * 7800 stops appended (fixtures/bus-stops-7800-proposal.json),
 * `jongro-route-attributes`, `bus-service-notices` and `skku-rest-days`, stored through the data tool's
 * scripts/lib/datasets/store.js.
 *
 * A regression pin: a failure is a regression to report, and an expected value changes only with the behavior it pins
 * (`.claude/rules/tests.md`). `bus_cache` is written at a fixed instant in 2099, so mongod's TTL monitor keeps it and
 * every served `updatedAt` and `checkedAt` is that instant.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Db as MongoDb } from "mongodb";
import request from "supertest";
import type { BusCacheDocument, JongroArrivalBus } from "../../../src/bus/cache/bus-cache.document";
import type { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import type { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import type { JongroRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.document";
import type { ShuttleEtaDoc } from "../../../src/bus/eta/bus-eta.document";
import { Clock } from "../../../src/infra/clock";
import { hsscBusDoc, jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc } from "../../helpers/bus/bus-cache-docs";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { asReal } from "../../helpers/fakes/public-of";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod, MONGOD_STOP_TIMEOUT_MS } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import proposal from "./fixtures/bus-stops-7800-proposal.json";
import pinned from "./fixtures/stop-calls-pinned.json";
import storedRoutes from "./fixtures/jongro-registry-routes.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BusRegistryHelpers = typeof import("../../helpers/bus/bus-registry");
type BusStopsHelpers = typeof import("../../helpers/bus/bus-stops");
type BusRoutePathHelpers = typeof import("../../helpers/bus/bus-route-path");
type RouteAttributesHelpers = typeof import("../../helpers/bus/route-attributes");
type ScheduleContentHelpers = typeof import("../../helpers/bus/schedule-content");
type RestDaysHelpers = typeof import("../../helpers/calendar/rest-days");
type Topis7800Helpers = typeof import("../../helpers/bus/topis-7800");
type CacheService = typeof import("../../../src/bus/cache/bus-cache.service")["BusCacheService"];
type RealtimeJongroService = typeof import("../../../src/bus/realtime/jongro/bus-realtime-jongro.service")["BusRealtimeJongroService"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];

const INSTANTS = {
  "friday 08:30": "2026-10-22T23:30:00.000Z",
  "thursday 16:35": "2026-10-22T07:35:00.000Z",
  "thursday 23:40": "2026-10-22T14:40:00.000Z",
  "friday 00:20": "2026-10-22T15:20:00.000Z",
  "friday 22:00": "2026-10-23T13:00:00.000Z",
  "saturday 17:51:10": "2026-10-24T08:51:10.000Z",
} as const;
type InstantName = keyof typeof INSTANTS;
const INSTANT_NAMES = Object.keys(INSTANTS) as InstantName[];

const SERVICE_IDS = ["campus-inja", "campus-jain", "fasttrack-inja", "commute-jeongja", "commute-jamsil", "commute-dogok", "commute-gangnam-yangjae", "commute-gwanggyo"] as const;
const SHUTTLE_STOP_IDS = ["hssc-bus-lot", "nsc-n-center", "nsc-opposite", "hssc-600th", "gangnam-exit5", "yangjae-exit2", "jamsil-exit5", "gwanggyo-exit1"] as const;
const SHUTTLE_PATHS = [...SERVICE_IDS.map((serviceId) => `/bus/schedule/data/${serviceId}/smart`), ...SHUTTLE_STOP_IDS.map((stopId) => `/bus/stops/${stopId}/arrivals`)];
// WHY: the HSSC engine reads the clock, so the line is pinned with its buses fresh and again an afternoon later.
const HSSC_PATHS = ["/bus/live/hssc", "/bus/stops/hssc-basketball-court/arrivals", "/bus/stops/hssc-olympic-hall/arrivals"];
// WHY: a TOPIS arrival's instants are its row's, whatever the clock, so the Jongno and 7800 answers are pinned once.
const JONGRO_PATHS = ["/bus/live/jongro02", "/bus/live/jongro07", "/bus/stops/100000424/arrivals"];
const ROUTE_7800_PATHS = ["/bus/live/gyeonggi7800", ...["nsc-skku-to-sadang", "nsc-skku-to-suwon", "sadang-exit9", "sadang-median"].map((stopId) => `/bus/stops/${stopId}/arrivals`)];

const PATHS_BY_INSTANT: Record<InstantName, string[]> = {
  "friday 08:30": [...SHUTTLE_PATHS, ...HSSC_PATHS, ...JONGRO_PATHS],
  "thursday 16:35": [...SHUTTLE_PATHS, ...HSSC_PATHS],
  "thursday 23:40": SHUTTLE_PATHS,
  "friday 00:20": SHUTTLE_PATHS,
  "friday 22:00": SHUTTLE_PATHS,
  "saturday 17:51:10": [...SHUTTLE_PATHS, ...ROUTE_7800_PATHS],
};

// WHY: a shuttle stop page's names and labels are the language's whatever the clock, so en and zh are pinned at one instant.
const SHUTTLE_STOP_PATHS: readonly string[] = SHUTTLE_STOP_IDS.map((stopId) => `/bus/stops/${stopId}/arrivals`);
const langsOf = (instant: InstantName, routePath: string): Lang[] => (SHUTTLE_STOP_PATHS.includes(routePath) && instant !== "friday 08:30" ? ["ko"] : LANGS);

// WHY: mongod's TTL monitor drops a bus_cache key a minute after `_updatedAt`; one written in 2099 outlives the suite.
const CACHE_UPDATED_AT = new Date("2099-01-01T00:00:00.000Z");
const ESTIMATES_EXPIRE_AT = new Date("2099-01-01T00:00:00.000Z");
const STORED_BY = { by: "characterization@example.com", now: new Date(INSTANTS["friday 08:30"]) };

const FROZEN_PATTERNS = ["campus-schedule.frozen.json", "commute-schedule.frozen.json"].flatMap((file) =>
  buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8")))),
) as Array<{ serviceId: string; entries: Array<Record<string, unknown>> }>;

// Thursday's 잠실 timetable with a 23:30 run home that reaches 잠실역 at 00:50, past midnight.
function lateJamsilOverride(): Record<string, unknown> {
  const { entries } = FROZEN_PATTERNS.find(({ serviceId }) => serviceId === "commute-jamsil")!;
  const late = { index: entries.length + 1, time: "23:30", routeType: "down", busCount: 1, notes: null, stopTimes: ["23:30", "00:50"] };
  return { serviceId: "commute-jamsil", date: "2026-10-22", type: "replace", label: "심야 운행", notices: [], entries: [...entries, late] };
}

type EstimateSeed = Pick<ShuttleEtaDoc, "kind" | "serviceId" | "routeType" | "date" | "time" | "offsetsSec"> & { fetchedAtKst: string; frozen?: boolean };

function estimateDoc({ kind, serviceId, routeType, date, time, offsetsSec, fetchedAtKst, frozen }: EstimateSeed): ShuttleEtaDoc {
  const fetchedAt = new Date(`${fetchedAtKst}+09:00`);
  return {
    _id: `${serviceId}|${routeType}|${date}|${time}|${kind}`,
    kind,
    serviceId,
    routeType,
    date,
    time,
    departAt: new Date(`${date}T${time}:00+09:00`),
    offsetsSec,
    source: kind === "live" ? "naver" : "tmap",
    fetchedAt,
    ...(frozen && { frozen: true as const, frozenAt: fetchedAt }),
    expiresAt: ESTIMATES_EXPIRE_AT,
  };
}

const ESTIMATES: ShuttleEtaDoc[] = [
  // A fixed value, which wins over everything.
  estimateDoc({ kind: "live", frozen: true, serviceId: "campus-inja", routeType: "regular", date: "2026-10-23", time: "08:00", offsetsSec: [0, 4200], fetchedAtKst: "2026-10-23T08:00:00" }),
  estimateDoc({ kind: "baseline", serviceId: "campus-inja", routeType: "regular", date: "2026-10-23", time: "08:00", offsetsSec: [0, 3600], fetchedAtKst: "2026-10-22T20:00:00" }),
  // A fresh live value beside a prediction, 3,930 s rounding up to 66 minutes.
  estimateDoc({ kind: "live", serviceId: "campus-inja", routeType: "hakbu", date: "2026-10-23", time: "08:20", offsetsSec: [0, 3930], fetchedAtKst: "2026-10-23T08:22:00" }),
  estimateDoc({ kind: "baseline", serviceId: "campus-inja", routeType: "hakbu", date: "2026-10-23", time: "08:20", offsetsSec: [0, 3600], fetchedAtKst: "2026-10-22T20:00:00" }),
  // A live value too old to serve at 08:30 but newer than the served prediction, which only the listing time reads.
  estimateDoc({ kind: "live", serviceId: "campus-inja", routeType: "hakbu", date: "2026-10-23", time: "08:00", offsetsSec: [0, 3900], fetchedAtKst: "2026-10-23T08:05:00" }),
  estimateDoc({ kind: "baseline", serviceId: "campus-inja", routeType: "hakbu", date: "2026-10-23", time: "08:00", offsetsSec: [0, 1500], fetchedAtKst: "2026-10-22T20:00:00" }),
  estimateDoc({ kind: "baseline", serviceId: "campus-jain", routeType: "regular", date: "2026-10-23", time: "08:00", offsetsSec: [0, 3720], fetchedAtKst: "2026-10-22T20:00:00" }),
  estimateDoc({ kind: "baseline", serviceId: "campus-jain", routeType: "hakbu", date: "2026-10-23", time: "10:10", offsetsSec: [0, 3650], fetchedAtKst: "2026-10-22T20:00:00" }),
  // Arriving past midnight: 23:30 plus 82 minutes is 00:52 on the next day.
  estimateDoc({ kind: "baseline", serviceId: "commute-jamsil", routeType: "down", date: "2026-10-22", time: "23:30", offsetsSec: [0, 4920], fetchedAtKst: "2026-10-22T04:00:00" }),
  // Early at 양재 (scheduled 07:45), so the bus waits there and every later stop moves by the wait.
  estimateDoc({ kind: "live", frozen: true, serviceId: "commute-gangnam-yangjae", routeType: "up", date: "2026-10-23", time: "07:40", offsetsSec: [0, 120, 3900], fetchedAtKst: "2026-10-23T07:40:00" }),
  estimateDoc({ kind: "live", serviceId: "commute-gwanggyo", routeType: "down", date: "2026-10-22", time: "16:30", offsetsSec: [0, 2400], fetchedAtKst: "2026-10-22T16:31:00" }),
  estimateDoc({ kind: "baseline", serviceId: "commute-jeongja", routeType: "down", date: "2026-10-22", time: "16:30", offsetsSec: [0, 2700], fetchedAtKst: "2026-10-22T04:00:00" }),
  estimateDoc({ kind: "baseline", serviceId: "commute-jamsil", routeType: "up", date: "2026-10-23", time: "07:30", offsetsSec: [0, 3300], fetchedAtKst: "2026-10-22T04:00:00" }),
];

// An HSSC bus as the poller caches it: the feed's row with its event at a KST time on Friday the 23rd.
function hsscBus(lineNo: string, seq: number, inout: string, kstTime: string) {
  const [hour, minute, second] = kstTime.split(":").map(Number) as [number, number, number];
  const clock = `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return hsscBusDoc({ line_no: lineNo, seq: String(seq), inout, sequence: String(seq >= 5 ? seq - 4 : seq + 7), get_date: `2026-10-23 ${clock}`, eventDate: `2026-10-23 ${kstTime}` });
}

const SEEDED_HSSC = [hsscBus("32149", 6, "LEFT", "08:28:10"), hsscBus("32150", 0, "ENTERED", "08:29:00"), hsscBus("32151", 3, "LEFT", "08:25:00"), hsscBus("32152", 9, "ENTERED", "08:27:30")];

function stationOf(routeId: "jongro02" | "jongro07", index: number): { topisId: string; arsId: string; stationName: string } {
  return storedRoutes.routes.find((route) => route.id === routeId)!.stations[index]!;
}

function arrivalRow(routeId: "jongro02" | "jongro07", index: number, buses: [JongroArrivalBus, JongroArrivalBus], madeAt: string) {
  const station = stationOf(routeId, index);
  return jongroArrivalDoc({ stationId: station.topisId, sequence: String(index + 1), stationName: station.stationName, stationNumber: station.arsId, eta: buses[0].arrmsg, eventDate: madeAt, buses });
}

const ended = (staOrd: number) => jongroArrivalBus({ staOrd, traTime: 0, sectOrd: 0, arrmsg: "운행종료", plainNo: " ", vehId: "0", rerideDiv: 0, rerideNum: 0 });

// 종로02 done for the day; on 종로07 a bus standing at 비천당 (index 2) and another two stations before it.
const SEEDED_JONGRO = {
  jongro02: { arrivals: [arrivalRow("jongro02", 0, [ended(1), ended(1)], "2026-10-23 08:29:40.0"), arrivalRow("jongro02", 1, [ended(2), ended(2)], "2026-10-23 08:29:40.0")], positions: [] },
  jongro07: {
    arrivals: [
      arrivalRow(
        "jongro07",
        2,
        [
          jongroArrivalBus({ staOrd: 3, sectOrd: 2, vehId: "100000701", plainNo: "서울74사0701", traTime: 95, arrmsg: "1분35초후[1번째 전]", rerideDiv: 2, rerideNum: 8 }),
          jongroArrivalBus({ staOrd: 3, sectOrd: 0, vehId: "0", plainNo: " ", traTime: 0, arrmsg: "출발대기", rerideDiv: 0, rerideNum: 0 }),
        ],
        "2026-10-23 08:29:40.0",
      ),
      arrivalRow(
        "jongro07",
        3,
        [
          jongroArrivalBus({ staOrd: 4, sectOrd: 4, vehId: "100000702", plainNo: "서울74사0702", traTime: 40, arrmsg: "곧 도착", isLast: true, rerideDiv: 2, rerideNum: 21 }),
          jongroArrivalBus({ staOrd: 4, sectOrd: 2, vehId: "100000701", plainNo: "서울74사0701", traTime: 210, arrmsg: "3분30초후[2번째 전]", rerideDiv: 2, rerideNum: 8 }),
        ],
        "2026-10-23 08:29:40.0",
      ),
    ],
    positions: [
      jongroPositionDoc({
        sequence: "3",
        stationName: stationOf("jongro07", 2).stationName,
        stationId: stationOf("jongro07", 2).topisId,
        carNumber: "0702",
        plainNo: "서울74사0702",
        vehicleId: "100000702",
        isAtStop: true,
        atStopSince: "2026-10-23T08:29:10+09:00",
        sectDist: 0,
        fullSectDist: 0.2,
        eventDate: "2026-10-22T23:29:30.000Z",
        recordTime: "2026-10-22T23:29:30.000Z",
        observedAt: "2026-10-23T08:29:30+09:00",
      }),
      jongroPositionDoc({
        sequence: "1",
        stationName: stationOf("jongro07", 0).stationName,
        stationId: stationOf("jongro07", 0).topisId,
        carNumber: "0701",
        plainNo: "서울74사0701",
        vehicleId: "100000701",
        sectDist: 0.1,
        fullSectDist: 0.25,
        eventDate: "2026-10-22T23:29:30.000Z",
        recordTime: "2026-10-22T23:29:30.000Z",
        observedAt: "2026-10-23T08:29:30+09:00",
        busType: "lowFloor",
      }),
    ],
  },
};

let mongod: TestMongod;
let db: Db;
let busDb: MongoDb;
let content: MongoDb;
let config: Config;
let buildTestApp: BuildTestApp;
async function boot(at: string): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/"),
    overrides: [{ provide: Clock, useValue: { now: () => new Date(at) } }],
    role: "api",
  });
}

/** The two bus_cache values one tick of the 7800 poller writes over its capture, read back from the cache it wrote to. */
async function tick7800(): Promise<Array<{ _id: string; data: unknown }>> {
  const { ROUTE_7800, arrivalDocs7800, registryDoc7800, sightings7800 } = require("../../helpers/bus/topis-7800") as Topis7800Helpers;
  const { storedBusRegistryRepository, storedBusRegistryService } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  const { BusRealtimeJongroService } = require("../../../src/bus/realtime/jongro/bus-realtime-jongro.service") as { BusRealtimeJongroService: RealtimeJongroService };
  const { BusCacheService } = require("../../../src/bus/cache/bus-cache.service") as { BusCacheService: CacheService };
  const client = new FakeBusRealtimeJongroClient();
  client.arrivals = arrivalDocs7800();
  client.sightings = sightings7800();
  const registry = storedBusRegistryRepository();
  registry.routes.set(ROUTE_7800.id, registryDoc7800());
  const written = new FakeBusCacheRepository();
  const cache = new BusCacheService(asReal<BusCacheRepository>(written));
  const clock = { now: () => new Date(INSTANTS["saturday 17:51:10"]) };
  await new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(client), cache, storedBusRegistryService(registry), clock).refresh(ROUTE_7800);
  return [...written.values].map(([key, data]) => ({ _id: key, data }));
}

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;
  busDb = db.getClient().db(config.mongo.dbName);
  content = db.getClient().db(config.content.dbName);
  const { storedJongroRouteDocuments } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  const { storedJongroRoutePathDocuments } = require("../../helpers/bus/bus-route-path") as BusRoutePathHelpers;
  const { registryDoc7800, routePathDoc7800 } = require("../../helpers/bus/topis-7800") as Topis7800Helpers;
  await busDb.collection("bus_schedules").insertMany(FROZEN_PATTERNS);
  await busDb.collection("bus_overrides").insertOne(lateJamsilOverride());
  await busDb.collection<ShuttleEtaDoc>("shuttle_eta").insertMany(ESTIMATES);
  await busDb.collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes).insertMany([...storedJongroRouteDocuments(), registryDoc7800()]);
  await busDb.collection<JongroRoutePathDocument>(config.mongo.collections.jongroRoutePaths).insertMany([...storedJongroRoutePathDocuments(), routePathDoc7800()]);
  const cacheDocs = [
    { _id: "hssc", data: SEEDED_HSSC, _updatedAt: CACHE_UPDATED_AT },
    { _id: "jongro_stations_02", data: SEEDED_JONGRO.jongro02.arrivals, _updatedAt: CACHE_UPDATED_AT },
    { _id: "jongro_locations_02", data: SEEDED_JONGRO.jongro02.positions, _updatedAt: CACHE_UPDATED_AT },
    { _id: "jongro_stations_07", data: SEEDED_JONGRO.jongro07.arrivals, _updatedAt: CACHE_UPDATED_AT },
    { _id: "jongro_locations_07", data: SEEDED_JONGRO.jongro07.positions, _updatedAt: CACHE_UPDATED_AT },
    ...(await tick7800()).map((written) => ({ ...written, _updatedAt: CACHE_UPDATED_AT })),
  ];
  await busDb.collection<BusCacheDocument>(config.mongo.collections.busCache).insertMany(cacheDocs as unknown as BusCacheDocument[]);
  const { frozenBusStopsFixture } = require("../../helpers/bus/bus-stops") as BusStopsHelpers;
  const stops = frozenBusStopsFixture() as { stops: unknown[] };
  stops.stops.push(...proposal.stops);
  await store.create(content, "bus-stops", stops, STORED_BY);
  const { routeAttributesFixture } = require("../../helpers/bus/route-attributes") as RouteAttributesHelpers;
  await store.create(content, "jongro-route-attributes", routeAttributesFixture(), STORED_BY);
  const { serviceNoticesFixture } = require("../../helpers/bus/schedule-content") as ScheduleContentHelpers;
  const { restDaysFixture } = require("../../helpers/calendar/rest-days") as RestDaysHelpers;
  await store.create(content, "bus-service-notices", serviceNoticesFixture(), STORED_BY);
  await store.create(content, "skku-rest-days", restDaysFixture(), STORED_BY);
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await clearCollections(busDb);
    await clearCollections(content);
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
}, MONGOD_STOP_TIMEOUT_MS);

interface Pin {
  status: number;
  cacheControl: string | null;
  etag: string | null;
  body: unknown;
}

/** An en or zh answer stored as the ko one's bytes with only `meta.lang` changed, beside its own ETag. */
interface SameBodyPin {
  sameBodyAs: "ko";
  etag: string | null;
}

const pins = pinned.pins as unknown as Record<InstantName, Record<string, Record<Lang, Pin | SameBodyPin>>>;

// Replacing `lang` in place keeps the key order, so the body's bytes are the ko answer's but for the language.
function pinOf(instant: InstantName, routePath: string, lang: Lang): Pin {
  const stored = pins[instant][routePath]!;
  const own = stored[lang];
  if (!("sameBodyAs" in own)) return own;
  const ko = stored.ko as Pin & { body: { meta: Record<string, unknown> } };
  return { ...ko, etag: own.etag, body: { ...ko.body, meta: { ...ko.body.meta, lang } } };
}

describe.each(INSTANT_NAMES)("at %s KST", (instant) => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await boot(INSTANTS[instant]);
  }, APP_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  it.each(PATHS_BY_INSTANT[instant].flatMap((routePath) => langsOf(instant, routePath).map((lang) => [routePath, lang] as const)))("GET %s in %s answers the pinned status, headers and bytes", async (routePath, lang) => {
    // Arrange
    const expected = pinOf(instant, routePath, lang);

    // Act
    const res = await request(app.getHttpServer()).get(routePath).set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(expected.status);
    expect(res.body).toEqual(expected.body);
    expect(res.text).toBe(JSON.stringify(expected.body));
    expect(res.headers["cache-control"] ?? null).toBe(expected.cacheControl);
    expect(res.headers.etag ?? null).toBe(expected.etag);
  });
});

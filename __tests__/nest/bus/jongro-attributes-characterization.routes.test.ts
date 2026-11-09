/**
 * Characterization of every route that serves a Jongro route's attributes
 * (ADR 0011, D6): its theme color, icon type,
 * refresh interval, seat count and transfer lines. `/bus/config` and each
 * `/bus/config/:groupId`, `/ui/home/transit` and `/ui/home/transitlist` answer,
 * in `ko`, `en` and `zh`, the bytes, `Cache-Control`, `Vary` and `ETag`
 * production served from the committed route file on 2026-10-20
 * (fixtures/jongro-attributes-production.capture.json, source commit d856f333);
 * `/bus/realtime/data/jongro02`, `jongro07` and `jongro08` answer the crowding
 * each route's seat count gives the passenger counts seeded below, and
 * `/bus/live/jongro02`, `jongro07` and `jongro08` and the stop pages of four
 * Jongro poles the occupancy it gives them, in the bodies pinned on commit
 * 64062a50 before the TOPIS route list held each route's code and
 * capabilities (fixtures/jongro-live-pinned.json).
 *
 * The app boots every module `src/app.module.ts` imports under `src/scheduling/`, `src/bus/`,
 * `src/ui/transit-list/` and `src/ui/transit/`, as an api replica, through the
 * production pipeline with only `Clock` overridden, at the first capture's
 * instant. It runs over a real `mongod` whose `jongro_routes` holds the three
 * routes as production stored them (fixtures/jongro-registry-routes.json, the
 * stations versions the captures carry), whose `bus_cache` holds the arrival
 * rows and positions below, and whose content database holds revision 1 of
 * `transit-layout`, `miniapps` and `jongro-route-attributes`, and of `bus-stops`
 * as its frozen copy (fixtures/bus-stops.frozen.dataset.json), stored through
 * the tool's own scripts/lib/datasets/store.js. The attributes are the
 * dataset's; every expected value was pinned while they were
 * still the committed route file, of which revision 1 is a copy.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The
 * realtime bodies were pinned against the code of the capture's commit; the
 * live buses production served then cannot be replayed, so only their group
 * id and stations version are compared with the capture.
 *
 * One pinned behavior changed on purpose after the capture: each realtime station of `/bus/config` and of the
 * `hssc` and Jongro groups carries its `stopId`, last. Those bodies are now
 * the captured ones with exactly the stations' stop ids appended
 * (__tests__/helpers/bus/station-stop-ids.ts) and their ETags the md5 of that
 * JSON, as `BusConfigService` computes every config ETag; with every `stopId`
 * removed each is the captured body. The capture is unchanged, and the
 * schedule groups and the ui routes still answer its bytes and ETags.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { BusCacheDocument } from "../../../src/bus/cache/bus-cache.document";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import { Clock } from "../../../src/infra/clock";
import { toKstInstant } from "../../../src/shared/kst-date.util";
import { jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc, noArrivalBus } from "../../helpers/bus/bus-cache-docs";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod, MONGOD_STOP_TIMEOUT_MS } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { md5EtagOf, withStationStopIds, withoutStationStopIds } from "../../helpers/bus/station-stop-ids";
import { withLiveScreen, withoutLiveScreen } from "../../helpers/bus/live-screen";
import { withLineDirections, withoutLineDirections } from "../../helpers/bus/line-directions";
import captured from "./fixtures/jongro-attributes-production.capture.json";
import pinnedLive from "./fixtures/jongro-live-pinned.json";
import storedRoutes from "./fixtures/jongro-registry-routes.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BusRegistryHelpers = typeof import("../../helpers/bus/bus-registry");
type BusStopsHelpers = typeof import("../../helpers/bus/bus-stops");
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RegistryFixture = typeof import("../../helpers/miniapps/registry-fixture");
type RouteAttributesHelpers = typeof import("../../helpers/bus/route-attributes");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];
const GROUP_IDS = ["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"] as const;
const ROUTE_IDS = ["jongro02", "jongro07", "jongro08"] as const;
type RouteId = (typeof ROUTE_IDS)[number];

const NOW = new Date(captured.capturedAt);
const CLOCK: Clock = { now: () => new Date(NOW) };
// WHY: mongod's TTL monitor drops a bus_cache key a minute after `_updatedAt` by the wall clock; a seed dated
// a year ahead outlives the suite. No reader of bus_cache reads `_updatedAt`.
const CACHE_UPDATED_AT = new Date(Date.now() + 365 * 24 * 60 * 60_000);
const CONFIG_CACHE_CONTROL = "private, max-age=300";
const VARY = "Accept-Language, Origin";

interface GroupBody {
  id: string;
}
interface ConfigBody {
  meta: { lang: Lang };
  data: { groups: GroupBody[] };
}

const configCapture = (lang: Lang) => captured.config[lang] as { status: number; etag: string; groupEtags: Record<string, string>; body: ConfigBody };
const groupOf = (lang: Lang, groupId: string): GroupBody => configCapture(lang).body.data.groups.find((group) => group.id === groupId)!;

/** The stored station of `routeId` at `index` (TOPIS order), as the arrival rows name it. */
function stationOf(routeId: RouteId, index: number): { topisId: string; arsId: string; stationName: string } {
  return storedRoutes.routes.find((route) => route.id === routeId)!.stations[index]!;
}

/** An arrival row at the stored station `index`, its first slot `bus` and its second empty. */
function arrivalRow(routeId: RouteId, index: number, bus: Parameters<typeof jongroArrivalBus>[0]) {
  const station = stationOf(routeId, index);
  const staOrd = index + 1;
  const first = jongroArrivalBus({ staOrd, ...bus });
  return jongroArrivalDoc({
    stationId: station.topisId,
    sequence: String(staOrd),
    stationName: station.stationName,
    stationNumber: station.arsId,
    eta: first.arrmsg,
    eventDate: "2026-10-20 09:08:30.0",
    buses: [first, noArrivalBus({ staOrd, arrmsg: "출발대기" })],
  });
}

/** One bus between the stored stations `index` and `index + 1`, observed a few seconds before the clock. */
function position(routeId: RouteId, index: number, vehicleId: string, carNumber: string) {
  const station = stationOf(routeId, index);
  return jongroPositionDoc({
    sequence: String(index + 1),
    stationName: station.stationName,
    stationId: station.topisId,
    carNumber,
    vehicleId,
    eventDate: "2026-10-20T00:08:30.000Z",
    recordTime: "2026-10-20T00:08:30.000Z",
    observedAt: "2026-10-20T09:08:30+09:00",
  });
}

// WHY: type-2 passenger counts at each crowding threshold of an 18-seat bus: at 18 (relaxed), one above (normal),
// at 27 = 1.5 × 18 (normal) and one above (crowded); jongro08 also carries a type-4 congestion code and no count.
const SEEDED_CACHE: Record<RouteId, { arrivals: unknown[]; positions: unknown[] }> = {
  jongro02: {
    arrivals: [
      arrivalRow("jongro02", 0, { vehId: "0", plainNo: " ", sectOrd: 0, traTime: 0, arrmsg: "출발대기", rerideDiv: 0, rerideNum: 0 }),
      arrivalRow("jongro02", 2, { vehId: "100000201", plainNo: "서울74사1802", sectOrd: 1, traTime: 130, arrmsg: "2분10초후[1번째 전]", rerideDiv: 2, rerideNum: 18 }),
      arrivalRow("jongro02", 3, { vehId: "100000201", plainNo: "서울74사1802", sectOrd: 1, traTime: 250, arrmsg: "4분10초후[2번째 전]", rerideDiv: 2, rerideNum: 19 }),
    ],
    positions: [position("jongro02", 1, "100000201", "1802")],
  },
  jongro07: {
    arrivals: [
      arrivalRow("jongro07", 1, { vehId: "100000207", plainNo: "서울74사2707", sectOrd: 0, traTime: 95, arrmsg: "1분35초후[1번째 전]", rerideDiv: 2, rerideNum: 27 }),
      arrivalRow("jongro07", 2, { vehId: "100000207", plainNo: "서울74사2707", sectOrd: 0, traTime: 200, arrmsg: "3분20초후[2번째 전]", rerideDiv: 2, rerideNum: 28 }),
    ],
    positions: [position("jongro07", 0, "100000207", "2707")],
  },
  jongro08: {
    arrivals: [
      arrivalRow("jongro08", 1, { vehId: "100000208", plainNo: "서울74사0808", sectOrd: 0, traTime: 60, arrmsg: "곧 도착", rerideDiv: 2, rerideNum: 0 }),
      arrivalRow("jongro08", 3, { vehId: "100000209", plainNo: "서울74사0809", sectOrd: 2, traTime: 300, arrmsg: "5분후[1번째 전]", rerideDiv: 4, rerideNum: 3 }),
    ],
    positions: [position("jongro08", 0, "100000208", "0808"), position("jongro08", 2, "100000209", "0809")],
  },
};

// QUIRK(express): the default weak ETag, W/"<length hex>-<first 27 chars of the base64 SHA-1>" of the body bytes.
function weakEtagOf(text: string): string {
  const body = Buffer.from(text, "utf8");
  const hash = crypto.createHash("sha1").update(body).digest("base64").substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

function fixtureTransitLayout(): Record<string, unknown> {
  const file = path.join(__dirname, "../ui/fixtures/transit-layout.dataset.json");
  const layout = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

let mongod: TestMongod;
let db: Db;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const busDb = db.getClient().db(config.mongo.dbName);
  const { storedJongroRouteDocuments } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  await busDb.collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes).insertMany(storedJongroRouteDocuments());
  const cacheDocs = ROUTE_IDS.flatMap((routeId) => {
    const code = routeId.slice("jongro".length);
    return [
      { _id: `jongro_stations_${code}`, data: SEEDED_CACHE[routeId].arrivals, _updatedAt: CACHE_UPDATED_AT },
      { _id: `jongro_locations_${code}`, data: SEEDED_CACHE[routeId].positions, _updatedAt: CACHE_UPDATED_AT },
    ];
  });
  await busDb.collection<BusCacheDocument>(config.mongo.collections.busCache).insertMany(cacheDocs as unknown as BusCacheDocument[]);
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "transit-layout", fixtureTransitLayout(), { by: "characterization@example.com", now: NOW });
  const { fixtureRegistry } = require("../../helpers/miniapps/registry-fixture") as RegistryFixture;
  await store.create(content, "miniapps", fixtureRegistry(), { by: "characterization@example.com", now: NOW });
  const { routeAttributesFixture } = require("../../helpers/bus/route-attributes") as RouteAttributesHelpers;
  await store.create(content, "jongro-route-attributes", routeAttributesFixture(), { by: "characterization@example.com", now: NOW });
  const { frozenBusStopsFixture } = require("../../helpers/bus/bus-stops") as BusStopsHelpers;
  await store.create(content, "bus-stops", frozenBusStopsFixture(), { by: "characterization@example.com", now: NOW });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/", "src/ui/transit-list/", "src/ui/transit/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role: "api",
  });
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
}, MONGOD_STOP_TIMEOUT_MS);

const get = (url: string, lang: Lang) => request(app.getHttpServer()).get(url).set("Accept-Language", lang);

/** The captured body with every realtime station's stop id and each realtime screen's live fields (ADR 0019) appended, as served after the capture. */
function configBodyFromWave4(lang: Lang): ConfigBody {
  const body = configCapture(lang).body;
  return { ...body, data: { ...body.data, groups: body.data.groups.map((group) => withLineDirections(withLiveScreen(withStationStopIds(group)), lang, { hasStoredLines: false })) } };
}

describe("GET /bus/config", () => {
  it.each(LANGS)("answers in %s the bytes production served with only the realtime stations' stop ids and screens' live fields appended, and their ETag", async (lang) => {
    // Arrange
    const expected = configBodyFromWave4(lang);

    // Act
    const res = await get("/bus/config", lang);

    // Assert
    expect(res.status).toBe(configCapture(lang).status);
    expect(res.body).toEqual(expected);
    expect(res.text).toBe(JSON.stringify(expected));
    expect(withoutLineDirections(withoutStationStopIds(withoutLiveScreen(res.body.data)))).toEqual(configCapture(lang).body.data);
    expect(res.headers["cache-control"]).toBe(CONFIG_CACHE_CONTROL);
    expect(res.headers.vary).toBe(VARY);
    expect(res.headers.etag).toBe(md5EtagOf(expected.data.groups));
    expect(res.headers.etag).not.toBe(configCapture(lang).etag);
  });

  it.each(LANGS)("answers 304 in %s to the ETag from wave 4, and 200 to the one production served before it", async (lang) => {
    // Act
    const current = await get("/bus/config", lang).set("If-None-Match", md5EtagOf(configBodyFromWave4(lang).data.groups));
    const before = await get("/bus/config", lang).set("If-None-Match", configCapture(lang).etag);

    // Assert
    expect(current.status).toBe(304);
    expect(current.text).toBe("");
    expect(before.status).toBe(200);
  });
});

describe("GET /bus/config/:groupId", () => {
  it.each(LANGS.flatMap((lang) => GROUP_IDS.map((groupId) => [lang, groupId] as const)))(
    "answers in %s for %s the group production served, with only its stations' stop ids appended, and its ETag",
    async (lang, groupId) => {
      // Arrange
      const group = withLineDirections(withLiveScreen(withStationStopIds(groupOf(lang, groupId))), lang, { hasStoredLines: false });
      const expected = { meta: { lang }, data: group };
      const isRealtime = ["hssc", "jongro02", "jongro07", "jongro08"].includes(groupId);

      // Act
      const res = await get(`/bus/config/${groupId}`, lang);

      // Assert
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expected);
      expect(res.text).toBe(JSON.stringify(expected));
      expect(withoutLineDirections(withoutStationStopIds(withoutLiveScreen(res.body.data)))).toEqual(groupOf(lang, groupId));
      expect(res.headers["cache-control"]).toBe(CONFIG_CACHE_CONTROL);
      expect(res.headers.vary).toBe(VARY);
      expect(res.headers.etag).toBe(isRealtime ? md5EtagOf(group) : configCapture(lang).groupEtags[groupId]);
      expect(res.headers.etag === configCapture(lang).groupEtags[groupId]).toBe(!isRealtime);
    },
  );
});

describe("GET /ui/home/transit", () => {
  it.each(LANGS)("answers in %s the bytes and ETag production served", async (lang) => {
    // Act
    const res = await get("/ui/home/transit", lang);

    // Assert
    expect(res.status).toBe(captured.transit[lang].status);
    expect(res.body).toEqual(captured.transit[lang].body);
    expect(res.text).toBe(JSON.stringify(captured.transit[lang].body));
    expect(res.headers["cache-control"]).toBe(CONFIG_CACHE_CONTROL);
    expect(res.headers.vary).toBe(VARY);
    expect(res.headers.etag).toBe(captured.transit[lang].etag);
  });
});

describe("GET /ui/home/transitlist", () => {
  it.each(LANGS)("answers in %s the bytes and ETag production served, with no Cache-Control", async (lang) => {
    // Act
    const res = await get("/ui/home/transitlist", lang);

    // Assert
    expect(res.status).toBe(captured.transitlist[lang].status);
    expect(res.body).toEqual(captured.transitlist[lang].body);
    expect(res.text).toBe(JSON.stringify(captured.transitlist[lang].body));
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers.vary).toBe(VARY);
    expect(res.headers.etag).toBe(captured.transitlist[lang].etag);
  });
});

// The bodies today's code answers in ko for the seeded bus_cache, without `meta.lang`.
const REALTIME_BODIES: Record<RouteId, { meta: Record<string, unknown>; data: Record<string, unknown> }> = {
  jongro02: {
    meta: { currentTime: "09:08 AM", totalBuses: 1, serverNow: "2026-10-20T09:08:42+09:00" },
    data: {
      groupId: "jongro02",
      buses: [
        {
          stationIndex: 1,
          carNumber: "1802",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000201",
            observedAt: "2026-10-20T09:08:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 130,
            trajectory: [
              { at: "2026-10-20T09:08:30+09:00", s: 1.5 },
              { at: "2026-10-20T09:10:40+09:00", s: 2 },
              { at: "2026-10-20T09:12:40+09:00", s: 3 },
            ],
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 0,
          eta: "출발대기",
          arrivals: [
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
        {
          stationIndex: 2,
          eta: "2분10초후[1번째 전]",
          arrivals: [
            {
              minutes: 2,
              stopsAway: 2,
              state: "running",
              isLastBus: false,
              carNumber: "1802",
              crowding: "relaxed",
              passengerCount: 18,
              message: "2분10초후[1번째 전]",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
        {
          stationIndex: 3,
          eta: "4분10초후[2번째 전]",
          arrivals: [
            {
              minutes: 4,
              stopsAway: 3,
              state: "running",
              isLastBus: false,
              carNumber: "1802",
              crowding: "normal",
              passengerCount: 19,
              message: "4분10초후[2번째 전]",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
      ],
      stationsVersion: "76d8e6770cda23aa",
    },
  },
  jongro07: {
    meta: { currentTime: "09:08 AM", totalBuses: 1, serverNow: "2026-10-20T09:08:42+09:00" },
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
            observedAt: "2026-10-20T09:08:30+09:00",
            crowding: "normal",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 95,
            trajectory: [
              { at: "2026-10-20T09:08:30+09:00", s: 0.5 },
              { at: "2026-10-20T09:10:05+09:00", s: 1 },
              { at: "2026-10-20T09:11:50+09:00", s: 2 },
            ],
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 1,
          eta: "1분35초후[1번째 전]",
          arrivals: [
            {
              minutes: 2,
              stopsAway: 2,
              state: "running",
              isLastBus: false,
              carNumber: "2707",
              crowding: "normal",
              passengerCount: 27,
              message: "1분35초후[1번째 전]",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
        {
          stationIndex: 2,
          eta: "3분20초후[2번째 전]",
          arrivals: [
            {
              minutes: 3,
              stopsAway: 3,
              state: "running",
              isLastBus: false,
              carNumber: "2707",
              crowding: "crowded",
              passengerCount: 28,
              message: "3분20초후[2번째 전]",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
      ],
      stationsVersion: "0346768f2b776f45",
    },
  },
  jongro08: {
    meta: { currentTime: "09:08 AM", totalBuses: 2, serverNow: "2026-10-20T09:08:42+09:00" },
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
            observedAt: "2026-10-20T09:08:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 60,
            trajectory: [{ at: "2026-10-20T09:08:30+09:00", s: 0.5 }, { at: "2026-10-20T09:09:30+09:00", s: 1 }],
          },
        },
        {
          stationIndex: 2,
          carNumber: "0809",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000209",
            observedAt: "2026-10-20T09:08:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: 300,
            trajectory: [{ at: "2026-10-20T09:08:30+09:00", s: 2.5 }, { at: "2026-10-20T09:13:30+09:00", s: 3 }],
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 1,
          eta: "곧 도착",
          arrivals: [
            {
              minutes: null,
              stopsAway: 2,
              state: "arriving",
              isLastBus: false,
              carNumber: "0808",
              crowding: "relaxed",
              passengerCount: 0,
              message: "곧 도착",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
        {
          stationIndex: 3,
          eta: "5분후[1번째 전]",
          arrivals: [
            {
              minutes: 5,
              stopsAway: 2,
              state: "running",
              isLastBus: false,
              carNumber: "0809",
              crowding: "relaxed",
              passengerCount: null,
              message: "5분후[1번째 전]",
            },
            {
              minutes: null,
              stopsAway: null,
              state: "waiting",
              isLastBus: false,
              carNumber: null,
              crowding: null,
              passengerCount: null,
              message: "출발대기",
            },
          ],
        },
      ],
      stationsVersion: "52e82cc449046288",
    },
  },
};

describe("GET /bus/realtime/data/:groupId for the Jongro routes", () => {
  it.each(LANGS.flatMap((lang) => ROUTE_IDS.map((routeId) => [lang, routeId] as const)))(
    "answers in %s for %s the crowding its seat count gives the seeded counts, uncached",
    async (lang, routeId) => {
      // Arrange
      const { meta, data } = REALTIME_BODIES[routeId];
      const expected = { meta: { lang, ...meta }, data };

      // Act
      const res = await get(`/bus/realtime/data/${routeId}`, lang);

      // Assert
      expect(res.status).toBe(captured.realtime[routeId].status);
      expect(res.body.data.groupId).toBe(captured.realtime[routeId].groupId);
      expect(res.body.data.stationsVersion).toBe(captured.realtime[routeId].stationsVersion);
      expect(res.body).toEqual(expected);
      expect(res.text).toBe(JSON.stringify(expected));
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.vary).toBe(VARY);
      expect(res.headers.etag).toBe(weakEtagOf(res.text));
    },
  );
});

/** A body pinned in fixtures/jongro-live-pinned.json, its `<cacheWrittenAt>` read as the seeded rows' write time. */
function pinnedBody(pinned: unknown): unknown {
  return JSON.parse(JSON.stringify(pinned).replaceAll('"<cacheWrittenAt>"', JSON.stringify(toKstInstant(CACHE_UPDATED_AT.getTime()))));
}

describe("GET /bus/live/:groupId for the Jongro routes", () => {
  it.each(LANGS.flatMap((lang) => ROUTE_IDS.map((routeId) => [lang, routeId] as const)))("answers in %s for %s the body pinned before the TOPIS route list, uncached", async (lang, routeId) => {
    // Arrange
    const expected = pinnedBody(pinnedLive.live[lang][routeId]);

    // Act
    const res = await get(`/bus/live/${routeId}`, lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expected);
    expect(res.text).toBe(JSON.stringify(expected));
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /bus/stops/:stopId/arrivals at Jongro poles", () => {
  const STOP_IDS = ["100000424", "100900045", "100900221", "100900021"] as const;

  it.each(LANGS.flatMap((lang) => STOP_IDS.map((stopId) => [lang, stopId] as const)))("answers in %s for %s the body pinned before the TOPIS route list, uncached", async (lang, stopId) => {
    // Arrange
    const expected = pinnedBody(pinnedLive.stopArrivals[lang][stopId]);

    // Act
    const res = await get(`/bus/stops/${stopId}/arrivals`, lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expected);
    expect(res.text).toBe(JSON.stringify(expected));
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

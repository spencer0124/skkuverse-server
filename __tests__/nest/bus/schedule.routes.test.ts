/**
 * Integration over the week (BusScheduleController) and smart
 * (BusEtaSmartController) routes on the production pipeline (buildTestApp),
 * with the timetable and estimate stores faked in memory and the clock fixed.
 *
 * Asserts the wire format: envelope shape, 200/404 status + error codes, ETag
 * format regexes ("week-…"/"smart-…"), 304 on If-None-Match, Cache-Control
 * max-age=300 (60 with arrival estimates; smart is private, being in the
 * request's language), i18n message presence/absence per
 * status + en translations, and X-Response-Time present on 200 but ABSENT on
 * 304. The last block applies stored arrival estimates from the faked
 * estimate store. Public holidays come
 * from the faked calendar store, empty unless a test stores a year, so a day
 * is answered by the rule-based lookup as before the calendar existed. Each
 * service's notices and suspension come from the faked content store, holding
 * revision 1 of `bus-service-notices` unless a test stores another.
 */

import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { SERVICE_CONFIG } from "../../../src/bus/bus.constants";
import type { ShuttleEtaDoc } from "../../../src/bus/eta/bus-eta.document";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusModule } from "../../../src/bus/bus.module";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { BusScheduleModule } from "../../../src/bus/schedule/bus-schedule.module";
import { BusScheduleRepository } from "../../../src/bus/schedule/bus-schedule.repository";
import { BusScheduleService } from "../../../src/bus/schedule/bus-schedule.service";
import { BusScheduleContentRepository } from "../../../src/bus/schedule-content/bus-schedule-content.repository";
import { scheduleWeek, smartSchedule } from "../../../src/bus/schedule/bus-schedule.wire";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { serviceNoticesWithNotices, serviceNoticesWithSuspension, storedScheduleContentRepository } from "../../helpers/bus/schedule-content";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusScheduleContentRepository } from "../../helpers/fakes/bus/bus-schedule-content.repository.fake";
import { FakeBusScheduleRepository } from "../../helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeCalendarRepository } from "../../helpers/fakes/calendar/calendar.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import logger from "../../../src/infra/logger";

const DO_NOT_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick", "performance"] as const;
const ENTRY = { index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null };
const pattern = (serviceId: string, days: number[], entries: Array<Record<string, unknown>> = [ENTRY]) => ({ serviceId, patternId: `p-${days.join("")}`, days, entries });

interface TestApp {
  app: NestExpressApplication;
  timetable: FakeBusScheduleRepository;
  estimates: FakeBusEtaRepository;
  holidays: FakeCalendarRepository;
  content: FakeBusScheduleContentRepository;
}

// WHY: the clock reads the (possibly fake-timer) Date, so a test fixes or advances the time with jest.
async function bootApp(content = storedScheduleContentRepository(), holidays = storedCalendarRepository()): Promise<TestApp> {
  const timetable = new FakeBusScheduleRepository();
  const estimates = new FakeBusEtaRepository();
  const app = await buildTestApp({
    imports: [SchedulingModule, BusModule, BusStopsModule, BusScheduleModule, BusEtaModule, BusEtaSmartModule],
    overrides: [
      { provide: BusScheduleRepository, useValue: timetable },
      { provide: BusScheduleContentRepository, useValue: content },
      { provide: BusEtaRepository, useValue: estimates },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: CalendarRepository, useValue: holidays },
      { provide: Clock, useValue: { now: () => new Date() } },
    ],
    role: "api",
  });
  return { app, timetable, estimates, holidays, content };
}

let app: NestExpressApplication;
let timetable: FakeBusScheduleRepository;
let holidays: FakeCalendarRepository;
let content: FakeBusScheduleContentRepository;
let httpServer: import("http").Server;
let resolveWeek: jest.SpyInstance;
let resolveSmartSchedule: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date("2026-03-10T03:00:00.000Z"), doNotFake: [...DO_NOT_FAKE] });
  ({ app, timetable, holidays, content } = await bootApp());
  timetable.patterns = [pattern("campus-inja", [1, 2, 3, 4, 5])];
  httpServer = app.getHttpServer();
  resolveWeek = jest.spyOn(app.get(BusScheduleService), "resolveWeek");
  resolveSmartSchedule = jest.spyOn(app.get(BusScheduleService), "resolveSmartSchedule");
});

afterEach(async () => {
  await app.close();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("GET /bus/schedule/data/:serviceId/week", () => {
  it("returns 200 with correct shape", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serviceId: "campus-inja",
      from: "2026-03-09",
      days: expect.any(Array),
    });
    expect(res.body.data.days).toHaveLength(7);
    expect(res.body.meta).toEqual({});
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("returns 404 SERVICE_NOT_FOUND for unknown serviceId", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/unknown/week");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  it("returns 400 INVALID_DATE_FORMAT for bad from param", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=bad");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE_FORMAT");
  });

  it("returns 400 INVALID_DATE_FORMAT for repeated from (?from=A&from=B coercion)", async () => {
    // Act
    const res = await request(httpServer).get(
      "/bus/schedule/data/campus-inja/week?from=2026-03-09&from=2026-03-10",
    );

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE_FORMAT");
  });

  it("response includes ETag header", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.headers.etag).toBeDefined();
  });

  it("returns 304 when If-None-Match matches ETag (no body, no X-Response-Time)", async () => {
    // Arrange
    const res1 = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    const etag = res1.headers.etag;

    // Act
    const res2 = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09")
      .set("If-None-Match", etag);

    // Assert
    expect(res2.status).toBe(304);
    expect(res2.text).toBe("");
    expect(res2.headers["x-response-time"]).toBeUndefined();
  });

  it("sets Cache-Control header", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("ETag format is week-{serviceId}-{from}-{hash}", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.headers.etag).toMatch(/^"week-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  it("works when from is omitted", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week");

    // Assert
    expect(res.status).toBe(200);
    expect(resolveWeek).toHaveBeenCalledWith("campus-inja", undefined);
  });
});

describe("GET /bus/schedule/data/:serviceId/smart", () => {
  it("returns 200 with selectedDate and no hidden days", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serviceId: "campus-inja",
      from: "2026-03-09",
      selectedDate: "2026-03-10",
      days: expect.any(Array),
    });
    for (const day of res.body.data.days) {
      expect(day.display).not.toBe("hidden");
    }
    expect(resolveSmartSchedule).toHaveBeenCalledWith("campus-inja");
  });

  it("returns 404 SERVICE_NOT_FOUND for unknown serviceId", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/unknown/smart");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  it("response includes ETag header with smart- prefix", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    // Arrange
    const res1 = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    const etag = res1.headers.etag;

    // Act
    const res2 = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("If-None-Match", etag);

    // Assert
    expect(res2.status).toBe(304);
  });

  it("sets Cache-Control header: 60 s for a service with arrival estimates, 300 s otherwise", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
    const fasttrack = await request(httpServer).get("/bus/schedule/data/fasttrack-inja/smart");
    expect(fasttrack.headers["cache-control"]).toBe("private, max-age=300");
  });

  it("ETag format is smart-{serviceId}-{from}-{hash} for active", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  it("suspended response includes i18n message and resumeDate", async () => {
    // Arrange
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-03-01", until: "2026-08-31" }));

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.resumeDate).toBe("2026-09-01");
    expect(res.body.data.days).toHaveLength(0);
  });

  it("noData response includes i18n message", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("noData");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.days).toHaveLength(0);
  });

  it("active response does not include message", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.message).toBeUndefined();
  });

  it("ETag uses status when from is null (suspended)", async () => {
    // Arrange
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-03-01", until: "2026-08-31" }));

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-suspended-[a-f0-9]{32}"$/);
  });

  it("ETag uses status when from is null (noData)", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-noData-[a-f0-9]{32}"$/);
  });

  it("suspended with Accept-Language: en returns English message", async () => {
    // Arrange
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-03-01", until: "2026-08-31" }));

    // Act
    const res = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");

    // Assert
    expect(res.body.data.message).toBe("Service is suspended");
  });

  it("noData with Accept-Language: en returns English message", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");

    // Assert
    expect(res.body.data.message).toBe("Schedule information is being prepared");
  });
});

describe("GET …/smart with arrival estimates", () => {
  let etaApp: NestExpressApplication;
  let server: import("http").Server;
  let etaTimetable: FakeBusScheduleRepository;
  let estimates: FakeBusEtaRepository;
  const FETCHED = new Date("2026-10-12T00:20:00.000Z");

  // A Monday of the 인자셔틀: one regular run at 10:00, stored with null drop-offs.
  const monday = (serviceId: string) =>
    pattern(serviceId, [1], [
      { index: 1, time: "07:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["07:00", null] },
      { index: 2, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] },
    ]);
  const estimate = (source: "live" | "frozen" | "predicted", offsetsSec = [0, 3060], serviceId = "campus-inja"): ShuttleEtaDoc => ({
    _id: `${serviceId}|regular|2026-10-12|10:00|${source === "predicted" ? "baseline" : "live"}`,
    kind: source === "predicted" ? "baseline" : "live",
    serviceId,
    routeType: "regular",
    date: "2026-10-12",
    time: "10:00",
    departAt: new Date("2026-10-12T01:00:00.000Z"),
    offsetsSec,
    source: source === "predicted" ? "tmap" : "naver",
    fetchedAt: FETCHED,
    ...(source === "frozen" ? { frozen: true as const, frozenAt: FETCHED } : {}),
    expiresAt: new Date("2026-10-20T01:00:00.000Z"),
  });
  const store = (...docs: ShuttleEtaDoc[]) => {
    estimates.docs = new Map(docs.map((d) => [d._id, d]));
  };

  beforeEach(async () => {
    await app.close();
    jest.setSystemTime(new Date("2026-10-12T00:30:00.000Z")); // Mon 09:30 KST
    ({ app: etaApp, timetable: etaTimetable, estimates } = await bootApp());
    app = etaApp;
    etaTimetable.patterns = [monday("campus-inja"), monday("commute-jeongja")];
    server = etaApp.getHttpServer();
  });

  it.each(["live", "frozen", "predicted"] as const)("Live entry: fills the drop-offs and names the source (%s)", async (source) => {
    // Arrange
    store(estimate(source));
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");
    const [early, run] = res.body.data.days[0].schedule;

    // Act & Assert
    expect(run.stopTimes).toEqual(["10:00", "10:51"]);
    expect(run.eta).toEqual({ source, updatedAt: "2026-10-12T00:20:00.000Z" });
    expect(early.stopTimes).toEqual(["07:00", null]);
    expect(early).not.toHaveProperty("eta");
  });

  it("New live value: the ETag changes with the estimate, and the header is max-age=60", async () => {
    // Arrange
    store(estimate("live"));
    const first = await request(server).get("/bus/schedule/data/campus-inja/smart");
    // A later live value, read once the 30 s cache and its 10-minute stale window have passed.
    store({ ...estimate("live", [0, 3360]), fetchedAt: new Date("2026-10-12T00:38:00.000Z") });
    jest.setSystemTime(new Date("2026-10-12T00:41:00.000Z"));

    // Act
    const second = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(second.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", "10:56"]);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(second.headers["cache-control"]).toBe("private, max-age=60");
  });

  it("Commute 등교 run: fills the campus drop-off and is cached like every estimated service", async () => {
    // Arrange
    etaTimetable.patterns = [
      pattern("commute-jeongja", [1], [{ index: 1, time: "10:00", routeType: "up", busCount: 1, notes: null, stopTimes: ["10:00", "10:03", null] }]),
    ];
    store({ ...estimate("live", [0, 180, 3060], "commute-jeongja"), _id: "commute-jeongja|up|2026-10-12|10:00|live", routeType: "up" });

    // Act
    const res = await request(server).get("/bus/schedule/data/commute-jeongja/smart");

    // Assert
    const [run] = res.body.data.days[0].schedule;
    expect(run.stopTimes).toEqual(["10:00", "10:03", "10:51"]);
    expect(run.eta).toEqual({ source: "live", updatedAt: "2026-10-12T00:20:00.000Z" });
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
  });

  it("Estimate store unavailable: 200 with the stored stopTimes and no eta", async () => {
    // Arrange
    estimates.failWith = new Error("connection pool closed");

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", null]);
    expect(res.body.data.days[0].schedule[1]).not.toHaveProperty("eta");
  });

  it.each(["live", "frozen", "predicted"] as const)("A body with %s estimates parses with the published smartSchedule wire", async (source) => {
    // Arrange
    store(estimate(source));

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.body.data.days[0].schedule[1].eta.source).toBe(source);
    expectWire(smartSchedule, res.body.data);
  });

  it("leaves the cached schedule unmutated", async () => {
    // Arrange
    const schedule = etaApp.get(BusScheduleService);
    const before = JSON.stringify(await schedule.resolveSmartSchedule("campus-inja"));
    store(estimate("frozen"));

    // Act
    await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(JSON.stringify(await schedule.resolveSmartSchedule("campus-inja"))).toBe(before);
  });

  it("Diagnostics stay internal: a live value's travel model changes nothing in the body", async () => {
    // Arrange
    store({ ...estimate("live"), travel: { model: "busLane", corridorCarSec: 1920, corridorSec: 1080, spanCount: 6, coverage: 0.81 } });

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    // The entry a live value without the model gives ("Live entry: … (live)").
    expect(res.body.data.days[0].schedule[1]).toEqual(expect.objectContaining({ stopTimes: ["10:00", "10:51"], eta: { source: "live", updatedAt: "2026-10-12T00:20:00.000Z" } }));
    expect(Object.keys(res.body.data.days[0].schedule[1]).sort()).toEqual(Object.keys(res.body.data.days[0].schedule[0]).concat("eta").sort());
    expect(JSON.stringify(res.body)).not.toMatch(/travel|model|corridor|spanCount|coverage/);
    expectWire(smartSchedule, res.body.data);
  });

  it("A prediction that reuses a fixed value is served as predicted, dated by its refresh, without the value it came from", async () => {
    // Arrange
    const refreshedAt = new Date("2026-10-11T19:00:00.000Z");
    store({ ...estimate("predicted"), source: "naver", fetchedAt: refreshedAt, derivedFrom: "campus-inja|regular|2026-10-05|10:00|live" });

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.body.data.days[0].schedule[1]).toEqual(expect.objectContaining({ stopTimes: ["10:00", "10:51"], eta: { source: "predicted", updatedAt: "2026-10-11T19:00:00.000Z" } }));
    expect(JSON.stringify(res.body)).not.toMatch(/derivedFrom|2026-10-05/);
    expectWire(smartSchedule, res.body.data);
  });

  it("ignores an estimate whose offsets no longer fit the sequence", async () => {
    // Fetched while the sequence had three stops.
    // Arrange
    store(estimate("live", [0, 3060, 3180]));

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", null]);
  });
});

// WHY: a service id is a lookup key, so a name Object.prototype already has must miss like any other
// unknown id.
describe("GET /bus/schedule/data/:serviceId with an Object.prototype name", () => {
  const PROTOTYPE_NAMES = ["toString", "__proto__", "constructor", "hasOwnProperty"];

  it.each(PROTOTYPE_NAMES)("%s/week → 404 SERVICE_NOT_FOUND", async (serviceId) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/${serviceId}/week`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "SERVICE_NOT_FOUND", message: `Unknown serviceId: ${serviceId}` });
  });

  it.each(PROTOTYPE_NAMES)("%s/smart → 404 SERVICE_NOT_FOUND", async (serviceId) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/${serviceId}/smart`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "SERVICE_NOT_FOUND", message: `Unknown serviceId: ${serviceId}` });
  });
});

// WHY: each distinct Monday gets its own cached week and two Atlas reads, so `from` is bounded to a year
// either side of today (KST); the clock reads 2026-03-10.
describe("GET /bus/schedule/data/:serviceId/week with a far from", () => {
  it.each(["2025-03-10", "2027-03-10", "2026-03-09"])("from=%s → 200", async (from) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

    // Assert
    expect(res.status).toBe(200);
  });

  it.each(["2025-03-09", "2027-03-11", "1970-01-05", "9999-12-27", "2026-02-31"])("from=%s → 400 INVALID_DATE_FORMAT", async (from) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_DATE_FORMAT", message: "from must be a date within a year of today" });
  });

  it("answers 400 before looking the service up", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/unknown/week?from=2030-01-07");

    // Assert
    expect(res.status).toBe(400);
  });
});

// QUIRK(date-holidays): isHoliday never returns for an Invalid Date (an impossible day, or a year-10000 day
// of a 9999-12-27 week), so a `from` that reached the week build would block the event loop.
describe("GET /bus/schedule/data/:serviceId/week with a from that would hang the holiday lookup", () => {
  const HANG_BUDGET_MS = 2_000;

  // WHY: a hang is synchronous, so no jest timeout could end it; a stubbed week build turns a `from` that gets
  // past the check into a fast failure of the not-called assertion instead of a stuck run.
  beforeEach(() => {
    resolveWeek.mockResolvedValue(null);
  });

  it.each(["2026-02-31", "2026-13-01", "9999-01-04", "2026-02-29", "2026-04-31", "0000-01-03"])(
    "from=%s → 400 INVALID_DATE_FORMAT without building a week",
    async (from) => {
      // Act
      const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

      // Assert
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({ code: "INVALID_DATE_FORMAT", message: "from must be a date within a year of today" });
      expect(resolveWeek).not.toHaveBeenCalled();
    },
    HANG_BUDGET_MS,
  );
});

// scripts/ is plain CommonJS outside tsconfig, so the reader `npm run schedule` writes with is required.
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
const COMMITTED_PATTERNS = ["campus-schedule.json", "commute-schedule.json"].flatMap((file) =>
  buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(path.join(__dirname, "../../../scripts/data", file), "utf8")))),
);

describe("GET /bus/schedule/data/:serviceId/week and /smart bodies", () => {
  it.each(Object.keys(SERVICE_CONFIG))("%s parses with the published wire schemas over the committed timetable and an override", async (serviceId) => {
    // Arrange
    jest.setSystemTime(new Date("2026-10-21T03:00:00.000Z"));
    timetable.patterns = COMMITTED_PATTERNS;
    timetable.overrides = [
      {
        serviceId,
        date: "2026-10-22",
        type: "replace",
        label: "방학",
        notices: [{ style: "info", text: "2026 하계방학 시간표" }],
        entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    // Act
    const week = await request(httpServer).get(`/bus/schedule/data/${serviceId}/week?from=2026-10-19`);
    const smart = await request(httpServer).get(`/bus/schedule/data/${serviceId}/smart`);

    // Assert
    expect([week.status, smart.status]).toEqual([200, 200]);
    expect(week.body.data.days.some((day: { label?: string | null }) => day.label === "방학")).toBe(true);
    expectWire(scheduleWeek, week.body.data);
    expectWire(smartSchedule, smart.body.data);
  });

  it("a suspended smart body parses with the published smartSchedule wire", async () => {
    // Arrange
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-03-01", until: "2026-08-31" }));

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.body.data.status).toBe("suspended");
    expectWire(smartSchedule, res.body.data);
  });

  it("a noData smart body parses with the published smartSchedule wire", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.body.data.status).toBe("noData");
    expectWire(smartSchedule, res.body.data);
  });
});

// The calendar's 2026 rows as data.go.kr getRestDeInfo listed them, the rows skkuverse-crawler stores in public_holidays.
const CALENDAR_2026 = [
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-06-03", name: "전국동시지방선거" },
];

describe("GET /bus/schedule/data/:serviceId/smart and /week while the academic calendars cannot be read", () => {
  it("serve the timetable over the rule's semesters, logging the failed read once", async () => {
    // Arrange
    const errorLog = jest.spyOn(logger, "error");
    holidays.failAcademicWith = new Error("server selection timed out");

    // Act
    const smart = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    const week = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(smart.status).toBe(200);
    expect(smart.body.data.status).toBe("active");
    expectWire(smartSchedule, smart.body.data);
    expect(week.status).toBe(200);
    expectWire(scheduleWeek, week.body.data);
    expect(errorLog.mock.calls.filter(([fields]) => (fields as { event?: string })?.event === "academic_calendar.read_failed")).toHaveLength(1);
  });
});

describe("GET /bus/schedule/data/:serviceId/week on a rest day of the crawled academic calendar", () => {
  // The crawler's own 2026 document (__tests__/nest/calendar/fixtures/academic-calendars.json): 건학기념일 on
  // 09-25 and 공부자탄강일 on 09-28; 2026-09-25 is also 추석 on the official calendar.
  const crawled2026 = (JSON.parse(fs.readFileSync(path.join(__dirname, "../calendar/fixtures/academic-calendars.json"), "utf8")) as Record<string, Record<string, unknown>>)["2026"]!;

  it("labels a crawled rest day with the public holiday on its date, and with its own title on any other", async () => {
    // Arrange
    holidays.storeRestDays({});
    holidays.storeAcademicYear(crawled2026);
    holidays.store(2026, [{ date: "2026-09-25", name: "추석" }]);

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-09-21");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.days[4]).toMatchObject({ date: "2026-09-25", display: "noService", label: "추석" });
    expectWire(scheduleWeek, res.body.data);
  });

  it("labels a crawled rest day on no public holiday with its title, less its class-day count", async () => {
    // Arrange
    holidays.storeRestDays({});
    holidays.storeAcademicYear(crawled2026);
    holidays.store(2026, []);

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-09-28");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.days[0]).toMatchObject({ date: "2026-09-28", display: "noService", label: "공부자탄강일" });
  });
});

describe("GET /bus/schedule/data/:serviceId/week on a day the official calendar lists", () => {
  it.each([
    ["Substitute holiday", "2026-03-02", "2026-03-02", "대체공휴일(삼일절)"],
    ["Election day", "2026-06-01", "2026-06-03", "전국동시지방선거"],
  ])("%s: %s week resolves %s to no service with the calendar's label", async (_label, from, date, name) => {
    // Arrange
    holidays.store(2026, CALENDAR_2026);

    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

    // Assert
    expect(res.status).toBe(200);
    const day = res.body.data.days.find((d: { date: string }) => d.date === date);
    expect(day).toMatchObject({ display: "noService", label: name, schedule: [], notices: [] });
    expect(res.body.data.days.filter((d: { display: string }) => d.display === "schedule")).toHaveLength(4);
    expectWire(scheduleWeek, res.body.data);
  });

  it("a SKKU rest day still wins over a calendar holiday on the same date", async () => {
    // Arrange
    holidays.store(2026, [...CALENDAR_2026, { date: "2026-09-28", name: "임시공휴일" }]);

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-09-28");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.days[0]).toMatchObject({ date: "2026-09-28", display: "noService", label: "공자탄신일" });
  });
});

describe("GET /bus/schedule/data/:serviceId/week and /smart with no schedule content ever read", () => {
  it.each(["week?from=2026-03-09", "smart"])("answers %s with 503 BUS_SCHEDULE_UNAVAILABLE and no Cache-Control", async (route) => {
    // Arrange
    const unread = await bootApp(new FakeBusScheduleContentRepository());
    unread.timetable.patterns = [pattern("campus-inja", [1, 2, 3, 4, 5])];

    try {
      // Act
      const res = await request(unread.app.getHttpServer()).get(`/bus/schedule/data/campus-inja/${route}`);

      // Assert
      expect(res.status).toBe(503);
      expect(res.body.error).toEqual({ code: "BUS_SCHEDULE_UNAVAILABLE", message: "The shuttle schedules are unavailable" });
      expect(res.headers["cache-control"]).toBeUndefined();
    } finally {
      await unread.app.close();
    }
  });

  it("answers smart with 503 BUS_SCHEDULE_UNAVAILABLE when only the rest days are missing", async () => {
    // Arrange
    const unread = await bootApp(storedScheduleContentRepository(), new FakeCalendarRepository());
    unread.timetable.patterns = [pattern("campus-inja", [1, 2, 3, 4, 5])];

    try {
      // Act
      const res = await request(unread.app.getHttpServer()).get("/bus/schedule/data/campus-inja/smart");

      // Assert
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("BUS_SCHEDULE_UNAVAILABLE");
      expect(res.headers["cache-control"]).toBeUndefined();
    } finally {
      await unread.app.close();
    }
  });

  it("still answers 404 SERVICE_NOT_FOUND for an unknown service", async () => {
    // Arrange
    const unread = await bootApp(new FakeBusScheduleContentRepository());

    try {
      // Act
      const res = await request(unread.app.getHttpServer()).get("/bus/schedule/data/campus-jaja/week");

      // Assert
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
    } finally {
      await unread.app.close();
    }
  });
});

describe("GET /bus/schedule/data/:serviceId/week ETag across a content push", () => {
  const WEEK = "/bus/schedule/data/campus-inja/week?from=2026-03-09";
  const TRAFFIC_NOTICE = { style: "warning", text: "교통 통제로 늦어질 수 있어요" };

  it("answers 200 with a new ETag to the old one once a pushed notice of its service is served", async () => {
    // Arrange
    const before = await request(httpServer).get(WEEK);
    content.storeServiceNotices(serviceNoticesWithNotices("campus-inja", [TRAFFIC_NOTICE]));
    jest.setSystemTime(new Date(Date.now() + 60_000));

    // Act
    const res = await request(httpServer).get(WEEK).set("If-None-Match", before.headers.etag);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^"week-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
    expect(res.headers.etag).not.toBe(before.headers.etag);
    expect(res.body.data.days[0].notices).toEqual([{ ...TRAFFIC_NOTICE, source: "service" }]);
  });

  it("keeps its ETag and answers 304 when only another service's notice is pushed", async () => {
    // Arrange
    const before = await request(httpServer).get(WEEK);
    content.storeServiceNotices(serviceNoticesWithNotices("commute-jamsil", [TRAFFIC_NOTICE]));
    jest.setSystemTime(new Date(Date.now() + 60_000));

    // Act
    const res = await request(httpServer).get(WEEK).set("If-None-Match", before.headers.etag);
    const fresh = await request(httpServer).get(WEEK);

    // Assert
    expect(res.status).toBe(304);
    expect(fresh.headers.etag).toBe(before.headers.etag);
  });
});

describe("GET /bus/config across a content push", () => {
  it("keeps its body and ETag, since it reads no schedule content", async () => {
    // Arrange
    const stored = storedScheduleContentRepository();
    const withConfig = await buildTestApp({
      imports: [SchedulingModule, BusModule, BusStopsModule, BusScheduleModule, BusConfigModule],
      overrides: [
        { provide: BusScheduleRepository, useValue: new FakeBusScheduleRepository() },
        { provide: BusScheduleContentRepository, useValue: stored },
        { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
        { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
        { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
        { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
        { provide: CalendarRepository, useValue: storedCalendarRepository() },
        { provide: Clock, useValue: { now: () => new Date() } },
      ],
      role: "api",
    });

    try {
      const server = withConfig.getHttpServer();
      const before = await request(server).get("/bus/config");
      await request(server).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
      stored.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-03-01", until: "2026-08-31" }));
      stored.storeServiceNotices(serviceNoticesWithNotices("commute-jamsil", [{ style: "warning", text: "운행 변경" }]));
      jest.setSystemTime(new Date(Date.now() + 60_000));

      // Act
      const week = await request(server).get("/bus/schedule/data/commute-jamsil/week?from=2026-03-09");
      const after = await request(server).get("/bus/config").set("If-None-Match", before.headers.etag);
      const fresh = await request(server).get("/bus/config");

      // Assert
      expect(before.status).toBe(200);
      expect(week.status).toBe(200);
      expect(after.status).toBe(304);
      expect(fresh.headers.etag).toBe(before.headers.etag);
      expect(fresh.text).toBe(before.text);
    } finally {
      await withConfig.close();
    }
  });
});

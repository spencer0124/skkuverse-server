/**
 * SubwayTimetableService, the timetable door the tracking and arrivals flows
 * read, over a scripted CalendarService (the fake in
 * __tests__/helpers/fakes/calendar/) and an in-memory `subway-timetables`
 * store. What it guards: each platform's schedule
 * is its own source's table for the service day (the Korail holiday table and
 * the Seoul Saturday table on a Saturday, both holiday tables on a public
 * holiday that falls on a Wednesday, Friday's weekday table for a train past
 * midnight), with its trains at instants of that day and its line's travel
 * order, which continues each direction's upstream platforms with its watched
 * ones; one platform's schedule is found by its platform id, and an unserved
 * id finds none; and the service window opens at 05:00 KST and closes at 01:10 after a
 * weekday and at 00:30 after a Saturday or a holiday. Over the trimmed
 * fixture of revision 1, all three day types, the tracked stations (ADR 0017, D6): every
 * station before a platform on its route is declared upstream or watched and
 * named by the provider, no run between two tracked stops of a train exceeds
 * the longest express run, every train is in view 10 minutes before the
 * platform or from where it starts, and no station of the line is skipped.
 * The day-type, window and instant rules themselves are
 * subway-timetable.rules.spec.ts's.
 *
 * The read path: no
 * table is read when the service is built; a table is read only when a
 * platform of its line is scheduled for the service day, once per stored
 * content, and held until a later service day needs another of its line; a
 * new revision reads only its changed tables, within a minute; a table that
 * cannot be read, or fails the schema, leaves the held copy serving for 24 h
 * after the manifest first named it, then its platforms have no schedule; a
 * platform with no table is reported: one schedule throws the 503
 * SubwayTimetablesUnavailableError, the list leaves it out and carries the
 * error naming its key; and a served platform whose table the revision lacks
 * is logged once per revision; one list converts each table of the day once,
 * its platforms sharing the routes and trains. The manifest's cached loader reads `Date.now()`,
 * so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { FakeCalendarService } from "../../../__tests__/helpers/fakes/calendar/calendar.service.fake";
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import { subwayTimetablesFixture, storedSubwayTimetableRepository, storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS } from "../../shared/dataset.constants";
import { SUBWAY_STATIONS } from "../subway.constants";
import { TIMETABLE_OPERATOR_BY_SOURCE } from "./subway-timetable.constants";
import type { PlatformSchedule, Timetable } from "./subway-timetable.types";

// WHY: revision 1 of the stored topology, the directions these checks hold against revision 1 of the timetables.
const TOPOLOGY = subwayTopologyFixture();
const mockedLogger = logger as unknown as Record<"error" | "warn", jest.Mock>;

function setup() {
  const holidays = new FakeCalendarService();
  return { holidays, service: storedSubwayTimetableService({ holidays }) };
}

describe("SubwayTimetableService.listPlatformSchedules", () => {
  it("serves a Saturday from the Korail and 신분당 holiday tables and the Seoul station Saturday tables", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const { schedules } = await service.listPlatformSchedules(new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect(schedules.map((s) => [s.platform.id, s.serviceDate, s.dayType])).toEqual([
      ["KR-1-P153", "2026-10-17", "holiday"],
      ["S1-4-420", "2026-10-17", "saturday"],
      ["DX-D1-4312", "2026-10-17", "holiday"],
      ["KR-K1-K230", "2026-10-17", "holiday"],
      ["S1-2-216", "2026-10-17", "saturday"],
      ["S1-8-2815", "2026-10-17", "saturday"],
      ["S1-3-334", "2026-10-17", "saturday"],
      ["KR-K1-K217", "2026-10-17", "holiday"],
      ["S1-2-222", "2026-10-17", "saturday"],
      ["DX-D1-4307", "2026-10-17", "holiday"],
      ["S1-3-332", "2026-10-17", "saturday"],
      ["DX-D1-4308", "2026-10-17", "holiday"],
      ["DX-D1-4318", "2026-10-17", "holiday"],
      ["S1-2-226", "2026-10-17", "saturday"],
      ["S1-4-433", "2026-10-17", "saturday"],
      ["KR-1-P149", "2026-10-17", "holiday"],
      ["KR-4-443", "2026-10-17", "saturday"],
      ["S1-1-154", "2026-10-17", "holiday"],
      ["DX-D1-D13", "2026-10-17", "holiday"],
      ["KR-K1-K231", "2026-10-17", "holiday"],
      ["S1-8-2821", "2026-10-17", "saturday"],
      ["KR-K1-K222", "2026-10-17", "holiday"],
      ["S1-3-340", "2026-10-17", "saturday"],
      ["S1-8-2818", "2026-10-17", "saturday"],
      ["S1-8-2817", "2026-10-17", "saturday"],
    ]);
  });

  it("serves a public holiday on a Wednesday from every line's holiday table", async () => {
    // Arrange
    const { service, holidays } = setup();
    holidays.names.set("2026-10-14", "테스트공휴일");

    // Act
    const { schedules } = await service.listPlatformSchedules(new Date("2026-10-14T03:00:00Z"));

    // Assert
    expect(new Set(schedules.map((s) => s.dayType))).toEqual(new Set(["holiday"]));
    expect(schedules).toHaveLength(25);
  });

  it("matches 00:13 on Saturday to Friday's weekday table, its trains at instants of that day", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const {
      schedules: [sungkyunkwan],
    } = await service.listPlatformSchedules(new Date("2026-10-16T15:13:00Z"));

    // Assert
    expect([sungkyunkwan?.serviceDate, sungkyunkwan?.dayType]).toEqual(["2026-10-16", "weekday"]);
    const arrivals = sungkyunkwan?.trains.flatMap((t) => t.stops.filter((s) => s.platformId === "KR-1-P153").map((s) => s.arrivalAt));
    expect(arrivals).toContainEqual(new Date("2026-10-16T15:13:00Z"));
  });

  it("hands each platform its line's travel order per direction", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const {
      schedules: [sungkyunkwan, hyehwa],
    } = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    expect(sungkyunkwan?.lineRoutes.down.slice(-11, -4)).toEqual(["KR-1-P147", "KR-1-P148", "KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-P153"]);
    expect(hyehwa?.lineRoutes.up.slice(22, 29)).toEqual(["S1-4-426", "S1-4-425", "S1-4-424", "S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420"]);
  });

  it("hands 강남 2호선 the inner circle in rising station codes and 양재 3호선 the line toward 대화 in falling ones", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const { schedules } = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const routeOf = (platformId: string) => schedules.find((s) => s.platform.id === platformId)?.lineRoutes;
    expect(routeOf("S1-2-222")?.up.slice(7, 11)).toEqual(["S1-2-219", "S1-2-220", "S1-2-221", "S1-2-222"]);
    expect(routeOf("S1-3-332")?.up.slice(8, 11)).toEqual(["S1-3-334", "S1-3-333", "S1-3-332"]);
  });

  it("continues each platform's upstream platforms with its watched platforms on its direction's route, nearest first", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const { schedules } = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const watched = schedules.flatMap(({ platform, lineRoutes }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const { upstreamPlatformIds, watchedPlatformIds } = TOPOLOGY.platforms[platform.id]![direction];
        const beyond = route.indexOf(platform.id) - upstreamPlatformIds.length;
        return [watchedPlatformIds, route.slice(Math.max(0, beyond - watchedPlatformIds.length), beyond).reverse()];
      }),
    );
    expect(watched.map(([declared]) => declared)).toEqual(watched.map(([, onRoute]) => onRoute));
    expect(watched.slice(0, 2).map(([declared]) => declared?.slice(0, 3))).toEqual([["KR-1-P157"], ["KR-1-P149", "KR-1-P148", "KR-1-P147"]]);
  });

  it("lists each platform's upstream platforms as the three before it on its direction's route, nearest first, and its next platform as the one after", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const { schedules } = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const neighbors = schedules.flatMap(({ platform, lineRoutes }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const at = route.indexOf(platform.id);
        const { upstreamPlatformIds, nextPlatformId } = TOPOLOGY.platforms[platform.id]![direction];
        return [[upstreamPlatformIds, nextPlatformId], [route.slice(Math.max(0, at - 3), at).reverse(), route[at + 1]]];
      }),
    );
    expect(neighbors.map(([declared]) => declared)).toEqual(neighbors.map(([, onRoute]) => onRoute));
  });
});

describe("SubwayTimetableService.findPlatformSchedule", () => {
  it("finds 혜화's schedule by its platform id, from its Saturday table on a Saturday", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedule = await service.findPlatformSchedule("S1-4-420", new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect([schedule?.platform.id, schedule?.dayType]).toEqual(["S1-4-420", "saturday"]);
  });

  it("finds no schedule for a platform it does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedule = await service.findPlatformSchedule("S1-2-220", new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect(schedule).toBeNull();
  });
});

describe("SubwayTimetableService.isInServiceWindow", () => {
  it.each([
    ["03:00 KST", "2026-10-16T18:00:00Z", false],
    ["04:59:59 on a Friday", "2026-10-15T19:59:59Z", false],
    ["05:00 on a Friday", "2026-10-15T20:00:00Z", true],
    ["01:09:59 after a Friday", "2026-10-16T16:09:59Z", true],
    ["01:10 after a Friday", "2026-10-16T16:10:00Z", false],
    ["00:29:59 after a Saturday", "2026-10-17T15:29:59Z", true],
    ["00:30 after a Saturday", "2026-10-17T15:30:00Z", false],
  ])("reads %s as inside the window: %s", async (_label, iso, inside) => {
    // Arrange
    const { service } = setup();

    // Act
    const isInside = await service.isInServiceWindow(new Date(iso));

    // Assert
    expect(isInside).toBe(inside);
  });

  it("closes at 00:30 after a public holiday on a Wednesday", async () => {
    // Arrange
    const { service, holidays } = setup();
    holidays.names.set("2026-10-14", "테스트공휴일");

    // Act
    const isInside = await service.isInServiceWindow(new Date("2026-10-14T15:45:00Z"));

    // Assert
    expect(isInside).toBe(false);
  });
});

describe("SubwayTimetableService.listPlatformSchedules over the tracked stations", () => {
  // WHY: the longest horizon the estimate is measured at (PREDICTION_HORIZONS_MIN in history/, which a timetable
  // spec may not import): a train due within it should be seen on its own, not lent a delay.
  const HORIZON_SEC = 10 * 60;
  // EVIDENCE: the longest run of subway-timetables revision 2 between two stops of one train with no stop between them is
  // 600 s, the line 1 express from Gasan Digital Complex to Anyang (weekday 1909 and 1911), and between two adjacent
  // stations 420 s (Shinbundang, Cheonggyesan to Pangyo).
  const MAX_UNOBSERVED_RUN_SEC = 600;
  // WHY: a run starts at these with an arrival in its row: the Shinbundang table writes arrival = departure at a run's
  // first stop (scripts/subway-timetable/convert.py), and every line 2 inner-circle lap starts at Seongsu, one station
  // before Konkuk Univ., which stays untracked because an outer-circle lap starts there too under the number it reaches
  // Jamsil with.
  const RUN_STARTS = ["DX-D1-D04", "DX-D1-4319", "DX-D1-4311", "DX-D1-4312", "S1-2-212"];
  // WHY: the id frozen at first use, the codes the 2026-05-11 KRIC list skips and line 1's joins between Seoul Metro's
  // section and Korail's, each pair adjacent.
  const ADJACENT_ACROSS_CODES = [
    "KR-1-P157 KR-1-1715",
    "KR-1-1715 KR-1-P155",
    "S1-8-2809 S1-8-2811",
    "S1-8-2821 S1-8-2828",
    "S1-8-2828 S1-8-2822",
    "KR-1-134 S1-1-150",
    "S1-1-155 S1-1-159",
    "S1-1-159 S1-1-156",
    "S1-1-158 KR-1-123",
  ];
  const DAYS = ["2026-10-16T03:00:00Z", "2026-10-17T03:00:00Z", "2026-10-18T03:00:00Z"];
  const SECOND_MS = 1000;

  async function listTracked() {
    const { service } = setup();
    const schedules = (await Promise.all(DAYS.map((day) => service.listPlatformSchedules(new Date(day))))).flatMap((listed) => listed.schedules);
    return schedules.flatMap(({ platform, lineRoutes, trains, dayType }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const tracked = route.slice(0, route.indexOf(platform.id) + 1);
        const rows = trains
          .filter((train) => train.direction === direction && train.stops.some((stop) => stop.platformId === platform.id))
          .map((train) => ({ train, stops: train.stops.filter((stop) => tracked.includes(stop.platformId)) }));
        return { label: `${platform.id} ${direction} ${dayType}`, platform, direction, tracked, rows };
      }),
    );
  }

  const secondsBetween = (later: Date | null, earlier: Date | null): number => ((later?.getTime() ?? 0) - (earlier?.getTime() ?? 0)) / SECOND_MS;

  it("declares every station before each platform on its route as upstream or watched, each one a platform the provider names", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const served = new Set(SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => platform.id)));
    const declared = tracked.map(({ platform, direction, tracked: stations }) => {
      const { upstreamPlatformIds, watchedPlatformIds } = TOPOLOGY.platforms[platform.id]![direction];
      return [[...upstreamPlatformIds, ...watchedPlatformIds], stations.slice(0, -1).reverse()];
    });
    expect(declared.map(([named]) => named)).toEqual(declared.map(([, onRoute]) => onRoute));
    const unnamed = tracked.flatMap(({ tracked: stations }) => stations.filter((id) => !served.has(id) && TOPOLOGY.neighbors[id] === undefined));
    expect(unnamed).toEqual([]);
  });

  it("leaves no run over 600 s between two tracked stops of a train at a served platform", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const longRuns = tracked.flatMap(({ label, rows }) =>
      rows.flatMap(({ train, stops }) =>
        stops.slice(1).flatMap((stop, i) => {
          const from = stops[i];
          const runSec = secondsBetween(stop.arrivalAt, from?.departureAt ?? from?.arrivalAt ?? null);
          return runSec > MAX_UNOBSERVED_RUN_SEC ? [`${label} ${train.trainNo} ${from?.platformId}→${stop.platformId} ${runSec} s`] : [];
        }),
      ),
    );
    expect(longRuns).toEqual([]);
  });

  it("keeps each train at a served platform in view for 10 minutes before it, or from where it starts", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const shortViews = tracked.flatMap(({ label, platform, rows }) =>
      rows.flatMap(({ train, stops }) => {
        const [first] = stops;
        const at = stops.find((stop) => stop.platformId === platform.id);
        if (!first || !at || first === at || first.arrivalAt === null || RUN_STARTS.includes(first.platformId)) return [];
        const viewSec = secondsBetween(at.arrivalAt ?? at.departureAt, first.arrivalAt);
        return viewSec < HORIZON_SEC ? [`${label} ${train.trainNo} from ${first.platformId} ${viewSec} s`] : [];
      }),
    );
    expect(shortViews).toEqual([]);
  });

  it("skips no station of the line between two tracked ones", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const codeOf = (platformId: string): number => Number(platformId.slice(-2));
    const skipped = tracked.flatMap(({ label, tracked: stations }) =>
      stations.slice(1).flatMap((id, i) => {
        const before = stations[i] ?? "";
        const isAdjacent = Math.abs(codeOf(id) - codeOf(before)) === 1 || ADJACENT_ACROSS_CODES.some((pair) => [`${before} ${id}`, `${id} ${before}`].includes(pair));
        return isAdjacent ? [] : [`${label} ${before}→${id}`];
      }),
    );
    expect([...new Set(skipped)]).toEqual([]);
  });
});

describe("SubwayTimetableService over the stored subway-timetables", () => {
  // Tuesday 2026-10-20 02:00 KST, the service day of Monday.
  const NIGHT = new Date("2026-10-19T17:00:00.000Z");
  const MINUTE_MS = 60_000;
  const DAY_MS = 24 * 60 * MINUTE_MS;

  function setupStored(tables: readonly Timetable[] = subwayTimetablesFixture()) {
    let now = NIGHT;
    const clock: Clock = { now: () => now };
    const repository = storedSubwayTimetableRepository(tables);
    const holidays = new FakeCalendarService();
    const service = storedSubwayTimetableService({ repository, holidays, clock });
    // The clock and Date.now() move together: the service reads the one, the manifest's cached loader the other.
    const advanceTo = (instant: Date | string): Date => {
      now = new Date(instant);
      jest.setSystemTime(now);
      return now;
    };
    const partIdOf = (key: string): string => {
      const parts = (repository.header?.data as { parts: Array<{ key: string; partId: string }> }).parts;
      return parts.find((part) => part.key === key)?.partId ?? "";
    };
    return { repository, service, advanceTo, partIdOf, now: () => now };
  }

  const tableOf = (tables: readonly Timetable[], key: string): Timetable => tables.find((t) => `${t.operator}-${t.line}-${t.dayType}` === key)!;
  const withShiftedTrains = (tables: readonly Timetable[], key: string, seconds: number): Timetable[] =>
    tables.map((t) =>
      t === tableOf(tables, key)
        ? { ...t, trains: t.trains.map((train) => ({ ...train, stops: train.stops.map((stop) => ({ ...stop, arr: stop.arr && stop.arr + seconds, dep: stop.dep && stop.dep + seconds })) })) }
        : t,
    );
  const arrivalsAt = (schedule: { trains: ReadonlyArray<{ stops: ReadonlyArray<{ platformId: string; arrivalAt: Date | null }> }> } | null, platformId: string) =>
    schedule?.trains.flatMap((train) => train.stops.filter((stop) => stop.platformId === platformId).map((stop) => stop.arrivalAt?.toISOString())) ?? [];

  beforeEach(() => {
    jest.useFakeTimers({ now: NIGHT });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reads neither the manifest nor a table when it is built", () => {
    // Act
    const { repository } = setupStored();

    // Assert
    expect(repository.manifestReads).toBe(0);
    expect(repository.tableReads).toEqual([]);
  });

  it("Night request: reads S1-4-weekday once for 혜화 at 02:00 on a Tuesday, then serves later requests from the held copy", async () => {
    // Arrange
    const { repository, service, partIdOf } = setupStored();

    // Act
    const schedules: Array<PlatformSchedule | null> = [];
    for (let request = 0; request < 3; request++) schedules.push(await service.findPlatformSchedule("S1-4-420", NIGHT));

    // Assert
    expect(repository.tableReads).toEqual([partIdOf("S1-4-weekday")]);
    expect(schedules.map((schedule) => [schedule?.serviceDate, schedule?.dayType])).toEqual(Array(3).fill(["2026-10-19", "weekday"]));
    expect(schedules[2]?.trains.length).toBeGreaterThan(0);
  });

  it("reads a line's table once for two of its platforms scheduled at once", async () => {
    // Arrange
    const { repository, service, partIdOf } = setupStored();

    // Act
    await Promise.all([service.findPlatformSchedule("S1-2-216", NIGHT), service.findPlatformSchedule("S1-2-222", NIGHT)]);

    // Assert
    expect(repository.tableReads).toEqual([partIdOf("S1-2-weekday")]);
  });

  it("converts each table of the day once per list, handing its platforms the same routes and trains", async () => {
    // Arrange
    const { service } = setupStored();

    // Act
    const { schedules } = await service.listPlatformSchedules(NIGHT);

    // Assert
    // WHY: a tick converts tens of thousands of stops; 25 platforms read 7 tables, so a conversion per platform more than doubles it.
    const keyOf = (s: PlatformSchedule): string => `${TIMETABLE_OPERATOR_BY_SOURCE[s.platform.timetable.source]}-${s.platform.line}-${s.dayType}`;
    const firstByKey = new Map(schedules.map((s) => [keyOf(s), s] as const).reverse());
    expect(schedules).toHaveLength(25);
    expect(firstByKey.size).toBe(7);
    expect(new Set(schedules.map((s) => s.trains)).size).toBe(7);
    expect(new Set(schedules.map((s) => s.lineRoutes)).size).toBe(7);
    expect(schedules.filter((s) => s.trains !== firstByKey.get(keyOf(s))?.trains || s.lineRoutes !== firstByKey.get(keyOf(s))?.lineRoutes)).toEqual([]);
  });

  it("lists every served platform's schedule, reading each line's table of the day once", async () => {
    // Arrange
    const { repository, service } = setupStored();

    // Act
    const listed = await service.listPlatformSchedules(NIGHT);
    await service.listPlatformSchedules(NIGHT);

    // Assert
    expect(listed.schedules).toHaveLength(25);
    expect(listed.unavailable).toBeNull();
    expect(repository.tableReads.map((partId) => partId.replace(/^subway-timetables\/|@.*$/g, "")).sort()).toEqual([
      "DX-D1-weekday",
      "KR-1-weekday",
      "KR-K1-weekday",
      "S1-2-weekday",
      "S1-3-weekday",
      "S1-4-weekday",
      "S1-8-weekday",
    ]);
  });

  it("Service day changes: a Saturday answer reads S1-4-saturday and drops S1-4-weekday, which Monday reads again", async () => {
    // Arrange
    const { repository, service, advanceTo, partIdOf } = setupStored();

    // Act
    await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-23T01:00:00.000Z"));
    await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-23T18:30:00.000Z"));
    await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-25T01:00:00.000Z"));
    const monday = await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-26T01:00:00.000Z"));

    // Assert
    expect(repository.tableReads).toEqual([partIdOf("S1-4-weekday"), partIdOf("S1-4-saturday"), partIdOf("S1-4-holiday"), partIdOf("S1-4-weekday")]);
    expect(monday?.dayType).toBe("weekday");
  });

  it("keeps a weekday table from Tuesday into Wednesday without reading it again", async () => {
    // Arrange
    const { repository, service, advanceTo } = setupStored();

    // Act
    await service.listPlatformSchedules(advanceTo("2026-10-20T01:00:00.000Z"));
    await service.listPlatformSchedules(advanceTo("2026-10-21T01:00:00.000Z"));

    // Assert
    expect(repository.tableReads).toHaveLength(7);
  });

  it("New timetable while the poller runs: schedules 성균관대 from a KR-1-weekday pushed at 10:00 by 10:01, reading only that table", async () => {
    // Arrange
    const tables = subwayTimetablesFixture();
    const { repository, service, advanceTo, partIdOf } = setupStored(tables);
    const before = await service.listPlatformSchedules(advanceTo("2026-10-20T01:00:00.000Z"));
    repository.storeTables(withShiftedTrains(tables, "KR-1-weekday", 120));

    // Act
    const after = await service.listPlatformSchedules(advanceTo(new Date(Date.parse("2026-10-20T01:00:00.000Z") + MINUTE_MS + 1)));

    // Assert
    expect(repository.tableReads.slice(7)).toEqual([partIdOf("KR-1-weekday")]);
    const shifted = arrivalsAt(before.schedules[0] ?? null, "KR-1-P153").map((iso) => iso && new Date(Date.parse(iso) + 120_000).toISOString());
    expect(arrivalsAt(after.schedules[0] ?? null, "KR-1-P153")).toEqual(shifted);
  });

  it("Invalid table in a new revision: keeps serving the held KR-1-weekday for 24 h, reading the new part once a minute, then has none", async () => {
    // Arrange
    const tables = subwayTimetablesFixture();
    const { repository, service, advanceTo, partIdOf } = setupStored(tables);
    const pushedAt = Date.parse("2026-10-20T01:00:00.000Z");
    const held = await service.findPlatformSchedule("KR-1-P153", advanceTo(new Date(pushedAt)));
    const invalid = tables.map((t) => (t === tableOf(tables, "KR-1-weekday") ? { ...t, trains: [{ ...t.trains[0]!, trainNo: "K602" }] } : t));
    repository.storeTables(invalid);

    // Act
    const served = await service.findPlatformSchedule("KR-1-P153", advanceTo(new Date(pushedAt + MINUTE_MS + 1)));
    await service.findPlatformSchedule("KR-1-P153", advanceTo(new Date(pushedAt + MINUTE_MS + 30_000)));
    const late = service.findPlatformSchedule("KR-1-P153", advanceTo(new Date(pushedAt + MINUTE_MS + DAY_MS + 1)));

    // Assert
    expect(served?.trains).toEqual(held?.trains.map((train) => ({ ...train, stops: train.stops })));
    await expect(late).rejects.toMatchObject({ code: "SUBWAY_TIMETABLES_UNAVAILABLE", httpStatus: 503, keys: ["KR-1-weekday"] });
    expect(repository.tableReads.filter((partId) => partId === partIdOf("KR-1-weekday"))).toHaveLength(2);
  });

  it("Fallback needs a table: rejects 혜화's schedule with the 503 SUBWAY_TIMETABLES_UNAVAILABLE when nothing was ever read and the database is unreachable", async () => {
    // Arrange
    const { repository, service } = setupStored();
    repository.failWith = new Error("server selection timed out");

    // Act
    const schedule = service.findPlatformSchedule("S1-4-420", NIGHT);

    // Assert
    await expect(schedule).rejects.toMatchObject({ name: "SubwayTimetablesUnavailableError", code: "SUBWAY_TIMETABLES_UNAVAILABLE", httpStatus: 503, keys: ["S1-4-weekday"] });
  });

  it("finds no schedule for a platform it does not serve, reading nothing", async () => {
    // Arrange
    const { repository, service } = setupStored();

    // Act
    const schedule = await service.findPlatformSchedule("S1-2-220", NIGHT);

    // Assert
    expect(schedule).toBeNull();
    expect(repository.tableReads).toEqual([]);
  });

  it("answers the service window with the database unreachable, reading no dataset", async () => {
    // Arrange
    const { repository, service } = setupStored();
    repository.failWith = new Error("server selection timed out");

    // Act
    const isInside = await service.isInServiceWindow(new Date("2026-10-20T01:00:00.000Z"));

    // Assert
    expect(isInside).toBe(true);
    expect(repository.manifestReads).toBe(0);
  });

  it("Atlas unreachable during service hours: keeps scheduling every platform from the held tables", async () => {
    // Arrange
    const { repository, service, advanceTo } = setupStored();
    await service.listPlatformSchedules(advanceTo("2026-10-20T01:00:00.000Z"));
    repository.failWith = new Error("server selection timed out");

    // Act
    const listed = await service.listPlatformSchedules(advanceTo("2026-10-20T01:10:00.000Z"));

    // Assert
    expect(listed.schedules).toHaveLength(25);
    expect(listed.unavailable).toBeNull();
  });

  it("Poller tick without a table: lists the platforms it could schedule, with the error naming KR-1-weekday, which it could not read", async () => {
    // Arrange
    const { repository, service, partIdOf } = setupStored();
    repository.parts.delete(partIdOf("KR-1-weekday"));

    // Act
    const listed = await service.listPlatformSchedules(new Date("2026-10-20T01:00:00.000Z"));

    // Assert
    expect(listed.schedules.map((schedule) => schedule.platform.id)).toEqual(SUBWAY_STATIONS.flatMap((station) => station.platforms.map((p) => p.id)).filter((id) => !["KR-1-P153", "KR-1-P149", "S1-1-154"].includes(id)));
    expect(listed.unavailable).toMatchObject({ code: "SUBWAY_TIMETABLES_UNAVAILABLE", httpStatus: 503, keys: ["KR-1-weekday"] });
  });

  it("Deploy adds a line before its tables are pushed: logs a served platform whose table the revision lacks once per revision", async () => {
    // Arrange
    const tables = subwayTimetablesFixture();
    const withoutSaturday = tables.filter((t) => t !== tableOf(tables, "S1-4-saturday"));
    const { repository, service, advanceTo } = setupStored(withoutSaturday);

    // Act
    await service.listPlatformSchedules(advanceTo("2026-10-20T01:00:00.000Z"));
    await service.listPlatformSchedules(advanceTo("2026-10-20T01:02:00.000Z"));
    repository.storeTables(withoutSaturday);
    const listed = await service.listPlatformSchedules(advanceTo("2026-10-20T01:04:00.000Z"));

    // Assert
    expect(listed.schedules).toHaveLength(25);
    expect(mockedLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.timetables.table_missing", revision: 1, key: "S1-4-saturday", platformIds: ["S1-4-420", "S1-4-433", "KR-4-443"] }),
      expect.objectContaining({ event: "subway.timetables.table_missing", revision: 2, key: "S1-4-saturday", platformIds: ["S1-4-420", "S1-4-433", "KR-4-443"] }),
    ]);
  });

  it("rejects the Saturday schedule of 혜화 when the revision lacks S1-4-saturday", async () => {
    // Arrange
    const tables = subwayTimetablesFixture();
    const { service } = setupStored(tables.filter((t) => t !== tableOf(tables, "S1-4-saturday")));

    // Act
    const schedule = service.findPlatformSchedule("S1-4-420", new Date("2026-10-24T01:00:00.000Z"));

    // Assert
    await expect(schedule).rejects.toMatchObject({ code: "SUBWAY_TIMETABLES_UNAVAILABLE", keys: ["S1-4-saturday"] });
  });

  it("reads the manifest again only after a minute", async () => {
    // Arrange
    const { repository, service, advanceTo } = setupStored();

    // Act
    await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-20T01:00:00.000Z"));
    await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-20T01:00:59.000Z"));
    await service.findPlatformSchedule("S1-4-420", advanceTo("2026-10-20T01:01:01.000Z"));

    // Assert
    expect(repository.manifestReads).toBe(2);
    expect(DATASET_CACHE_TTL_MS).toBe(MINUTE_MS);
  });
});

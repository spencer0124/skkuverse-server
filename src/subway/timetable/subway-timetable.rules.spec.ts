/**
 * The service-day rules: which service day an instant belongs to (it starts at 03:00 KST, so a train past
 * midnight is the previous day's), which day type each timetable source serves on a date, and how a
 * timetable's seconds become instants. Also the code's platforms, each found by its KRIC id with its line and
 * timetable source, and revision 2 of the stored topology's upstream, watched and next platforms and direction
 * names for each; which table a platform reads, the travel order of a line per direction, each table's key, and
 * the push check that every served platform's source has a table for each day type it declares, and the push
 * warnings over the stops the tracker follows to each served platform: no run over 600 s between two of them,
 * each train in view for 10 minutes before the platform, and no station of the line skipped between them. The
 * push check that every stop time at a served platform falls inside the service window of its table's day type.
 */
import { subwayTimetablesFixture } from "../../../__tests__/helpers/subway/timetables";
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import type { NetworkPlatform } from "../subway.types";
import { TIMETABLE_DAY_TYPES, TIMETABLE_OPERATOR_BY_SOURCE } from "./subway-timetable.constants";
import {
  findSubwayPlatform,
  findTimetable,
  isInServiceWindow,
  listSubwayPlatforms,
  toDayType,
  toLineRoutes,
  toScheduledTrains,
  toServiceDate,
  toEvictedTimetableKeys,
  toPlatformTimetableKey,
  toServiceInstant,
  toServiceWindowIssues,
  toTimetableCoverageIssues,
  toTimetableKey,
  toTrackedStopIssues,
  toUncoveredPlatformIdsByKey,
} from "./subway-timetable.rules";
import type { Timetable, TimetableTrain } from "./subway-timetable.types";

const SUNGKYUNKWAN = findSubwayPlatform("KR-1-P153") as NetworkPlatform;
const HYEHWA = findSubwayPlatform("S1-4-420") as NetworkPlatform;
const TOPOLOGY = subwayTopologyFixture();

function table(overrides: Partial<Timetable>): Timetable {
  return {
    source: { kind: "korail-xlsx", ref: "test", revision: "2026-08-28" },
    operator: "KR",
    line: "1",
    dayType: "weekday",
    stations: ["KR-1-P154", "KR-1-P153", "KR-1-P152"],
    trains: [],
    ...overrides,
  };
}

describe("toServiceDate", () => {
  it.each([
    ["02:59:59 KST Saturday, a UTC Friday", "2026-10-16T17:59:59Z", "2026-10-16"],
    ["03:00:00 KST Saturday, a UTC Friday", "2026-10-16T18:00:00Z", "2026-10-17"],
    ["03:00:01 KST Saturday, a UTC Friday", "2026-10-16T18:00:01Z", "2026-10-17"],
  ])("puts %s on the service day that starts at 03:00 KST", (_label, iso, serviceDate) => {
    // Act
    const date = toServiceDate(new Date(iso));

    // Assert
    expect(date).toBe(serviceDate);
  });

  it("puts 03:30 KST on the KST date, not on the UTC date it still is", () => {
    // Act
    const date = toServiceDate(new Date("2026-10-16T18:30:00Z"));

    // Assert
    expect(date).toBe("2026-10-17");
    expect(date).not.toBe("2026-10-16");
  });
});

describe("toDayType", () => {
  it.each([
    ["Friday", "weekday", "weekday", "2026-10-16", false],
    ["Saturday", "holiday", "saturday", "2026-10-17", false],
    ["Sunday", "holiday", "holiday", "2026-10-18", false],
    ["Monday", "weekday", "weekday", "2026-10-19", false],
    ["public holiday on a Wednesday", "holiday", "holiday", "2026-10-14", true],
    ["public holiday on a Saturday", "holiday", "holiday", "2026-10-17", true],
  ] as const)("serves a %s from korail's %s table and the Seoul station's %s table", (_label, korail, seoul, date, isPublicHoliday) => {
    // Act
    const dayTypes = [toDayType("korail", date, isPublicHoliday), toDayType("seoul-station", date, isPublicHoliday)];

    // Assert
    expect(dayTypes).toEqual([korail, seoul]);
  });
});

describe("toServiceInstant", () => {
  it("counts the seconds from 00:00 KST of the service date, past midnight into the next date", () => {
    // Act
    const instants = [toServiceInstant("2026-10-16", 75840), toServiceInstant("2026-10-16", 87180)];

    // Assert
    expect(instants).toEqual([new Date("2026-10-16T12:04:00Z"), new Date("2026-10-16T15:13:00Z")]);
  });
});

// WHY: revision 2 of the stored subway-timetables, trimmed (fixtures/subway-timetables/ of __tests__/nest/subway).
const STORED = subwayTimetablesFixture();

describe("findTimetable", () => {
  it("serves a Saturday from the 1호선 holiday table and the 4호선 Saturday table", () => {
    // Arrange
    const serviceDate = toServiceDate(new Date("2026-10-17T03:00:00Z"));

    // Act
    const korail = findTimetable(STORED, SUNGKYUNKWAN, toDayType("korail", serviceDate, false));
    const seoul = findTimetable(STORED, HYEHWA, toDayType("seoul-station", serviceDate, false));

    // Assert
    expect([korail?.line, korail?.dayType, seoul?.line, seoul?.dayType]).toEqual(["1", "holiday", "4", "saturday"]);
  });

  it("serves a public holiday on a Wednesday from both lines' holiday tables", () => {
    // Act
    const korail = findTimetable(STORED, SUNGKYUNKWAN, toDayType("korail", "2026-10-14", true));
    const seoul = findTimetable(STORED, HYEHWA, toDayType("seoul-station", "2026-10-14", true));

    // Assert
    expect([korail?.line, korail?.dayType, seoul?.line, seoul?.dayType]).toEqual(["1", "holiday", "4", "holiday"]);
  });

  it("finds no table for a day type the platform's line has none of", () => {
    // Act & Assert
    expect(findTimetable(STORED, SUNGKYUNKWAN, "saturday")).toBeNull();
  });
});

describe("toScheduledTrains", () => {
  it("matches the last southbound 성균관대 train at 00:13 on Saturday to Friday's weekday table", () => {
    // Arrange
    const now = new Date("2026-10-16T15:10:00Z");
    const serviceDate = toServiceDate(now);
    const weekday = findTimetable(STORED, SUNGKYUNKWAN, toDayType("korail", serviceDate, false)) as Timetable;

    // Act
    const trains = toScheduledTrains(weekday, serviceDate);

    // Assert
    expect(serviceDate).toBe("2026-10-16");
    expect(serviceDate).not.toBe("2026-10-17");
    const lastDown = trains
      .filter((t) => t.direction === "down")
      .flatMap((t) => t.stops.filter((s) => s.platformId === "KR-1-P153").map((s) => ({ trainNo: t.trainNo, arrivalAt: s.arrivalAt })))
      .sort((a, b) => Number(b.arrivalAt) - Number(a.arrivalAt))[0];
    expect(lastDown).toEqual({ trainNo: "0515", arrivalAt: new Date("2026-10-16T15:13:00Z") });
  });

  it("turns each stop's seconds into instants and keeps a missing time missing", () => {
    // Arrange
    const timetable = table({
      trains: [
        {
          trainNo: "0493",
          direction: "down",
          destination: "서동탄",
          express: false,
          stops: [
            { station: "KR-1-P152", arr: null, dep: 75660 },
            { station: "KR-1-P153", arr: 75840, dep: null },
          ],
        },
      ],
    });

    // Act
    const trains = toScheduledTrains(timetable, "2026-10-16");

    // Assert
    expect(trains).toEqual([
      {
        trainNo: "0493",
        direction: "down",
        destination: "서동탄",
        express: false,
        stops: [
          { platformId: "KR-1-P152", arrivalAt: null, departureAt: new Date("2026-10-16T12:01:00Z") },
          { platformId: "KR-1-P153", arrivalAt: new Date("2026-10-16T12:04:00Z"), departureAt: null },
        ],
      },
    ]);
  });
});

describe("toLineRoutes", () => {
  it("orders each direction's stations as its trains travel, whichever way the file lists them", () => {
    // Arrange
    const korail = STORED.find((t) => t.line === "1" && t.dayType === "weekday") as Timetable;
    const seoul = STORED.find((t) => t.line === "4" && t.dayType === "weekday") as Timetable;

    // Act
    const [korailRoutes, seoulRoutes] = [toLineRoutes(korail), toLineRoutes(seoul)];

    // Assert
    expect(korailRoutes.down.slice(0, 8)).toEqual(["KR-1-123", "S1-1-158", "S1-1-157", "S1-1-156", "S1-1-159", "S1-1-155", "S1-1-154", "S1-1-153"]);
    expect(korailRoutes.up).toEqual([...korailRoutes.down].reverse());
    expect(seoulRoutes.up.slice(0, 7)).toEqual(["KR-4-448", "KR-4-447", "KR-4-446", "KR-4-445", "KR-4-444", "KR-4-443", "KR-4-442"]);
    expect(seoulRoutes.down).toEqual([...seoulRoutes.up].reverse());
  });
});

describe("toTimetableKey", () => {
  it.each([
    ["1호선's weekday table", { operator: "KR", line: "1", dayType: "weekday" }, "KR-1-weekday"],
    ["4호선's Saturday table", { operator: "S1", line: "4", dayType: "saturday" }, "S1-4-saturday"],
    ["신분당선's holiday table", { operator: "DX", line: "D1", dayType: "holiday" }, "DX-D1-holiday"],
  ] as const)("keys %s by its operator, line and day type", (_label, fields, key) => {
    // Act
    const tableKey = toTimetableKey(table(fields));

    // Assert
    expect(tableKey).toBe(key);
  });
});

describe("toPlatformTimetableKey", () => {
  it.each([
    ["성균관대 1호선 on a holiday", "KR-1-P153", "holiday", "KR-1-holiday"],
    ["혜화 4호선 on a Saturday", "S1-4-420", "saturday", "S1-4-saturday"],
    ["정자 신분당선 on a weekday", "DX-D1-4312", "weekday", "DX-D1-weekday"],
  ] as const)("keys %s's table by the platform's operator and line and the day type", (_label, platformId, dayType, key) => {
    // Act
    const tableKey = toPlatformTimetableKey(findSubwayPlatform(platformId) as NetworkPlatform, dayType);

    // Assert
    expect(tableKey).toBe(key);
  });
});

describe("toPlatformTimetableKey by the timetable source's operator", () => {
  it.each([
    ["종로5가 1호선, a Seoul Metro platform that Korail's xlsx times", { id: "S1-1-154", line: "1", statnId: "1001000129", frCode: "129", timetable: { source: "korail" } }, "weekday", "KR-1-weekday"],
    ["금정 4호선, a Korail platform that the Seoul timetable times", { id: "KR-4-443", line: "4", statnId: "1004000443", frCode: "443", timetable: { source: "seoul-station", stationCode: "1458" } }, "saturday", "S1-4-saturday"],
  ] as const)("keys %s by its source's table", (_label, platform, dayType, key) => {
    // Act
    const tableKey = toPlatformTimetableKey(platform, dayType);

    // Assert
    expect(tableKey).toBe(key);
  });
});

describe("toEvictedTimetableKeys", () => {
  const held = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([key, lastServiceDate]) => [key, { lastServiceDate }]));

  it("Service day changes: drops S1-4-weekday, last used on Friday, once Saturday needs S1-4-saturday", () => {
    // Act
    const evicted = toEvictedTimetableKeys(held({ "S1-4-weekday": "2026-10-16" }), "2026-10-17", new Set(["S1-4-saturday", "KR-1-holiday"]));

    // Assert
    expect(evicted).toEqual(["S1-4-weekday"]);
  });

  it("keeps a table last used the day before when the service day needs the same table again", () => {
    // Act
    const evicted = toEvictedTimetableKeys(held({ "S1-4-weekday": "2026-10-20", "KR-1-weekday": "2026-10-20" }), "2026-10-21", new Set(["S1-4-weekday", "KR-1-weekday"]));

    // Assert
    expect(evicted).toEqual([]);
  });

  it("keeps a table used on the service day being scheduled, needed or not", () => {
    // Act
    const evicted = toEvictedTimetableKeys(held({ "S1-4-holiday": "2026-10-21", "S1-4-weekday": "2026-10-21" }), "2026-10-21", new Set(["S1-4-weekday"]));

    // Assert
    expect(evicted).toEqual([]);
  });

  it("drops only the tables of an earlier day the service day does not need, whatever their line", () => {
    // Act
    const evicted = toEvictedTimetableKeys(
      held({ "KR-1-weekday": "2026-10-16", "S1-4-weekday": "2026-10-16", "S1-2-weekday": "2026-10-17" }),
      "2026-10-17",
      new Set(["KR-1-holiday", "S1-4-saturday", "S1-2-saturday"]),
    );

    // Assert
    expect(evicted).toEqual(["KR-1-weekday", "S1-4-weekday"]);
  });
});

describe("toUncoveredPlatformIdsByKey", () => {
  it("names, by each table key the stored ones lack, every platform that key serves, in served order", () => {
    // Arrange
    const keys = new Set(["S1-2-weekday", "S1-2-holiday", "KR-1-weekday"]);

    // Act
    const uncovered = toUncoveredPlatformIdsByKey(keys, [SUNGKYUNKWAN, ...(["S1-2-216", "S1-2-222"].map(findSubwayPlatform) as NetworkPlatform[])]);

    // Assert
    expect([...uncovered]).toEqual([
      ["KR-1-holiday", ["KR-1-P153"]],
      ["S1-2-saturday", ["S1-2-216", "S1-2-222"]],
    ]);
  });

  it("returns none when every key is stored", () => {
    // Act
    const uncovered = toUncoveredPlatformIdsByKey(new Set(["S1-4-weekday", "S1-4-saturday", "S1-4-holiday"]), [HYEHWA]);

    // Assert
    expect(uncovered.size).toBe(0);
  });
});

describe("toTimetableCoverageIssues", () => {
  // WHY: one small table per day type each served platform's source declares, the coverage a push must hold.
  const covering = (): Timetable[] => {
    const keys = listSubwayPlatforms().flatMap((platform) =>
      TIMETABLE_DAY_TYPES[platform.timetable.source].map((dayType) => ({ operator: TIMETABLE_OPERATOR_BY_SOURCE[platform.timetable.source], line: platform.line, dayType })),
    );
    return [...new Map(keys.map((fields) => [`${fields.operator}-${fields.line}-${fields.dayType}`, table(fields)])).values()];
  };

  it("returns none for one table per day type of every served platform's source", () => {
    // Act
    const issues = toTimetableCoverageIssues(covering(), listSubwayPlatforms());

    // Assert
    expect(covering()).toHaveLength(18);
    expect(issues).toEqual([]);
  });

  it("Missing Saturday table: names S1-4-420 saturday and KR-1-P153 holiday at their tables' keys", () => {
    // Arrange
    const withoutSaturdayOrKorailHoliday = covering().filter(
      (t) => !(t.line === "4" && t.dayType === "saturday") && !(t.line === "1" && t.dayType === "holiday"),
    );

    // Act
    const issues = toTimetableCoverageIssues(withoutSaturdayOrKorailHoliday, listSubwayPlatforms());

    // Assert
    expect(issues).toEqual([
      { path: ["KR-1-holiday"], message: "no table for KR-1-P153 holiday, KR-1-P149 holiday, S1-1-154 holiday" },
      { path: ["S1-4-saturday"], message: "no table for S1-4-420 saturday, S1-4-433 saturday, KR-4-443 saturday" },
    ]);
  });

  it("names every platform a missing table serves, once at its key", () => {
    // Arrange
    const withoutLine2Saturday = covering().filter((t) => !(t.line === "2" && t.dayType === "saturday"));

    // Act
    const issues = toTimetableCoverageIssues(withoutLine2Saturday, listSubwayPlatforms());

    // Assert
    expect(issues).toEqual([{ path: ["S1-2-saturday"], message: "no table for S1-2-216 saturday, S1-2-222 saturday, S1-2-226 saturday" }]);
  });

  it("asks a table of no platform it is not handed", () => {
    // Act
    const issues = toTimetableCoverageIssues([], [HYEHWA]);

    // Assert
    expect(issues.map((issue) => issue.path[0])).toEqual(["S1-4-weekday", "S1-4-saturday", "S1-4-holiday"]);
  });
});

describe("toTrackedStopIssues", () => {
  type Stop = [station: string, arr: number | null, dep: number | null];
  const train = (trainNo: string, direction: "up" | "down", stops: Stop[]): TimetableTrain => ({
    trainNo,
    direction,
    destination: "test",
    express: false,
    stops: stops.map(([station, arr, dep]) => ({ station, arr, dep })),
  });
  // WHY: a down train from four stations out, so the down route runs from S1-4-424 and its view is long enough.
  const DOWN = train("9001", "down", [
    ["S1-4-424", 0, 30],
    ["S1-4-423", 150, 180],
    ["S1-4-422", 300, 330],
    ["S1-4-421", 450, 480],
    ["S1-4-420", 600, 630],
  ]);
  const hyehwaWeekday = (up: TimetableTrain[], stations = ["S1-4-416", "S1-4-417", "S1-4-418", "S1-4-419", "S1-4-420", "S1-4-421", "S1-4-422", "S1-4-423", "S1-4-424"]): Timetable =>
    table({ source: { kind: "seoul-station", ref: "test", revision: "2026-10-01" }, operator: "S1", line: "4", stations, trains: [...up, DOWN] });
  // WHY: the run from S1-4-418 to S1-4-419 lasts `gapSec`, every other run 90 to 100 s, and the train is in view 400 s plus the gap.
  const withRunOf = (gapSec: number): TimetableTrain =>
    train("4001", "up", [
      ["S1-4-416", 0, 30],
      ["S1-4-417", 120, 150],
      ["S1-4-418", 240, 270],
      ["S1-4-419", 270 + gapSec, 300 + gapSec],
      ["S1-4-420", 400 + gapSec, 430 + gapSec],
    ]);
  // WHY: a train that starts at S1-4-418 and reaches S1-4-420 `viewSec` after its first arrival.
  const inViewFor = (viewSec: number): TimetableTrain =>
    train("4002", "up", [
      ["S1-4-418", 1000, 1030],
      ["S1-4-419", 1000 + viewSec / 2, 1030 + viewSec / 2],
      ["S1-4-420", 1000 + viewSec, 1030 + viewSec],
    ]);

  it("returns none for the stored tables of the subway-timetables fixture", () => {
    // Act
    const issues = toTrackedStopIssues(subwayTimetablesFixture(), listSubwayPlatforms());

    // Assert
    expect(issues).toEqual([]);
  });

  it.each([
    [599, 0],
    [600, 0],
    [601, 1],
  ])("warns of a %i s run between two tracked stops: %i issue(s)", (gapSec, count) => {
    // Act
    const issues = toTrackedStopIssues([hyehwaWeekday([withRunOf(gapSec)])], [HYEHWA]);

    // Assert
    expect(issues).toHaveLength(count);
  });

  it("names the table, the platform, the direction and the train of a long run", () => {
    // Act
    const issues = toTrackedStopIssues([hyehwaWeekday([withRunOf(700)])], [HYEHWA]);

    // Assert
    expect(issues).toEqual([{ path: ["S1-4-weekday", "S1-4-420", "up"], message: "1 train(s) run over 600 s between two tracked stops: 4001 S1-4-418→S1-4-419 700 s" }]);
  });

  it.each([
    [599, 1],
    [600, 0],
    [601, 0],
  ])("warns of a train in view %i s before the platform: %i issue(s)", (viewSec, count) => {
    // Act
    const issues = toTrackedStopIssues([hyehwaWeekday([inViewFor(viewSec)])], [HYEHWA]);

    // Assert
    expect(issues).toHaveLength(count);
  });

  it("names the train and where it comes into view when it is in view too briefly", () => {
    // Act
    const issues = toTrackedStopIssues([hyehwaWeekday([inViewFor(420)])], [HYEHWA]);

    // Assert
    expect(issues).toEqual([{ path: ["S1-4-weekday", "S1-4-420", "up"], message: "1 train(s) in view under 600 s before it: 4002 from S1-4-418 420 s" }]);
  });

  it("warns of a station of the line skipped between two tracked stops, naming both", () => {
    // Arrange
    const stations = ["S1-4-416", "S1-4-417", "S1-4-419", "S1-4-420", "S1-4-421", "S1-4-422", "S1-4-423", "S1-4-424"];
    const up = train("4003", "up", [
      ["S1-4-416", 0, 30],
      ["S1-4-417", 150, 180],
      ["S1-4-419", 400, 430],
      ["S1-4-420", 650, 680],
    ]);

    // Act
    const issues = toTrackedStopIssues([hyehwaWeekday([up], stations)], [HYEHWA]);

    // Assert
    expect(issues).toEqual([{ path: ["S1-4-weekday", "S1-4-420", "up"], message: "the tracked stops skip a station between S1-4-417 and S1-4-419" }]);
  });

  it("checks a table only at the platforms it serves on its day type", () => {
    // Act
    const issues = toTrackedStopIssues([hyehwaWeekday([withRunOf(700)])], [SUNGKYUNKWAN]);

    // Assert
    expect(issues).toEqual([]);
  });
});

describe("isInServiceWindow", () => {
  it.each([
    ["04:59:59 Friday, a minute before the first trains", "weekday", "2026-10-16", "2026-10-15T19:59:59Z", false],
    ["05:00:00 Friday", "weekday", "2026-10-16", "2026-10-15T20:00:00Z", true],
    ["01:09:59 after a Friday", "weekday", "2026-10-16", "2026-10-16T16:09:59Z", true],
    ["01:10:00 after a Friday", "weekday", "2026-10-16", "2026-10-16T16:10:00Z", false],
    ["05:00:00 Saturday", "saturday", "2026-10-17", "2026-10-16T20:00:00Z", true],
    ["00:29:59 after a Saturday", "saturday", "2026-10-17", "2026-10-17T15:29:59Z", true],
    ["00:30:00 after a Saturday", "saturday", "2026-10-17", "2026-10-17T15:30:00Z", false],
    ["00:30:00 after a holiday", "holiday", "2026-10-18", "2026-10-18T15:30:00Z", false],
    ["03:00:00, the night", "weekday", "2026-10-16", "2026-10-16T18:00:00Z", false],
  ] as const)("reads %s as %s inside the window: %s", (_label, dayType, serviceDate, iso, inside) => {
    // Act
    const isInside = isInServiceWindow(dayType, serviceDate, new Date(iso));

    // Assert
    expect(isInside).toBe(inside);
  });
});

describe("toServiceWindowIssues", () => {
  const hyehwa = (dayType: "weekday" | "saturday" | "holiday", arr: number | null, dep: number | null, station = "S1-4-420"): Timetable =>
    table({
      source: { kind: "seoul-station", ref: "test", revision: "2026-10-01" },
      operator: "S1",
      line: "4",
      dayType,
      stations: ["S1-4-419", "S1-4-420", "S1-4-421"],
      trains: [{ trainNo: "4001", direction: "up", destination: "test", express: false, stops: [{ station, arr, dep }] }],
    });

  it("returns none for the stored tables of the subway-timetables fixture", () => {
    // Act
    const issues = toServiceWindowIssues(subwayTimetablesFixture(), listSubwayPlatforms());

    // Assert
    expect(issues).toEqual([]);
  });

  it.each([
    ["weekday", 17999, 1],
    ["weekday", 18000, 0],
    ["weekday", 18001, 0],
    ["weekday", 90599, 0],
    ["weekday", 90600, 1],
    ["weekday", 90601, 1],
    ["saturday", 17999, 1],
    ["saturday", 18000, 0],
    ["saturday", 88199, 0],
    ["saturday", 88200, 1],
    ["saturday", 88201, 1],
    ["holiday", 17999, 1],
    ["holiday", 18000, 0],
    ["holiday", 88199, 0],
    ["holiday", 88200, 1],
    ["holiday", 88201, 1],
  ] as const)("refuses a %s arrival at %i s: %i issue(s)", (dayType, seconds, count) => {
    // Act
    const issues = toServiceWindowIssues([hyehwa(dayType, seconds, null)], [HYEHWA]);

    // Assert
    expect(issues).toHaveLength(count);
  });

  it.each([
    [17999, 1],
    [18000, 0],
  ])("checks a departure too: %i s, %i issue(s)", (seconds, count) => {
    // Act
    const issues = toServiceWindowIssues([hyehwa("weekday", null, seconds)], [HYEHWA]);

    // Assert
    expect(issues).toHaveLength(count);
  });

  it("names the table, the platform, the train and its time", () => {
    // Act
    const issues = toServiceWindowIssues([hyehwa("weekday", 17940, 17970)], [HYEHWA]);

    // Assert
    expect(issues).toEqual([{ path: ["S1-4-weekday", "S1-4-420"], message: "2 stop time(s) outside the service window: 4001 17940 s, 4001 17970 s" }]);
  });

  it("ignores a stop at a station that is not the served platform", () => {
    // Act
    const issues = toServiceWindowIssues([hyehwa("weekday", 1000, 1030, "S1-4-419")], [HYEHWA]);

    // Assert
    expect(issues).toEqual([]);
  });

  it("checks a table only at the platforms it serves on its day type", () => {
    // Act
    const issues = toServiceWindowIssues([hyehwa("weekday", 1000, 1030)], [SUNGKYUNKWAN]);

    // Assert
    expect(issues).toEqual([]);
  });

  it("ignores a table of another operator that holds a stop at the platform's station", () => {
    // Arrange
    // WHY: the stop matches the platform's id, so only the table-key match keeps this table off the platform.
    const korailLine4 = table({
      operator: "KR",
      line: "4",
      stations: ["S1-4-419", "S1-4-420", "S1-4-421"],
      trains: [{ trainNo: "4001", direction: "up", destination: "test", express: false, stops: [{ station: "S1-4-420", arr: 1000, dep: 1030 }] }],
    });

    // Act
    const issues = toServiceWindowIssues([korailLine4], [HYEHWA]);

    // Assert
    expect(issues).toEqual([]);
  });
});

describe("listSubwayPlatforms", () => {
  it("lists every platform in the registry's station order", () => {
    // Act
    const platforms = listSubwayPlatforms();

    // Assert
    expect(platforms.map((platform) => [platform.id, platform.line])).toEqual([
      ["KR-1-P153", "1"],
      ["S1-4-420", "4"],
      ["DX-D1-4312", "D1"],
      ["KR-K1-K230", "K1"],
      ["S1-2-216", "2"],
      ["S1-8-2815", "8"],
      ["S1-3-334", "3"],
      ["KR-K1-K217", "K1"],
      ["S1-2-222", "2"],
      ["DX-D1-4307", "D1"],
      ["S1-3-332", "3"],
      ["DX-D1-4308", "D1"],
      ["DX-D1-4318", "D1"],
      ["S1-2-226", "2"],
      ["S1-4-433", "4"],
      ["KR-1-P149", "1"],
      ["KR-4-443", "4"],
      ["S1-1-154", "1"],
      ["DX-D1-D13", "D1"],
      ["KR-K1-K231", "K1"],
      ["S1-8-2821", "8"],
      ["KR-K1-K222", "K1"],
      ["S1-3-340", "3"],
      ["S1-8-2818", "8"],
      ["S1-8-2817", "8"],
    ]);
  });
});

describe("revision 2 of subway-topology at each served platform", () => {
  it.each([
    ["KR-1-P153", "up", ["KR-1-P154", "KR-1-P155", "KR-1-1715"]],
    ["KR-1-P153", "down", ["KR-1-P152", "KR-1-P151", "KR-1-P150"]],
    ["S1-4-420", "up", ["S1-4-421", "S1-4-422", "S1-4-423"]],
    ["S1-4-420", "down", ["S1-4-419", "S1-4-418", "S1-4-417"]],
    ["S1-2-216", "up", ["S1-2-215", "S1-2-214", "S1-2-213"]],
    ["S1-2-216", "down", ["S1-2-217", "S1-2-218", "S1-2-219"]],
    ["S1-3-334", "up", ["S1-3-335", "S1-3-336", "S1-3-337"]],
    ["S1-3-334", "down", ["S1-3-333", "S1-3-332", "S1-3-331"]],
    ["S1-2-222", "up", ["S1-2-221", "S1-2-220", "S1-2-219"]],
    ["S1-2-222", "down", ["S1-2-223", "S1-2-224", "S1-2-225"]],
    ["S1-3-332", "up", ["S1-3-333", "S1-3-334", "S1-3-335"]],
    ["S1-3-332", "down", ["S1-3-331", "S1-3-330", "S1-3-329"]],
    ["KR-K1-K230", "up", ["KR-K1-K231", "KR-K1-K232", "KR-K1-K233"]],
    ["KR-K1-K230", "down", ["KR-K1-K229", "KR-K1-K228", "KR-K1-K227"]],
    ["S1-8-2815", "up", ["S1-8-2816", "S1-8-2817", "S1-8-2818"]],
    ["S1-8-2815", "down", ["S1-8-2814", "S1-8-2813", "S1-8-2812"]],
    ["KR-K1-K217", "up", ["KR-K1-K218", "KR-K1-K219", "KR-K1-K220"]],
    ["KR-K1-K217", "down", ["KR-K1-K216", "KR-K1-K215", "KR-K1-K214"]],
    ["DX-D1-4312", "up", ["DX-D1-D13", "DX-D1-D14", "DX-D1-D15"]],
    ["DX-D1-4312", "down", ["DX-D1-4311", "DX-D1-4310", "DX-D1-4309"]],
    ["DX-D1-4307", "up", ["DX-D1-4308", "DX-D1-4309", "DX-D1-4310"]],
    ["DX-D1-4307", "down", ["DX-D1-4306", "DX-D1-4305", "DX-D1-D04"]],
    ["DX-D1-4308", "up", ["DX-D1-4309", "DX-D1-4310", "DX-D1-4311"]],
    ["DX-D1-4308", "down", ["DX-D1-4307", "DX-D1-4306", "DX-D1-4305"]],
    ["DX-D1-4318", "up", ["DX-D1-4319"]],
    ["DX-D1-4318", "down", ["DX-D1-4317", "DX-D1-4316", "DX-D1-D15"]],
    ["S1-2-226", "up", ["S1-2-225", "S1-2-224", "S1-2-223"]],
    ["S1-2-226", "down", ["S1-2-227", "S1-2-228", "S1-2-229"]],
    ["S1-4-433", "up", ["S1-4-434", "KR-4-435", "KR-4-436"]],
    ["S1-4-433", "down", ["S1-4-432", "S1-4-431", "S1-4-430"]],
    ["KR-1-P149", "up", ["KR-1-P150", "KR-1-P151", "KR-1-P152"]],
    ["KR-1-P149", "down", ["KR-1-P148", "KR-1-P147", "KR-1-P146"]],
    ["KR-4-443", "up", ["KR-4-444", "KR-4-445", "KR-4-446"]],
    ["KR-4-443", "down", ["KR-4-442", "KR-4-441", "KR-4-440"]],
    ["S1-1-154", "up", ["S1-1-153", "S1-1-152", "S1-1-151"]],
    ["S1-1-154", "down", ["S1-1-155", "S1-1-159", "S1-1-156"]],
    ["DX-D1-D13", "up", ["DX-D1-D14", "DX-D1-D15", "DX-D1-4316"]],
    ["DX-D1-D13", "down", ["DX-D1-4312", "DX-D1-4311", "DX-D1-4310"]],
    ["KR-K1-K231", "up", ["KR-K1-K232", "KR-K1-K233", "KR-K1-K234"]],
    ["KR-K1-K231", "down", ["KR-K1-K230", "KR-K1-K229", "KR-K1-K228"]],
    ["S1-8-2821", "up", ["S1-8-2828", "S1-8-2822", "S1-8-2823"]],
    ["S1-8-2821", "down", ["S1-8-2820", "S1-8-2819", "S1-8-2818"]],
    ["KR-K1-K222", "up", ["KR-K1-K223", "KR-K1-K224", "KR-K1-K225"]],
    ["KR-K1-K222", "down", ["KR-K1-K221", "KR-K1-K220", "KR-K1-K219"]],
    ["S1-3-340", "up", ["S1-3-341", "S1-3-342"]],
    ["S1-3-340", "down", ["S1-3-339", "S1-3-338", "S1-3-337"]],
    ["S1-8-2818", "up", ["S1-8-2819", "S1-8-2820", "S1-8-2821"]],
    ["S1-8-2818", "down", ["S1-8-2817", "S1-8-2816", "S1-8-2815"]],
    ["S1-8-2817", "up", ["S1-8-2818", "S1-8-2819", "S1-8-2820"]],
    ["S1-8-2817", "down", ["S1-8-2816", "S1-8-2815", "S1-8-2814"]],
  ] as const)("lists the upstream platforms of %s %s nearest first", (id, direction, upstreamPlatformIds) => {
    // Act
    const directions = TOPOLOGY.platforms[id];

    // Assert
    expect(directions?.[direction].upstreamPlatformIds).toEqual(upstreamPlatformIds);
  });

  it.each([
    ["KR-1-P153", "up", ["KR-1-P157"]],
    ["KR-1-P153", "down", ["KR-1-P149", "KR-1-P148", "KR-1-P147", "KR-1-P146", "KR-1-P145", "KR-1-P144", "KR-1-P143", "KR-1-P142", "KR-1-141", "KR-1-140", "KR-1-139", "KR-1-138", "KR-1-137", "KR-1-136", "KR-1-135", "KR-1-134", "S1-1-150", "S1-1-151", "S1-1-152", "S1-1-153", "S1-1-154", "S1-1-155", "S1-1-159", "S1-1-156", "S1-1-157", "S1-1-158", "KR-1-123"]],
    ["S1-4-420", "up", ["S1-4-424", "S1-4-425", "S1-4-426", "S1-4-427", "S1-4-428", "S1-4-429", "S1-4-430", "S1-4-431", "S1-4-432", "S1-4-433", "S1-4-434", "KR-4-435", "KR-4-436", "KR-4-437", "KR-4-438", "KR-4-439", "KR-4-440", "KR-4-441", "KR-4-442", "KR-4-443", "KR-4-444", "KR-4-445", "KR-4-446", "KR-4-447", "KR-4-448"]],
    ["S1-4-420", "down", ["S1-4-416", "S1-4-415", "S1-4-414"]],
    ["S1-2-216", "up", ["S1-2-212"]],
    ["S1-2-216", "down", ["S1-2-220", "S1-2-221", "S1-2-222", "S1-2-223", "S1-2-224", "S1-2-225", "S1-2-226", "S1-2-227", "S1-2-228", "S1-2-229", "S1-2-230", "S1-2-231", "S1-2-232"]],
    ["S1-3-334", "up", ["S1-3-338", "S1-3-339", "S1-3-340", "S1-3-341", "S1-3-342"]],
    ["S1-3-334", "down", ["S1-3-330", "S1-3-329", "S1-3-328", "S1-3-327", "S1-3-326"]],
    ["S1-2-222", "up", ["S1-2-218", "S1-2-217", "S1-2-216", "S1-2-215", "S1-2-214", "S1-2-213", "S1-2-212"]],
    ["S1-2-222", "down", ["S1-2-226", "S1-2-227", "S1-2-228", "S1-2-229", "S1-2-230", "S1-2-231", "S1-2-232"]],
    ["S1-3-332", "up", ["S1-3-336", "S1-3-337", "S1-3-338", "S1-3-339", "S1-3-340", "S1-3-341", "S1-3-342"]],
    ["S1-3-332", "down", ["S1-3-328", "S1-3-327", "S1-3-326"]],
    ["KR-K1-K230", "up", ["KR-K1-K234", "KR-K1-K235", "KR-K1-K236", "KR-K1-K237"]],
    ["KR-K1-K230", "down", ["KR-K1-K226", "KR-K1-K225", "KR-K1-K224", "KR-K1-K223", "KR-K1-K222", "KR-K1-K221", "KR-K1-K220", "KR-K1-K219", "KR-K1-K218", "KR-K1-K217", "KR-K1-K216", "KR-K1-K215", "KR-K1-K214", "KR-K1-K213", "KR-K1-K212", "KR-K1-K211", "KR-K1-K210"]],
    ["S1-8-2815", "up", ["S1-8-2819", "S1-8-2820", "S1-8-2821", "S1-8-2828", "S1-8-2822", "S1-8-2823", "S1-8-2824", "S1-8-2825", "S1-8-2826", "S1-8-2827"]],
    ["S1-8-2815", "down", ["S1-8-2811", "S1-8-2809", "GU-8-2808"]],
    ["KR-K1-K217", "up", ["KR-K1-K221", "KR-K1-K222", "KR-K1-K223", "KR-K1-K224", "KR-K1-K225", "KR-K1-K226", "KR-K1-K227", "KR-K1-K228", "KR-K1-K229", "KR-K1-K230", "KR-K1-K231", "KR-K1-K232", "KR-K1-K233", "KR-K1-K234", "KR-K1-K235", "KR-K1-K236", "KR-K1-K237"]],
    ["KR-K1-K217", "down", ["KR-K1-K213", "KR-K1-K212", "KR-K1-K211", "KR-K1-K210"]],
    ["DX-D1-4312", "up", ["DX-D1-4316", "DX-D1-4317", "DX-D1-4318", "DX-D1-4319"]],
    ["DX-D1-4312", "down", ["DX-D1-4308", "DX-D1-4307", "DX-D1-4306", "DX-D1-4305", "DX-D1-D04"]],
    ["DX-D1-4307", "up", ["DX-D1-4311", "DX-D1-4312", "DX-D1-D13", "DX-D1-D14", "DX-D1-D15", "DX-D1-4316", "DX-D1-4317", "DX-D1-4318", "DX-D1-4319"]],
    ["DX-D1-4307", "down", []],
    ["DX-D1-4308", "up", ["DX-D1-4312", "DX-D1-D13", "DX-D1-D14", "DX-D1-D15", "DX-D1-4316", "DX-D1-4317", "DX-D1-4318", "DX-D1-4319"]],
    ["DX-D1-4308", "down", ["DX-D1-D04"]],
    ["DX-D1-4318", "up", []],
    ["DX-D1-4318", "down", ["DX-D1-D14", "DX-D1-D13", "DX-D1-4312", "DX-D1-4311", "DX-D1-4310", "DX-D1-4309", "DX-D1-4308", "DX-D1-4307", "DX-D1-4306", "DX-D1-4305", "DX-D1-D04"]],
    ["S1-2-226", "up", ["S1-2-222", "S1-2-221", "S1-2-220", "S1-2-219", "S1-2-218", "S1-2-217", "S1-2-216", "S1-2-215", "S1-2-214", "S1-2-213", "S1-2-212"]],
    ["S1-2-226", "down", ["S1-2-230", "S1-2-231", "S1-2-232"]],
    ["S1-4-433", "up", ["KR-4-437", "KR-4-438", "KR-4-439", "KR-4-440", "KR-4-441", "KR-4-442", "KR-4-443", "KR-4-444", "KR-4-445", "KR-4-446", "KR-4-447", "KR-4-448"]],
    ["S1-4-433", "down", ["S1-4-429", "S1-4-428", "S1-4-427", "S1-4-426", "S1-4-425", "S1-4-424", "S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420", "S1-4-419", "S1-4-418", "S1-4-417", "S1-4-416", "S1-4-415", "S1-4-414"]],
    ["KR-1-P149", "up", ["KR-1-P153", "KR-1-P154", "KR-1-P155", "KR-1-1715", "KR-1-P157"]],
    ["KR-1-P149", "down", ["KR-1-P145", "KR-1-P144", "KR-1-P143", "KR-1-P142", "KR-1-141", "KR-1-140", "KR-1-139", "KR-1-138", "KR-1-137", "KR-1-136", "KR-1-135", "KR-1-134", "S1-1-150", "S1-1-151", "S1-1-152", "S1-1-153", "S1-1-154", "S1-1-155", "S1-1-159", "S1-1-156", "S1-1-157", "S1-1-158", "KR-1-123"]],
    ["KR-4-443", "up", ["KR-4-447", "KR-4-448"]],
    ["KR-4-443", "down", ["KR-4-439", "KR-4-438", "KR-4-437", "KR-4-436", "KR-4-435", "S1-4-434", "S1-4-433", "S1-4-432", "S1-4-431", "S1-4-430", "S1-4-429", "S1-4-428", "S1-4-427", "S1-4-426", "S1-4-425", "S1-4-424", "S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420", "S1-4-419", "S1-4-418", "S1-4-417", "S1-4-416", "S1-4-415", "S1-4-414"]],
    ["S1-1-154", "up", ["S1-1-150", "KR-1-134", "KR-1-135", "KR-1-136", "KR-1-137", "KR-1-138", "KR-1-139", "KR-1-140", "KR-1-141", "KR-1-P142", "KR-1-P143", "KR-1-P144", "KR-1-P145", "KR-1-P146", "KR-1-P147", "KR-1-P148", "KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-P153", "KR-1-P154", "KR-1-P155", "KR-1-1715", "KR-1-P157"]],
    ["S1-1-154", "down", ["S1-1-157", "S1-1-158", "KR-1-123"]],
    ["DX-D1-D13", "up", ["DX-D1-4317", "DX-D1-4318", "DX-D1-4319"]],
    ["DX-D1-D13", "down", ["DX-D1-4309", "DX-D1-4308", "DX-D1-4307", "DX-D1-4306", "DX-D1-4305", "DX-D1-D04"]],
    ["KR-K1-K231", "up", ["KR-K1-K235", "KR-K1-K236", "KR-K1-K237"]],
    ["KR-K1-K231", "down", ["KR-K1-K227", "KR-K1-K226", "KR-K1-K225", "KR-K1-K224", "KR-K1-K223", "KR-K1-K222", "KR-K1-K221", "KR-K1-K220", "KR-K1-K219", "KR-K1-K218", "KR-K1-K217", "KR-K1-K216", "KR-K1-K215", "KR-K1-K214", "KR-K1-K213", "KR-K1-K212", "KR-K1-K211", "KR-K1-K210"]],
    ["S1-8-2821", "up", ["S1-8-2824", "S1-8-2825", "S1-8-2826", "S1-8-2827"]],
    ["S1-8-2821", "down", ["S1-8-2817", "S1-8-2816", "S1-8-2815", "S1-8-2814", "S1-8-2813", "S1-8-2812", "S1-8-2811", "S1-8-2809", "GU-8-2808"]],
    ["KR-K1-K222", "up", ["KR-K1-K226", "KR-K1-K227", "KR-K1-K228", "KR-K1-K229", "KR-K1-K230", "KR-K1-K231", "KR-K1-K232", "KR-K1-K233", "KR-K1-K234", "KR-K1-K235", "KR-K1-K236", "KR-K1-K237"]],
    ["KR-K1-K222", "down", ["KR-K1-K218", "KR-K1-K217", "KR-K1-K216", "KR-K1-K215", "KR-K1-K214", "KR-K1-K213", "KR-K1-K212", "KR-K1-K211", "KR-K1-K210"]],
    ["S1-3-340", "up", []],
    ["S1-3-340", "down", ["S1-3-336", "S1-3-335", "S1-3-334", "S1-3-333", "S1-3-332", "S1-3-331", "S1-3-330", "S1-3-329", "S1-3-328", "S1-3-327", "S1-3-326"]],
    ["S1-8-2818", "up", ["S1-8-2828", "S1-8-2822", "S1-8-2823", "S1-8-2824", "S1-8-2825", "S1-8-2826", "S1-8-2827"]],
    ["S1-8-2818", "down", ["S1-8-2814", "S1-8-2813", "S1-8-2812", "S1-8-2811", "S1-8-2809", "GU-8-2808"]],
    ["S1-8-2817", "up", ["S1-8-2821", "S1-8-2828", "S1-8-2822", "S1-8-2823", "S1-8-2824", "S1-8-2825", "S1-8-2826", "S1-8-2827"]],
    ["S1-8-2817", "down", ["S1-8-2813", "S1-8-2812", "S1-8-2811", "S1-8-2809", "GU-8-2808"]],
  ] as const)("lists the watched platforms of %s %s, beyond its upstream ones, nearest first", (id, direction, watchedPlatformIds) => {
    // Act
    const directions = TOPOLOGY.platforms[id];

    // Assert
    expect(directions?.[direction].watchedPlatformIds).toEqual(watchedPlatformIds);
  });

  it.each([
    ["KR-1-P153", "up", "KR-1-P152"],
    ["KR-1-P153", "down", "KR-1-P154"],
    ["S1-4-420", "up", "S1-4-419"],
    ["S1-4-420", "down", "S1-4-421"],
    ["S1-2-216", "up", "S1-2-217"],
    ["S1-2-216", "down", "S1-2-215"],
    ["S1-3-334", "up", "S1-3-333"],
    ["S1-3-334", "down", "S1-3-335"],
    ["S1-2-222", "up", "S1-2-223"],
    ["S1-2-222", "down", "S1-2-221"],
    ["S1-3-332", "up", "S1-3-331"],
    ["S1-3-332", "down", "S1-3-333"],
    ["KR-K1-K230", "up", "KR-K1-K229"],
    ["KR-K1-K230", "down", "KR-K1-K231"],
    ["S1-8-2815", "up", "S1-8-2814"],
    ["S1-8-2815", "down", "S1-8-2816"],
    ["KR-K1-K217", "up", "KR-K1-K216"],
    ["KR-K1-K217", "down", "KR-K1-K218"],
    ["DX-D1-4312", "up", "DX-D1-4311"],
    ["DX-D1-4312", "down", "DX-D1-D13"],
    ["DX-D1-4307", "up", "DX-D1-4306"],
    ["DX-D1-4307", "down", "DX-D1-4308"],
    ["DX-D1-4308", "up", "DX-D1-4307"],
    ["DX-D1-4308", "down", "DX-D1-4309"],
    ["DX-D1-4318", "up", "DX-D1-4317"],
    ["DX-D1-4318", "down", "DX-D1-4319"],
    ["S1-2-226", "up", "S1-2-227"],
    ["S1-2-226", "down", "S1-2-225"],
    ["S1-4-433", "up", "S1-4-432"],
    ["S1-4-433", "down", "S1-4-434"],
    ["KR-1-P149", "up", "KR-1-P148"],
    ["KR-1-P149", "down", "KR-1-P150"],
    ["KR-4-443", "up", "KR-4-442"],
    ["KR-4-443", "down", "KR-4-444"],
    ["S1-1-154", "up", "S1-1-155"],
    ["S1-1-154", "down", "S1-1-153"],
    ["DX-D1-D13", "up", "DX-D1-4312"],
    ["DX-D1-D13", "down", "DX-D1-D14"],
    ["KR-K1-K231", "up", "KR-K1-K230"],
    ["KR-K1-K231", "down", "KR-K1-K232"],
    ["S1-8-2821", "up", "S1-8-2820"],
    ["S1-8-2821", "down", "S1-8-2828"],
    ["KR-K1-K222", "up", "KR-K1-K221"],
    ["KR-K1-K222", "down", "KR-K1-K223"],
    ["S1-3-340", "up", "S1-3-339"],
    ["S1-3-340", "down", "S1-3-341"],
    ["S1-8-2818", "up", "S1-8-2817"],
    ["S1-8-2818", "down", "S1-8-2819"],
    ["S1-8-2817", "up", "S1-8-2816"],
    ["S1-8-2817", "down", "S1-8-2818"],
  ] as const)("names the next platform of %s %s", (id, direction, nextPlatformId) => {
    // Act
    const directions = TOPOLOGY.platforms[id];

    // Assert
    expect(directions?.[direction].nextPlatformId).toBe(nextPlatformId);
  });

  it.each([
    ["KR-1-P153", { ko: "서울 방면", en: "Toward Seoul", zh: "首尔方向" }, { ko: "천안·서동탄 방면", en: "Toward Cheonan / Seodongtan", zh: "天安·西东滩方向" }],
    ["S1-4-420", { ko: "불암산·진접 방면", en: "Toward Buramsan / Jinjeop", zh: "佛岩山·榛接方向" }, { ko: "오이도·안산 방면", en: "Toward Oido / Ansan", zh: "乌耳岛·安山方向" }],
    ["S1-2-216", { ko: "내선순환", en: "Inner circle", zh: "内环" }, { ko: "외선순환", en: "Outer circle", zh: "外环" }],
    ["S1-2-222", { ko: "내선순환", en: "Inner circle", zh: "内环" }, { ko: "외선순환", en: "Outer circle", zh: "外环" }],
    ["S1-3-334", { ko: "대화 방면", en: "Toward Daehwa", zh: "大化方向" }, { ko: "오금 방면", en: "Toward Ogeum", zh: "梧琴方向" }],
    ["S1-3-332", { ko: "대화 방면", en: "Toward Daehwa", zh: "大化方向" }, { ko: "오금 방면", en: "Toward Ogeum", zh: "梧琴方向" }],
    ["KR-K1-K230", { ko: "청량리 방면", en: "Toward Cheongnyangni", zh: "清凉里方向" }, { ko: "인천 방면", en: "Toward Incheon", zh: "仁川方向" }],
    ["S1-8-2815", { ko: "별내 방면", en: "Toward Byeollae", zh: "别内方向" }, { ko: "모란 방면", en: "Toward Moran", zh: "牡丹方向" }],
    ["KR-K1-K217", { ko: "청량리 방면", en: "Toward Cheongnyangni", zh: "清凉里方向" }, { ko: "인천 방면", en: "Toward Incheon", zh: "仁川方向" }],
    ["DX-D1-4312", { ko: "신사 방면", en: "Toward Sinsa", zh: "新沙方向" }, { ko: "광교 방면", en: "Toward Gwanggyo", zh: "光教方向" }],
    ["DX-D1-4307", { ko: "신사 방면", en: "Toward Sinsa", zh: "新沙方向" }, { ko: "광교 방면", en: "Toward Gwanggyo", zh: "光教方向" }],
    ["DX-D1-4308", { ko: "신사 방면", en: "Toward Sinsa", zh: "新沙方向" }, { ko: "광교 방면", en: "Toward Gwanggyo", zh: "光教方向" }],
    ["DX-D1-4318", { ko: "신사 방면", en: "Toward Sinsa", zh: "新沙方向" }, { ko: "광교 방면", en: "Toward Gwanggyo", zh: "光教方向" }],
    ["S1-2-226", { ko: "내선순환", en: "Inner circle", zh: "内环" }, { ko: "외선순환", en: "Outer circle", zh: "外环" }],
    ["S1-4-433", { ko: "불암산·진접 방면", en: "Toward Buramsan / Jinjeop", zh: "佛岩山·榛接方向" }, { ko: "오이도·안산 방면", en: "Toward Oido / Ansan", zh: "乌耳岛·安山方向" }],
    ["KR-1-P149", { ko: "서울 방면", en: "Toward Seoul", zh: "首尔方向" }, { ko: "천안·서동탄 방면", en: "Toward Cheonan / Seodongtan", zh: "天安·西东滩方向" }],
    ["KR-4-443", { ko: "불암산·진접 방면", en: "Toward Buramsan / Jinjeop", zh: "佛岩山·榛接方向" }, { ko: "오이도·안산 방면", en: "Toward Oido / Ansan", zh: "乌耳岛·安山方向" }],
    ["S1-1-154", { ko: "소요산·광운대 방면", en: "Toward Soyosan / Kwangwoon Univ.", zh: "逍遥山·光云大方向" }, { ko: "인천·신창 방면", en: "Toward Incheon / Sinchang", zh: "仁川·新昌方向" }],
    ["DX-D1-D13", { ko: "신사 방면", en: "Toward Sinsa", zh: "新沙方向" }, { ko: "광교 방면", en: "Toward Gwanggyo", zh: "光教方向" }],
    ["KR-K1-K231", { ko: "청량리 방면", en: "Toward Cheongnyangni", zh: "清凉里方向" }, { ko: "인천 방면", en: "Toward Incheon", zh: "仁川方向" }],
    ["S1-8-2821", { ko: "별내 방면", en: "Toward Byeollae", zh: "别内方向" }, { ko: "모란 방면", en: "Toward Moran", zh: "牡丹方向" }],
    ["KR-K1-K222", { ko: "청량리 방면", en: "Toward Cheongnyangni", zh: "清凉里方向" }, { ko: "인천 방면", en: "Toward Incheon", zh: "仁川方向" }],
    ["S1-3-340", { ko: "대화 방면", en: "Toward Daehwa", zh: "大化方向" }, { ko: "오금 방면", en: "Toward Ogeum", zh: "梧琴方向" }],
    ["S1-8-2818", { ko: "별내 방면", en: "Toward Byeollae", zh: "别内方向" }, { ko: "모란 방면", en: "Toward Moran", zh: "牡丹方向" }],
    ["S1-8-2817", { ko: "별내 방면", en: "Toward Byeollae", zh: "别内方向" }, { ko: "모란 방면", en: "Toward Moran", zh: "牡丹方向" }],
  ])("names %s's directions in every language", (id, upName, downName) => {
    // Act
    const directions = TOPOLOGY.platforms[id];

    // Assert
    expect(directions?.up.name).toEqual(upName);
    expect(directions?.down.name).toEqual(downName);
  });
});

describe("findSubwayPlatform", () => {
  it.each([
    ["KR-1-P153", "1", { source: "korail" }],
    ["S1-4-420", "4", { source: "seoul-station", stationCode: "0420" }],
    ["S1-2-216", "2", { source: "seoul-station", stationCode: "0216" }],
    ["S1-3-334", "3", { source: "seoul-station", stationCode: "0334" }],
    ["S1-2-222", "2", { source: "seoul-station", stationCode: "0222" }],
    ["S1-3-332", "3", { source: "seoul-station", stationCode: "0332" }],
    ["KR-K1-K230", "K1", { source: "korail" }],
    ["S1-8-2815", "8", { source: "seoul-station", stationCode: "2815" }],
    ["KR-K1-K217", "K1", { source: "korail" }],
    ["DX-D1-4312", "D1", { source: "shinbundang" }],
    ["DX-D1-4307", "D1", { source: "shinbundang" }],
    ["DX-D1-4308", "D1", { source: "shinbundang" }],
    ["DX-D1-4318", "D1", { source: "shinbundang" }],
    ["S1-2-226", "2", { source: "seoul-station", stationCode: "0226" }],
    ["S1-4-433", "4", { source: "seoul-station", stationCode: "0433" }],
    ["KR-1-P149", "1", { source: "korail" }],
    ["KR-4-443", "4", { source: "seoul-station", stationCode: "1458" }],
    ["S1-1-154", "1", { source: "korail" }],
    ["DX-D1-D13", "D1", { source: "shinbundang" }],
    ["KR-K1-K231", "K1", { source: "korail" }],
    ["S1-8-2821", "8", { source: "seoul-station", stationCode: "2821" }],
    ["KR-K1-K222", "K1", { source: "korail" }],
    ["S1-3-340", "3", { source: "seoul-station", stationCode: "0340" }],
    ["S1-8-2818", "8", { source: "seoul-station", stationCode: "2818" }],
    ["S1-8-2817", "8", { source: "seoul-station", stationCode: "2817" }],
  ])("puts %s on line %s with its timetable source", (id, line, timetable) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform?.line).toBe(line);
    expect(platform?.timetable).toEqual(timetable);
  });

  it.each(["S1-2-220", "KR-1-P154", "kr-1-0153", "hyehwa", ""])("finds no platform for %j", (id) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform).toBeNull();
  });
});

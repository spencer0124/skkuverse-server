/**
 * The schedule's occurrences and timeline order, in Asia/Seoul wall time whatever the host's zone.
 *
 * toOccurrences expands `rrule + rdate - exdate - gaps` in time order. A plain item is one occurrence, its start and
 * end bounding the whole span; a series repeats its first occurrence on the rule's days through `until`, DTSTART
 * always the first instance even off `byDay` (RFC 5545 section 3.8.5.3). `exdate` drops a series' or an extra's
 * occurrence that starts on the day, and cuts the whole day out of a plain span; `gaps` cut their stretch out of
 * every occurrence and drop a moment inside one. An extra equal to an occurrence counts once. A cut that lands on
 * midnight ends the day before at 24:00, or on that day when the item has no time. The first MAX_SCHEDULE_OCCURRENCES
 * are served and the rest counted, or counted as null for a series with no `until`. An item dated by a range of days
 * (`latest`) is its one occurrence as stored.
 *
 * toTimelineMinute orders items on their end, else their start: a point on its `latest` day, else its date, then its
 * time, 24:00 after 23:59, and a point with no time at the end of its day. A series with an `until` sorts on the end of
 * its last occurrence, extras included; a series with no `until` on the end of its first.
 */
import { MAX_SCHEDULE_OCCURRENCES } from "./notices-schedule.constants";
import { toOccurrences, toTimelineMinute } from "./notices-schedule.rules";
import type { ScheduleItem } from "./notices-schedule.schema";

const item = (extra: Partial<ScheduleItem>): ScheduleItem => ({ id: "0a1b2c3d", title: "스터디", status: "scheduled", evidence: [], ...extra });
const at = (date: string, time?: string) => (time === undefined ? { date } : { date, time });
const span = (start: ReturnType<typeof at>, end?: ReturnType<typeof at>) => (end ? { start, end } : { start });

describe("toOccurrences, an item with no rule", () => {
  it.each([
    ["a timed span", item({ start: at("2026-11-10", "14:00"), end: at("2026-11-10", "16:00") }), [span(at("2026-11-10", "14:00"), at("2026-11-10", "16:00"))]],
    ["a moment", item({ start: at("2026-11-10", "14:00") }), [span(at("2026-11-10", "14:00"))]],
    ["a span of days", item({ start: at("2026-11-02"), end: at("2026-11-06") }), [span(at("2026-11-02"), at("2026-11-06"))]],
    ["a deadline at the end of its day", item({ end: at("2026-11-06", "24:00") }), [{ end: at("2026-11-06", "24:00") }]],
    ["a deadline day", item({ end: at("2026-11-06") }), [{ end: at("2026-11-06") }]],
  ])("serves %s as its one occurrence", (_case, schedule, occurrences) => {
    // Act & Assert
    expect(toOccurrences(schedule)).toEqual({ occurrences, omittedCount: 0 });
  });

  it("serves an item dated by a range of days as stored", () => {
    // Arrange
    const coarse = item({ start: { date: "2026-11-21", latest: "2026-11-30" }, end: { date: "2026-12-21", latest: "2026-12-31" } });

    // Act & Assert
    expect(toOccurrences(coarse)).toEqual({ occurrences: [{ start: { date: "2026-11-21", latest: "2026-11-30" }, end: { date: "2026-12-21", latest: "2026-12-31" } }], omittedCount: 0 });
  });
});

const SERIES: Array<[string, NonNullable<ScheduleItem["rrule"]>, string, string[]]> = [
  ["each byDay day from a start on one of them", { freq: "weekly", byDay: ["WE", "FR"], until: "2026-11-13" }, "2026-11-04", ["2026-11-04", "2026-11-06", "2026-11-11", "2026-11-13"]],
  ["the start first, then each byDay day, from a start on none of them", { freq: "weekly", byDay: ["WE", "FR"], until: "2026-11-13" }, "2026-11-02", ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-11", "2026-11-13"]],
  ["the start's weekday when byDay is absent", { freq: "weekly", until: "2026-11-24" }, "2026-11-03", ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]],
  ["every day through until", { freq: "daily", until: "2026-11-05" }, "2026-11-02", ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]],
  ["only the byDay days of a daily rule", { freq: "daily", byDay: ["SA", "SU"], until: "2026-11-15" }, "2026-11-07", ["2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"]],
  ["nothing past an until the day before a rule day", { freq: "weekly", until: "2026-11-16" }, "2026-11-03", ["2026-11-03", "2026-11-10"]],
  ["the start alone for an until before the next rule day", { freq: "weekly", byDay: ["WE"], until: "2026-11-03" }, "2026-11-02", ["2026-11-02"]],
];

describe("toOccurrences, a series", () => {
  it.each(SERIES)("repeats on %s", (_case, rrule, date, days) => {
    // Arrange
    const series = item({ start: at(date, "19:00"), end: at(date, "21:00"), rrule });

    // Act
    const { occurrences, omittedCount } = toOccurrences(series);

    // Assert
    expect(occurrences).toEqual(days.map((day) => span(at(day, "19:00"), at(day, "21:00"))));
    expect(omittedCount).toBe(0);
  });

  it("keeps each occurrence's length, past midnight and at 24:00", () => {
    // Arrange
    const overnight = item({ start: at("2026-11-04", "22:00"), end: at("2026-11-05", "02:00"), rrule: { freq: "weekly", until: "2026-11-11" } });
    const toMidnight = item({ start: at("2026-11-04", "22:00"), end: at("2026-11-04", "24:00"), rrule: { freq: "daily", until: "2026-11-05" } });

    // Act & Assert
    expect(toOccurrences(overnight).occurrences).toEqual([span(at("2026-11-04", "22:00"), at("2026-11-05", "02:00")), span(at("2026-11-11", "22:00"), at("2026-11-12", "02:00"))]);
    expect(toOccurrences(toMidnight).occurrences).toEqual([span(at("2026-11-04", "22:00"), at("2026-11-04", "24:00")), span(at("2026-11-05", "22:00"), at("2026-11-05", "24:00"))]);
  });

  it("repeats a day-long first occurrence as days", () => {
    // Arrange
    const series = item({ start: at("2026-11-02"), end: at("2026-11-03"), rrule: { freq: "weekly", until: "2026-11-09" } });

    // Act & Assert
    expect(toOccurrences(series).occurrences).toEqual([span(at("2026-11-02"), at("2026-11-03")), span(at("2026-11-09"), at("2026-11-10"))]);
  });
});

describe("toOccurrences, removed days and stretches", () => {
  it("drops a series occurrence that starts on an exdate, a night past midnight included", () => {
    // Arrange
    const series = item({ start: at("2026-11-04", "22:00"), end: at("2026-11-05", "02:00"), rrule: { freq: "weekly", until: "2026-11-18" }, exdate: ["2026-11-11"] });

    // Act & Assert
    expect(toOccurrences(series).occurrences).toEqual([span(at("2026-11-04", "22:00"), at("2026-11-05", "02:00")), span(at("2026-11-18", "22:00"), at("2026-11-19", "02:00"))]);
  });

  it("cuts an exdate out of a plain span of days", () => {
    // Arrange
    const plain = item({ start: at("2026-11-02"), end: at("2026-11-06"), exdate: ["2026-11-04"] });

    // Act & Assert
    expect(toOccurrences(plain).occurrences).toEqual([span(at("2026-11-02"), at("2026-11-03")), span(at("2026-11-05"), at("2026-11-06"))]);
  });

  it("cuts an exdate out of a plain timed span, the first piece ending at 24:00", () => {
    // Arrange
    const plain = item({ start: at("2026-11-09", "09:00"), end: at("2026-11-13", "18:00"), exdate: ["2026-11-11"] });

    // Act & Assert
    expect(toOccurrences(plain).occurrences).toEqual([span(at("2026-11-09", "09:00"), at("2026-11-10", "24:00")), span(at("2026-11-12", "00:00"), at("2026-11-13", "18:00"))]);
  });

  it("cuts a gap out of a plain span and out of the series occurrence it falls in", () => {
    // Arrange
    const plain = item({ start: at("2026-11-09", "09:00"), end: at("2026-11-13", "18:00"), gaps: [{ start: at("2026-11-11", "12:00"), end: at("2026-11-11", "13:00") }] });
    const series = item({ start: at("2026-11-04", "19:00"), end: at("2026-11-04", "21:00"), rrule: { freq: "weekly", until: "2026-11-18" }, gaps: [{ start: at("2026-11-11", "20:00"), end: at("2026-11-11", "21:00") }] });

    // Act & Assert
    expect(toOccurrences(plain).occurrences).toEqual([span(at("2026-11-09", "09:00"), at("2026-11-11", "12:00")), span(at("2026-11-11", "13:00"), at("2026-11-13", "18:00"))]);
    expect(toOccurrences(series).occurrences).toEqual([
      span(at("2026-11-04", "19:00"), at("2026-11-04", "21:00")),
      span(at("2026-11-11", "19:00"), at("2026-11-11", "20:00")),
      span(at("2026-11-18", "19:00"), at("2026-11-18", "21:00")),
    ]);
  });

  it.each([
    ["at the gap's start", "12:00", []],
    ["inside the gap", "12:30", []],
    ["at the gap's end", "13:00", [span(at("2026-11-11", "13:00"))]],
  ])("drops a moment %s only while the gap lasts", (_case, time, occurrences) => {
    // Arrange
    const moment = item({ start: at("2026-11-11", time), gaps: [{ start: at("2026-11-11", "12:00"), end: at("2026-11-11", "13:00") }] });

    // Act & Assert
    expect(toOccurrences(moment).occurrences).toEqual(occurrences);
  });

  it("adds each extra in time order, counts one equal to an occurrence once, and drops one on an exdate", () => {
    // Arrange
    const series = item({
      start: at("2026-11-04", "19:00"),
      end: at("2026-11-04", "21:00"),
      rrule: { freq: "weekly", until: "2026-11-11" },
      rdate: [span(at("2026-11-20", "10:00"), at("2026-11-20", "12:00")), span(at("2026-11-11", "19:00"), at("2026-11-11", "21:00")), span(at("2026-11-07", "14:00")), span(at("2026-11-25", "19:00"), at("2026-11-25", "21:00"))],
      exdate: ["2026-11-25"],
    });

    // Act & Assert
    expect(toOccurrences(series)).toEqual({
      occurrences: [span(at("2026-11-04", "19:00"), at("2026-11-04", "21:00")), span(at("2026-11-07", "14:00")), span(at("2026-11-11", "19:00"), at("2026-11-11", "21:00")), span(at("2026-11-20", "10:00"), at("2026-11-20", "12:00"))],
      omittedCount: 0,
    });
  });
});

describe("toOccurrences, the cap", () => {
  it.each([
    [MAX_SCHEDULE_OCCURRENCES - 1, 0],
    [MAX_SCHEDULE_OCCURRENCES, 0],
    [MAX_SCHEDULE_OCCURRENCES + 1, 1],
    [MAX_SCHEDULE_OCCURRENCES + 9, 9],
  ])("serves the first occurrences of %d days and counts %d left out", (dayCount, omittedCount) => {
    // Arrange
    const until = new Date(Date.UTC(2026, 10, 1 + dayCount - 1)).toISOString().slice(0, 10);
    const series = item({ start: at("2026-11-01", "09:00"), rrule: { freq: "daily", until } });

    // Act
    const expanded = toOccurrences(series);

    // Assert
    expect(expanded.occurrences).toHaveLength(Math.min(dayCount, MAX_SCHEDULE_OCCURRENCES));
    expect(expanded.occurrences[0]).toEqual(span(at("2026-11-01", "09:00")));
    expect(expanded.occurrences.at(-1)).toEqual(span(at(new Date(Date.UTC(2026, 10, Math.min(dayCount, MAX_SCHEDULE_OCCURRENCES))).toISOString().slice(0, 10), "09:00")));
    expect(expanded.omittedCount).toBe(omittedCount);
  });

  it("serves the first occurrences of a series with no until and counts the rest as null", () => {
    // Arrange
    const series = item({ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "10:00"), rrule: { freq: "weekly" }, exdate: ["2026-11-09"] });

    // Act
    const expanded = toOccurrences(series);

    // Assert
    expect(expanded.occurrences).toHaveLength(MAX_SCHEDULE_OCCURRENCES);
    expect(expanded.occurrences.slice(0, 2)).toEqual([span(at("2026-11-02", "09:00"), at("2026-11-02", "10:00")), span(at("2026-11-16", "09:00"), at("2026-11-16", "10:00"))]);
    expect(expanded.omittedCount).toBeNull();
  });
});

describe("toOccurrences, the host's time zone", () => {
  it.each(["UTC", "Asia/Seoul", "America/Los_Angeles", "Pacific/Kiritimati"])("gives the same wall times when the host zone is %s", (zone) => {
    // Arrange
    const series = item({
      start: at("2026-11-04", "22:00"),
      end: at("2026-11-04", "24:00"),
      rrule: { freq: "weekly", byDay: ["WE"], until: "2026-11-18" },
      gaps: [{ start: at("2026-11-11", "23:00"), end: at("2026-11-11", "24:00") }],
    });
    const hostZone = process.env.TZ;
    let occurrences: unknown;

    // Act
    try {
      process.env.TZ = zone;
      occurrences = toOccurrences(series).occurrences;
    } finally {
      process.env.TZ = hostZone;
    }

    // Assert
    expect(occurrences).toEqual([
      span(at("2026-11-04", "22:00"), at("2026-11-04", "24:00")),
      span(at("2026-11-11", "22:00"), at("2026-11-11", "23:00")),
      span(at("2026-11-18", "22:00"), at("2026-11-18", "24:00")),
    ]);
  });
});

describe("toTimelineMinute", () => {
  it.each([
    ["an earlier end before a later start", item({ end: at("2026-11-06", "18:00") }), item({ start: at("2026-11-07", "09:00") })],
    ["an end before a start the same day, ordered on the end", item({ start: at("2026-11-01", "09:00"), end: at("2026-11-06", "12:00") }), item({ start: at("2026-11-06", "13:00") })],
    ["23:59 before 24:00", item({ end: at("2026-11-06", "23:59") }), item({ end: at("2026-11-06", "24:00") })],
    ["a timed point before an untimed one the same day", item({ start: at("2026-11-06", "18:00") }), item({ start: at("2026-11-06") })],
    ["a range of days on its latest day", item({ start: at("2026-11-29") }), item({ start: { date: "2026-11-21", latest: "2026-11-30" } })],
  ])("orders %s", (_case, earlier, later) => {
    // Act & Assert
    expect(toTimelineMinute(earlier)).toBeLessThan(toTimelineMinute(later));
  });

  it("ties a point with no time with 24:00 that day", () => {
    // Act & Assert
    expect(toTimelineMinute(item({ end: at("2026-11-06") }))).toBe(toTimelineMinute(item({ end: at("2026-11-06", "24:00") })));
  });

  const series = (extra: Partial<ScheduleItem>) => item({ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "10:00"), ...extra });

  it.each([
    ["a series after an item that ends between its first and last day", series({ rrule: { freq: "weekly", until: "2026-11-30" } }), item({ end: at("2026-11-10") })],
    ["a series past the occurrences served, on its last", series({ rrule: { freq: "daily", until: "2027-03-01" } }), item({ end: at("2027-02-01") })],
    ["a series after an item ending on its last day, before its end time", series({ rrule: { freq: "weekly", until: "2026-11-16" } }), item({ end: at("2026-11-16", "09:30") })],
  ])("sorts %s", (_case, later, earlier) => {
    // Act & Assert
    expect(toTimelineMinute(earlier)).toBeLessThan(toTimelineMinute(later));
  });

  it("sorts a series before an item ending after its last occurrence, though its until is later", () => {
    // Arrange
    const ended = series({ rrule: { freq: "weekly", until: "2026-11-29" } });

    // Act & Assert
    expect(toTimelineMinute(ended)).toBeLessThan(toTimelineMinute(item({ end: at("2026-11-24") })));
  });

  it("sorts a series on the end of its last occurrence", () => {
    // Act & Assert
    expect(toTimelineMinute(series({ rrule: { freq: "weekly", until: "2026-11-30" } }))).toBe(toTimelineMinute(item({ end: at("2026-11-30", "10:00") })));
  });

  it("sorts a series past its removed last day on the occurrence before it", () => {
    // Arrange
    const trimmed = series({ rrule: { freq: "weekly", until: "2026-11-30" }, exdate: ["2026-11-30"] });

    // Act & Assert
    expect(toTimelineMinute(trimmed)).toBe(toTimelineMinute(item({ end: at("2026-11-23", "10:00") })));
  });

  it("sorts a series on a later extra", () => {
    // Arrange
    const extended = series({ rrule: { freq: "weekly", until: "2026-11-09" }, rdate: [{ start: at("2026-12-01", "09:00"), end: at("2026-12-01", "10:00") }] });

    // Act & Assert
    expect(toTimelineMinute(extended)).toBe(toTimelineMinute(item({ end: at("2026-12-01", "10:00") })));
  });

  it("sorts a series with no until on the end of its first occurrence", () => {
    // Act & Assert
    expect(toTimelineMinute(series({ rrule: { freq: "daily" } }))).toBe(toTimelineMinute(item({ end: at("2026-11-02", "10:00") })));
  });
});

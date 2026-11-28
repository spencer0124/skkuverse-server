/**
 * The schedule's occurrences and timeline order, in Asia/Seoul wall time whatever the host's zone.
 *
 * toOccurrences expands `rrule + rdate - exdate - gaps` in time order. A plain item is one occurrence, its start and
 * end bounding the whole span; a series repeats its first occurrence on the rule's days through `until`, DTSTART
 * always the first instance even off `byDay` (RFC 5545 section 3.8.5.3). `exdate` drops a series' or an extra's
 * occurrence that starts on the day, and cuts the whole day out of a plain span; `gaps` cut their stretch out of
 * every occurrence and drop a moment that falls in one, from its start up to but not at its end, and an occurrence of
 * no length the same way. An extra equal to an occurrence counts once. A cut that lands on
 * midnight ends the day before at 24:00, or on that day when the item has no time. The first MAX_SCHEDULE_OCCURRENCES
 * are served and the rest counted, or counted as null for a series with no `until`, whose served ones are still its
 * first in time order when gaps cut its occurrences into pieces. A series through a far `until` (2099, 9999) is counted
 * exactly, every exception included, in well under a second. Occurrences merge only when their served points are
 * equal. An item dated by a range of days (`latest`) is its one occurrence as stored.
 *
 * toTimelineMinute orders items on their end, else their start: a point on its `latest` day, else its date, then its
 * time, 24:00 after 23:59, and a point with no time at the end of its day. An item with more than one occurrence (a
 * series with an `until`, extras, or both) sorts on the latest end among them; a series with no `until` on the end of
 * its first occurrence, or of a later extra.
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

  it.each([
    ["at the gap's start", "09:00", "10:00", ["2026-11-02", "2026-11-04"]],
    ["inside the gap", "08:00", "10:00", ["2026-11-02", "2026-11-04"]],
    ["at the gap's end", "08:00", "09:00", ["2026-11-02", "2026-11-03", "2026-11-04"]],
  ])("drops a series occurrence of no length %s only as it drops a moment", (_case, from, to, days) => {
    // Arrange
    const series = item({ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "09:00"), rrule: { freq: "daily", until: "2026-11-04" }, gaps: [{ start: at("2026-11-03", from), end: at("2026-11-03", to) }] });

    // Act & Assert
    expect(toOccurrences(series).occurrences).toEqual(days.map((day) => span(at(day, "09:00"), at(day, "09:00"))));
  });

  it.each([
    ["at the gap's start", "12:00", []],
    ["at the gap's end", "13:00", [span(at("2026-11-11", "13:00"), at("2026-11-11", "13:00"))]],
  ])("drops a plain occurrence of no length %s only as it drops a moment", (_case, time, occurrences) => {
    // Arrange
    const plain = item({ start: at("2026-11-11", time), end: at("2026-11-11", time), gaps: [{ start: at("2026-11-11", "12:00"), end: at("2026-11-11", "13:00") }] });

    // Act & Assert
    expect(toOccurrences(plain).occurrences).toEqual(occurrences);
  });

  it("counts a series occurrence of no length at a gap's end past the first 31", () => {
    // Arrange
    const series = item({ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "09:00"), rrule: { freq: "daily", until: "2026-12-31" }, gaps: [{ start: at("2026-12-15", "08:00"), end: at("2026-12-15", "09:00") }] });

    // Act & Assert
    expect(toOccurrences(series).omittedCount).toBe(60 - MAX_SCHEDULE_OCCURRENCES);
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

  it.each([
    ["a moment and a span of one minute", item({ start: at("2026-11-11", "09:00"), end: at("2026-11-11", "09:01"), rdate: [span(at("2026-11-11", "09:00"))] }), [span(at("2026-11-11", "09:00"), at("2026-11-11", "09:01")), span(at("2026-11-11", "09:00"))]],
    ["a day and its first moment", item({ start: at("2026-11-11"), rdate: [span(at("2026-11-11", "00:00"))] }), [span(at("2026-11-11")), span(at("2026-11-11", "00:00"))]],
  ])("keeps %s apart though they start on the same minute", (_case, schedule, occurrences) => {
    // Act & Assert
    expect(toOccurrences(schedule)).toEqual({ occurrences, omittedCount: 0 });
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

const dayAfter = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("toOccurrences, a series with no until whose gaps cut its occurrences", () => {
  it("serves 31 distinct occurrences when two days' occurrences leave the same piece", () => {
    // Arrange
    const gaps = [{ start: at("2026-11-02", "10:00"), end: at("2026-11-02", "11:00") }, { start: at("2026-11-02", "12:00"), end: at("2026-11-02", "13:00") }];
    const open = item({ start: at("2026-11-01", "09:00"), end: at("2026-11-03", "10:00"), rrule: { freq: "daily" }, gaps });

    // Act & Assert
    expect(toOccurrences(open)).toEqual({
      occurrences: [
        span(at("2026-11-01", "09:00"), at("2026-11-02", "10:00")),
        span(at("2026-11-02", "09:00"), at("2026-11-02", "10:00")),
        span(at("2026-11-02", "11:00"), at("2026-11-02", "12:00")),
        span(at("2026-11-02", "13:00"), at("2026-11-03", "10:00")),
        span(at("2026-11-02", "13:00"), at("2026-11-04", "10:00")),
        ...Array.from({ length: 26 }, (_unused, index) => span(at(dayAfter("2026-11-03", index), "09:00"), at(dayAfter("2026-11-05", index), "10:00"))),
      ],
      omittedCount: null,
    });
  });

  it("serves the first 31 in time order when a gap splits each long occurrence", () => {
    // Arrange
    const open = item({ start: at("2026-11-01"), end: at("2026-11-21"), rrule: { freq: "daily" }, gaps: [{ start: at("2026-11-20"), end: at("2026-11-20") }] });

    // Act & Assert
    expect(toOccurrences(open)).toEqual({
      occurrences: [
        ...Array.from({ length: 19 }, (_unused, index) => span(at(dayAfter("2026-11-01", index)), at("2026-11-19"))),
        ...Array.from({ length: 12 }, (_unused, index) => span(at("2026-11-21"), at(dayAfter("2026-11-21", index)))),
      ],
      omittedCount: null,
    });
  });
});

describe("toOccurrences and toTimelineMinute, a series with a far until", () => {
  const hour = { start: at("2026-11-02", "09:00"), end: at("2026-11-02", "10:00") };
  const FAR_EXCEPTIONS: Partial<ScheduleItem> = {
    exdate: ["2050-06-01"],
    gaps: [{ start: at("2060-01-01", "09:30"), end: at("2060-01-01", "09:40") }, { start: at("2099-12-29"), end: at("2099-12-31") }],
    rdate: [span(at("2070-03-03", "09:00"), at("2070-03-03", "10:00")), span(at("2080-01-01", "15:00"))],
  };

  it.each([
    ["every day", item({ ...hour, rrule: { freq: "daily", until: "2099-12-31" } }), 26_692, "2099-12-31"],
    ["two weekdays", item({ ...hour, rrule: { freq: "weekly", byDay: ["MO", "WE"], until: "2099-12-31" } }), 7_605, "2099-12-30"],
    ["every day less a far exdate and its last days, a gap splitting one day and an extra equal to a day", item({ ...hour, rrule: { freq: "daily", until: "2099-12-31" }, ...FAR_EXCEPTIONS }), 26_690, "2099-12-28"],
    [
      "three-day spans every day, a far gap splitting the two that cross it",
      item({ ...hour, end: at("2026-11-04", "10:00"), rrule: { freq: "daily", until: "2099-12-31" }, gaps: [{ start: at("2060-01-06", "12:00"), end: at("2060-01-06", "13:00") }] }),
      26_694,
      "2100-01-02",
    ],
  ])("counts the occurrences of %s through 2099 past the first 31 and sorts the series on its last", (_case, series, omittedCount, lastDate) => {
    // Act
    const expanded = toOccurrences(series);

    // Assert
    expect(expanded.occurrences).toHaveLength(MAX_SCHEDULE_OCCURRENCES);
    expect(expanded.occurrences[0]).toEqual(span(at("2026-11-02", "09:00"), series.end));
    expect(expanded.omittedCount).toBe(omittedCount);
    expect(toTimelineMinute(series)).toBe(toTimelineMinute(item({ end: at(lastDate, "10:00") })));
  });

  it("expands a daily series through 9999-12-31 within a second", () => {
    // Arrange
    const MAX_ELAPSED_MS = 1_000;
    const series = item({ ...hour, rrule: { freq: "daily", until: "9999-12-31" }, ...FAR_EXCEPTIONS });
    const startedAt = performance.now();

    // Act
    const expanded = toOccurrences(series);
    const minute = toTimelineMinute(series);

    // Assert
    expect(performance.now() - startedAt).toBeLessThan(MAX_ELAPSED_MS);
    expect(expanded.omittedCount).toBe((Date.parse("9999-12-31") - Date.parse("2026-11-02")) / 86_400_000 + 1 - 1 + 1 - 3 + 1 - MAX_SCHEDULE_OCCURRENCES);
    expect(minute).toBe(toTimelineMinute(item({ end: at("9999-12-31", "10:00") })));
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

  const extra = (date: string) => ({ start: at(date, "09:00"), end: at(date, "10:00") });

  it("sorts an item with extras and no rule on the end of its latest extra", () => {
    // Arrange
    const lecture = series({ rdate: [extra("2026-11-09"), extra("2026-12-14"), extra("2026-11-16")] });

    // Act & Assert
    expect(toTimelineMinute(lecture)).toBe(toTimelineMinute(item({ end: at("2026-12-14", "10:00") })));
  });

  it("sorts an item with extras on its own end when every extra ends before it", () => {
    // Arrange
    const spanned = item({ start: at("2026-11-02", "09:00"), end: at("2026-12-01", "10:00"), rdate: [extra("2026-11-09")] });

    // Act & Assert
    expect(toTimelineMinute(spanned)).toBe(toTimelineMinute(item({ end: at("2026-12-01", "10:00") })));
  });

  it("sorts an item with extras on the latest extra that exdate leaves", () => {
    // Arrange
    const lecture = series({ rdate: [extra("2026-11-09"), extra("2026-11-16")], exdate: ["2026-11-16"] });

    // Act & Assert
    expect(toTimelineMinute(lecture)).toBe(toTimelineMinute(item({ end: at("2026-11-09", "10:00") })));
  });

  it("sorts an item with extras on the end of the extra a gap cuts short", () => {
    // Arrange
    const lecture = series({ rdate: [extra("2026-11-09")], gaps: [{ start: at("2026-11-09", "09:30"), end: at("2026-11-09", "10:00") }] });

    // Act & Assert
    expect(toTimelineMinute(lecture)).toBe(toTimelineMinute(item({ end: at("2026-11-09", "09:30") })));
  });

  it("sorts a series with no until on a later extra", () => {
    // Arrange
    const open = series({ rrule: { freq: "weekly" }, rdate: [extra("2026-11-09"), extra("2027-01-11")] });

    // Act & Assert
    expect(toTimelineMinute(open)).toBe(toTimelineMinute(item({ end: at("2027-01-11", "10:00") })));
  });

  it("sorts a series with no until on its first end when the extras end before it", () => {
    // Arrange
    const open = series({ start: at("2026-11-10", "09:00"), end: at("2026-11-10", "10:00"), rrule: { freq: "weekly" }, rdate: [extra("2026-11-03")] });

    // Act & Assert
    expect(toTimelineMinute(open)).toBe(toTimelineMinute(item({ end: at("2026-11-10", "10:00") })));
  });

  it("sorts a plain item with an exdate on its own end", () => {
    // Act & Assert
    expect(toTimelineMinute(series({ exdate: ["2026-11-02"] }))).toBe(toTimelineMinute(item({ end: at("2026-11-02", "10:00") })));
  });
});

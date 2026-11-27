/**
 * The calendar export of a notice's schedule: the items the detail serves as one iCalendar (RFC 5545) text. Each item
 * is one VEVENT whose UID is the notice's cluster key and the item id. When either end has a time, both ends are
 * DATE-TIME in Asia/Seoul under one VTIMEZONE, an end with no time closing its day and 24:00 being 00:00 of the next;
 * otherwise the item is an all-day event whose DTEND is the day after its last day. A deadline starts at its end. The
 * stored `rrule`, `exdate` and `rdate` are written as they are, with no cap: RRULE's UNTIL closes its last Seoul day,
 * EXDATE takes the series' start time, and an extra with an end is a PERIOD. An item with no `rrule` has no
 * recurrence for EXDATE to remove from, so its skipped days, like every item's gaps, go to the DESCRIPTION after its
 * parts as an agenda. The status is a STATUS (suspended exports as cancelled), and the place's words the LOCATION.
 * Lines end in CRLF, TEXT values are escaped, and a line longer than 75 octets folds without splitting a character.
 * An item dated by a range of days (`latest`) is not exportable, nor is an extra so dated written.
 */
import { ObjectId } from "mongodb";
import type { NoticeScheduleItem } from "../notices.wire";
import { isExportable, toCalendar } from "./notices-detail.rules";

const NOW = new Date("2026-11-22T03:00:00.000Z");
const NOTICE = { _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"), dupOf: new ObjectId("6a5ed9e520097db8672d2097"), sourceUrl: "https://www.skku.edu/x?a=1,2" };

type Entry = Omit<NoticeScheduleItem, "parts">;
const entry = (extra: Partial<Entry>): Entry => ({ id: "D1", title: "신청", status: "scheduled", start: { date: "2026-11-02" }, occurrences: [], omittedCount: 0, ...extra });
const item = (extra: Partial<NoticeScheduleItem>): NoticeScheduleItem => ({ ...entry({}), ...extra });

const TALK = item({
  id: "D2",
  title: "설명회",
  start: { date: "2026-11-03", time: "10:00" },
  end: { date: "2026-11-03", time: "12:00" },
  parts: [entry({ id: "P1", title: "1부, 학과 소개; 질의응답", start: { date: "2026-11-03", time: "10:00" }, end: { date: "2026-11-03", time: "11:00" } })],
  status: "tentative",
  place: { text: "경영관 33101호", name: "경영관 33101", mapTarget: { skkuId: 12, spaceCd: "33101" } },
});

/** The property lines of each VEVENT, unfolded. */
function eventsOf(calendar: string): string[][] {
  const events: string[][] = [];
  let open: string[] | null = null;
  for (const line of calendar.replace(/\r\n /g, "").split("\r\n")) {
    if (line === "BEGIN:VEVENT") open = [];
    else if (line === "END:VEVENT" && open) {
      events.push(open);
      open = null;
    } else open?.push(line);
  }
  return events;
}

const propertyOf = (event: string[], name: string): string | undefined => event.find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
const propertiesOf = (event: string[], name: string): string[] => event.filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
const boundsOf = (schedule: NoticeScheduleItem): Array<string | undefined> => {
  const [event] = eventsOf(toCalendar(NOTICE, [schedule], NOW));
  return [propertyOf(event!, "DTSTART"), propertyOf(event!, "DTEND")];
};

describe("toCalendar", () => {
  it("writes a timed item as one VEVENT in the Seoul zone, CRLF-terminated and escaped, its parts the DESCRIPTION", () => {
    // Act
    const calendar = toCalendar(NOTICE, [TALK], NOW);

    // Assert
    expect(calendar).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//skkuverse//Notice Schedule//KO",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Seoul",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0900",
        "TZOFFSETTO:+0900",
        "TZNAME:KST",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:6a5ed9e520097db8672d2097-D2@skkuverse",
        "DTSTAMP:20261122T030000Z",
        "DTSTART;TZID=Asia/Seoul:20261103T100000",
        "DTEND;TZID=Asia/Seoul:20261103T120000",
        "SUMMARY:설명회",
        "LOCATION:경영관 33101호",
        "DESCRIPTION:10:00~11:00 1부\\, 학과 소개\\; 질의응답",
        "STATUS:TENTATIVE",
        "URL:https://www.skku.edu/x?a=1,2",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("keys the UID on the notice's own id while the crawler has not linked it", () => {
    // Act
    const [event] = eventsOf(toCalendar({ ...NOTICE, dupOf: null }, [TALK], NOW));

    // Assert
    expect(propertyOf(event!, "UID")).toBe("UID:66a1b2c3d4e5f6a7b8c9d0e1-D2@skkuverse");
  });

  it.each([
    ["a span of days", item({ start: { date: "2026-11-02" }, end: { date: "2026-11-06" } }), "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261107"],
    ["one day at a month's end", item({ start: { date: "2026-11-30" } }), "DTSTART;VALUE=DATE:20261130", "DTEND;VALUE=DATE:20261201"],
    ["a deadline day", item({ start: undefined, end: { date: "2026-11-06" } }), "DTSTART;VALUE=DATE:20261106", "DTEND;VALUE=DATE:20261107"],
    ["an end before its start", item({ start: { date: "2026-11-10" }, end: { date: "2026-11-04" } }), "DTSTART;VALUE=DATE:20261110", "DTEND;VALUE=DATE:20261111"],
  ])("writes an item with no time (%s) as an all-day event that ends the day after its last day", (_case, allDay, dtstart, dtend) => {
    // Act & Assert
    expect(boundsOf(allDay)).toEqual([dtstart, dtend]);
  });

  it.each([
    ["no end", { date: "2026-11-03", time: "10:00" }, undefined, "DTSTART;TZID=Asia/Seoul:20261103T100000", undefined],
    ["an end with no time, closing its day", { date: "2026-11-03", time: "10:00" }, { date: "2026-11-05" }, "DTSTART;TZID=Asia/Seoul:20261103T100000", "DTEND;TZID=Asia/Seoul:20261106T000000"],
    ["a start with no time, opening its day", { date: "2026-11-03" }, { date: "2026-11-05", time: "18:00" }, "DTSTART;TZID=Asia/Seoul:20261103T000000", "DTEND;TZID=Asia/Seoul:20261105T180000"],
    ["an end at 24:00", { date: "2026-11-03", time: "22:00" }, { date: "2026-11-03", time: "24:00" }, "DTSTART;TZID=Asia/Seoul:20261103T220000", "DTEND;TZID=Asia/Seoul:20261104T000000"],
    ["an end at its start", { date: "2026-11-03", time: "10:00" }, { date: "2026-11-03", time: "10:00" }, "DTSTART;TZID=Asia/Seoul:20261103T100000", undefined],
    ["an end before its start", { date: "2026-11-10", time: "14:00" }, { date: "2026-11-04", time: "21:00" }, "DTSTART;TZID=Asia/Seoul:20261110T140000", undefined],
  ])("writes both ends of a timed item with %s as Seoul DATE-TIMEs, and no DTEND not after the start", (_case, start, end, dtstart, dtend) => {
    // Act & Assert
    expect(boundsOf(item({ start, ...(end ? { end } : {}) }))).toEqual([dtstart, dtend]);
  });

  it.each([
    ["at a time", { date: "2026-11-06", time: "18:00" }, "DTSTART;TZID=Asia/Seoul:20261106T180000"],
    ["at 24:00", { date: "2026-11-06", time: "24:00" }, "DTSTART;TZID=Asia/Seoul:20261107T000000"],
  ])("starts a deadline %s at its end, with no DTEND", (_case, end, dtstart) => {
    // Act & Assert
    expect(boundsOf(item({ start: undefined, end }))).toEqual([dtstart, undefined]);
  });

  it("writes a timed series' rule as stored, its UNTIL the close of the last Seoul day, and its exdates at the start time", () => {
    // Arrange
    const study = item({
      start: { date: "2026-11-02", time: "19:00" },
      end: { date: "2026-11-02", time: "21:00" },
      rrule: { freq: "weekly", byDay: ["WE"], until: "2026-12-16" },
      exdate: ["2026-11-25", "2026-12-02"],
    });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [study], NOW));

    // Assert
    expect(event!.filter((line) => /^(DTSTART|DTEND|RRULE|EXDATE)/.test(line))).toEqual([
      "DTSTART;TZID=Asia/Seoul:20261102T190000",
      "DTEND;TZID=Asia/Seoul:20261102T210000",
      "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261216T145959Z",
      "EXDATE;TZID=Asia/Seoul:20261125T190000,20261202T190000",
    ]);
  });

  it("writes an all-day series by date, with no UNTIL or BYDAY when the item has none", () => {
    // Arrange
    const daily = item({ rrule: { freq: "daily" } });
    const weekly = item({ id: "D2", rrule: { freq: "weekly", until: "2026-12-16" }, exdate: ["2026-11-09"] });

    // Act
    const [first, second] = eventsOf(toCalendar(NOTICE, [daily, weekly], NOW));

    // Assert
    expect([propertyOf(first!, "RRULE"), propertyOf(first!, "EXDATE")]).toEqual(["RRULE:FREQ=DAILY", undefined]);
    expect([propertyOf(second!, "RRULE"), propertyOf(second!, "EXDATE")]).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261216", "EXDATE;VALUE=DATE:20261109"]);
  });

  it("writes each extra occurrence as an RDATE of the event's type, a timed one with an end as a PERIOD, and none dated by a range of days", () => {
    // Arrange
    const rdate = [
      { start: { date: "2026-11-17", time: "14:00" }, end: { date: "2026-11-17", time: "24:00" } },
      { start: { date: "2026-11-24", time: "14:00" } },
      { start: { date: "2026-11-21", latest: "2026-11-30" } },
    ];
    const timed = item({ start: { date: "2026-11-10", time: "14:00" }, rdate });
    const allDay = item({ id: "D2", start: { date: "2026-11-10" }, rdate: [{ start: { date: "2026-11-17" }, end: { date: "2026-11-18" } }] });

    // Act
    const [first, second] = eventsOf(toCalendar(NOTICE, [timed, allDay], NOW));

    // Assert
    expect(propertiesOf(first!, "RDATE")).toEqual(["RDATE;TZID=Asia/Seoul;VALUE=PERIOD:20261117T140000/20261118T000000", "RDATE;TZID=Asia/Seoul:20261124T140000"]);
    expect(propertiesOf(second!, "RDATE")).toEqual(["RDATE;VALUE=DATE:20261117"]);
  });

  it("writes a plain span's skipped days and every gap after the agenda in the DESCRIPTION, and no EXDATE for a span with no rule", () => {
    // Arrange
    const span = item({
      start: { date: "2026-11-09", time: "09:00" },
      end: { date: "2026-11-13", time: "18:00" },
      exdate: ["2026-11-12"],
      gaps: [{ start: { date: "2026-11-11", time: "12:00" }, end: { date: "2026-11-11", time: "13:00" } }],
      parts: [entry({ id: "P1", title: "점검", start: { date: "2026-11-11", time: "12:00" } })],
    });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [span], NOW));

    // Assert
    expect(propertyOf(event!, "EXDATE")).toBeUndefined();
    expect(propertyOf(event!, "DESCRIPTION")).toBe("DESCRIPTION:2026-11-11 12:00 점검\\n제외 2026-11-11 12:00~13:00\\n제외 2026-11-12");
  });

  it.each([
    ["a part with a start and an end on the item's first day", entry({ start: { date: "2026-11-03", time: "13:00" }, end: { date: "2026-11-03", time: "14:00" } }), "13:00~14:00 기조연설"],
    ["a part on a later day", entry({ start: { date: "2026-11-04", time: "10:00" }, end: { date: "2026-11-04", time: "11:30" } }), "2026-11-04 10:00~11:30 기조연설"],
    ["a part ending the next day", entry({ start: { date: "2026-11-03", time: "22:00" }, end: { date: "2026-11-04", time: "01:00" } }), "22:00~2026-11-04 01:00 기조연설"],
    ["a deadline part", entry({ start: undefined, end: { date: "2026-11-03", time: "18:00" } }), "~18:00 기조연설"],
    ["a part with no time on the first day", entry({ start: { date: "2026-11-03" } }), "2026-11-03 기조연설"],
  ])("writes %s as an agenda line", (_case, part, line) => {
    // Arrange
    const forum = item({ start: { date: "2026-11-03", time: "13:00" }, parts: [{ ...part, title: "기조연설" }] });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [forum], NOW));

    // Assert
    expect(propertyOf(event!, "DESCRIPTION")).toBe(`DESCRIPTION:${line}`);
  });

  it("writes no DESCRIPTION or LOCATION for an item with neither parts, skipped stretches nor a place", () => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [item({})], NOW));

    // Assert
    expect([propertyOf(event!, "DESCRIPTION"), propertyOf(event!, "LOCATION")]).toEqual([undefined, undefined]);
  });

  it("encodes an item id that would break the UID's content line, and keeps a hex id as stored", () => {
    // Act
    const [unsafe, hex] = eventsOf(toCalendar(NOTICE, [item({ id: "D1\r\nCOMMENT:x" }), item({ id: "0a1b2c3d" })], NOW));

    // Assert
    expect(propertyOf(unsafe!, "UID")).toBe("UID:6a5ed9e520097db8672d2097-D1%0D%0ACOMMENT%3Ax@skkuverse");
    expect(propertyOf(unsafe!, "COMMENT")).toBeUndefined();
    expect(propertyOf(hex!, "UID")).toBe("UID:6a5ed9e520097db8672d2097-0a1b2c3d@skkuverse");
  });

  it.each([
    ["scheduled", "STATUS:CONFIRMED"],
    ["rescheduled", "STATUS:CONFIRMED"],
    ["tentative", "STATUS:TENTATIVE"],
    ["cancelled", "STATUS:CANCELLED"],
    ["suspended", "STATUS:CANCELLED"],
  ] as const)("exports a %s item as %s", (status, line) => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [item({ status })], NOW));

    // Assert
    expect(propertyOf(event!, "STATUS")).toBe(line);
  });

  it.each([
    [74, 1],
    [75, 1],
    [76, 2],
  ])("folds a line of %i octets into %i physical lines", (octets, count) => {
    // Arrange
    const title = "x".repeat(octets - "SUMMARY:".length);

    // Act
    const physical = toCalendar(NOTICE, [item({ title })], NOW).split("\r\n");

    // Assert
    const first = physical.findIndex((line) => line.startsWith("SUMMARY:"));
    const continued = physical.slice(first + 1).findIndex((line) => !line.startsWith(" "));
    expect(1 + continued).toBe(count);
    expect(Buffer.byteLength(physical[first]!)).toBe(Math.min(octets, 75));
  });

  it("fills each continuation line to 75 octets, its leading space included", () => {
    // Arrange
    const title = "x".repeat(150 - "SUMMARY:".length);

    // Act
    const physical = toCalendar(NOTICE, [item({ title })], NOW).split("\r\n");

    // Assert
    const first = physical.findIndex((line) => line.startsWith("SUMMARY:"));
    expect(physical.slice(first, first + 3).map((line) => Buffer.byteLength(line))).toEqual([75, 75, 2]);
  });

  it("folds a long Korean line at 75 octets without splitting a character, and unfolds to the original", () => {
    // Arrange
    const title = "성균관대학교 학생성공센터 진로 설명회와 상담 주간 안내 (자연과학캠퍼스·인문사회과학캠퍼스 공통) 신청은 학과 사무실에서 받습니다";

    // Act
    const calendar = toCalendar(NOTICE, [item({ title })], NOW);

    // Assert
    const physical = calendar.split("\r\n");
    expect(physical.every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(physical.filter((line) => line.startsWith(" ")).length).toBeGreaterThan(1);
    expect(physical.every((line) => Buffer.from(Buffer.from(line).toString("utf8")).equals(Buffer.from(line)) && !line.includes("�"))).toBe(true);
    expect(propertyOf(eventsOf(calendar)[0]!, "SUMMARY")).toBe(`SUMMARY:${title}`);
  });
});

describe("isExportable", () => {
  it.each([
    ["a timed item", item({ start: { date: "2026-11-02", time: "10:00" } }), true],
    ["a deadline", item({ start: undefined, end: { date: "2026-11-06", time: "24:00" } }), true],
    ["a series", item({ rrule: { freq: "weekly", byDay: ["WE"], until: "2026-11-03" } }), true],
    ["a start on a range of days", item({ start: { date: "2026-11-21", latest: "2026-11-30" } }), false],
    ["an end on a range of days", item({ start: { date: "2026-11-02" }, end: { date: "2026-12-21", latest: "2026-12-31" } }), false],
  ])("is %s exportable: %s", (_case, schedule, exportable) => {
    // Act & Assert
    expect(isExportable(schedule)).toBe(exportable);
  });
});

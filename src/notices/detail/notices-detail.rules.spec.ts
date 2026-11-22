/**
 * The calendar export of umbrella ADR 0012 D4 ("Calendar export"): the schedule items a detail serves as one iCalendar
 * (RFC 5545) text. Each item is one VEVENT whose UID is the notice's cluster key and the item id; a dated time is
 * Asia/Seoul local under one VTIMEZONE, a date-only item is an all-day event whose DTEND is the day after its last day,
 * `repeat` is an RRULE whose UNTIL closes its last KST day, `except` an EXDATE, the slots the DESCRIPTION, and the
 * status a STATUS (suspended exports as cancelled), and the place's words the LOCATION. Lines end in CRLF, TEXT values are escaped, and a line longer than
 * 75 octets folds without splitting a character. An item dated only to a month or a week is not exportable.
 * Every DTEND follows its DTSTART: a series' end is its first day's end time, an overnight one ending the next day,
 * and a series starts on the first of its days. The UID percent-encodes the item id, and an empty day list writes no BYDAY.
 */
import { ObjectId } from "mongodb";
import { isExportable, toCalendar } from "./notices-detail.rules";
import type { NoticeScheduleItem } from "./notices-detail.wire";

const NOW = new Date("2026-11-22T03:00:00.000Z");
const NOTICE = { _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"), dupOf: new ObjectId("6a5ed9e520097db8672d2097"), sourceUrl: "https://www.skku.edu/x?a=1,2" };

const item = (extra: Partial<NoticeScheduleItem>): NoticeScheduleItem => ({ id: "D1", title: "신청", start: { date: "2026-11-02" }, except: [], slots: [], status: "scheduled", ...extra });

const TALK = item({
  id: "D2",
  title: "설명회",
  start: { date: "2026-11-03", time: "10:00" },
  end: { date: "2026-11-03", time: "12:00" },
  slots: [{ start: { date: "2026-11-03", time: "10:00" }, text: "1부, 학과 소개; 질의응답" }],
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

describe("toCalendar", () => {
  it("writes a timed item as one VEVENT in the Seoul zone, CRLF-terminated and escaped", () => {
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
        "DESCRIPTION:1부\\, 학과 소개\\; 질의응답",
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
    ["a range", item({ start: { date: "2026-11-02" }, end: { date: "2026-11-06" } }), "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261107"],
    ["one day at a month's end", item({ start: { date: "2026-11-30" } }), "DTSTART;VALUE=DATE:20261130", "DTEND;VALUE=DATE:20261201"],
  ])("writes a date-only item (%s) as an all-day event that ends the day after its last day", (_case, allDay, dtstart, dtend) => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [allDay], NOW));

    // Assert
    expect([propertyOf(event!, "DTSTART"), propertyOf(event!, "DTEND")]).toEqual([dtstart, dtend]);
  });

  it.each([
    ["no end", undefined, undefined],
    ["an end on a later day with no time", { date: "2026-11-05" }, "DTEND;TZID=Asia/Seoul:20261106T000000"],
    ["an end with a time", { date: "2026-11-05", time: "18:00" }, "DTEND;TZID=Asia/Seoul:20261105T180000"],
  ])("ends a timed item with %s as stated", (_case, end, dtend) => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [item({ start: { date: "2026-11-03", time: "10:00" }, ...(end ? { end } : {}) })], NOW));

    // Assert
    expect(propertyOf(event!, "DTEND")).toBe(dtend);
  });

  it("repeats a timed series to the close of its last KST day, skipping its except days at the series' time", () => {
    // Arrange
    const study = item({
      start: { date: "2026-11-04", time: "19:00" },
      end: { date: "2026-11-04", time: "21:00" },
      repeat: { freq: "weekly", byDay: ["WE"], until: "2026-12-16" },
      except: ["2026-11-25", "2026-12-02"],
    });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [study], NOW));

    // Assert
    expect(propertyOf(event!, "RRULE")).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261216T145959Z");
    expect(propertyOf(event!, "RRULE")).not.toContain("20261216T235959");
    expect(propertyOf(event!, "EXDATE")).toBe("EXDATE;TZID=Asia/Seoul:20261125T190000,20261202T190000");
    expect(propertyOf(event!, "DTEND")).toBe("DTEND;TZID=Asia/Seoul:20261104T210000");
  });

  it("repeats an all-day series by date, with no UNTIL or BYDAY when the item has none", () => {
    // Arrange
    const daily = item({ repeat: { freq: "daily" } });
    const weekly = item({ id: "D2", repeat: { freq: "weekly", until: "2026-12-16" }, except: ["2026-11-09"] });

    // Act
    const [first, second] = eventsOf(toCalendar(NOTICE, [daily, weekly], NOW));

    // Assert
    expect([propertyOf(first!, "RRULE"), propertyOf(first!, "EXDATE")]).toEqual(["RRULE:FREQ=DAILY", undefined]);
    expect([propertyOf(second!, "RRULE"), propertyOf(second!, "EXDATE")]).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261216", "EXDATE;VALUE=DATE:20261109"]);
  });

  it("writes a range that skips days as a daily series over the range, and a range that skips none as one event", () => {
    // Arrange
    const skipping = item({ start: { date: "2026-11-09" }, end: { date: "2026-11-13" }, except: ["2026-11-11"] });
    const whole = item({ id: "D2", start: { date: "2026-11-09" }, end: { date: "2026-11-13" } });

    // Act
    const [first, second] = eventsOf(toCalendar(NOTICE, [skipping, whole], NOW));

    // Assert
    expect(first!.filter((line) => /^(DTSTART|DTEND|RRULE|EXDATE)/.test(line))).toEqual([
      "DTSTART;VALUE=DATE:20261109",
      "DTEND;VALUE=DATE:20261110",
      "RRULE:FREQ=DAILY;UNTIL=20261113",
      "EXDATE;VALUE=DATE:20261111",
    ]);
    expect(second!.filter((line) => /^(DTSTART|DTEND|RRULE|EXDATE)/.test(line))).toEqual(["DTSTART;VALUE=DATE:20261109", "DTEND;VALUE=DATE:20261114"]);
  });

  it("ends each night of an overnight range that skips days on the morning after it starts, the last night starting the day before the range ends", () => {
    // Arrange
    const nightly = item({ start: { date: "2026-11-09", time: "22:00" }, end: { date: "2026-11-13", time: "02:00" }, except: ["2026-11-11"] });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [nightly], NOW));

    // Assert
    expect(event!.filter((line) => /^(DTSTART|DTEND|RRULE)/.test(line))).toEqual([
      "DTSTART;TZID=Asia/Seoul:20261109T220000",
      "DTEND;TZID=Asia/Seoul:20261110T020000",
      "RRULE:FREQ=DAILY;UNTIL=20261112T145959Z",
    ]);
  });

  it.each([
    ["an end dated before the start", { date: "2026-11-04", time: "21:00" }, "DTEND;TZID=Asia/Seoul:20261110T210000"],
    ["an end dated on the series' last day", { date: "2026-12-15", time: "21:00" }, "DTEND;TZID=Asia/Seoul:20261110T210000"],
    ["an end time before the start time", { date: "2026-11-10", time: "01:00" }, "DTEND;TZID=Asia/Seoul:20261111T010000"],
    ["an end time equal to the start time", { date: "2026-11-10", time: "14:00" }, "DTEND;TZID=Asia/Seoul:20261111T140000"],
  ])("ends the first occurrence of a timed series with %s on the first day's end time, after its start", (_case, end, dtend) => {
    // Arrange
    const series = item({ start: { date: "2026-11-10", time: "14:00" }, end, repeat: { freq: "weekly", until: "2026-12-15" } });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [series], NOW));

    // Assert
    expect(propertyOf(event!, "DTEND")).toBe(dtend);
  });

  it("ends an all-day series' occurrence the day after it starts, whatever day its end names", () => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [item({ end: { date: "2026-11-30" }, repeat: { freq: "weekly" } })], NOW));

    // Assert
    expect(propertyOf(event!, "DTEND")).toBe("DTEND;VALUE=DATE:20261103");
  });

  it.each([
    ["a timed item", item({ start: { date: "2026-11-10", time: "14:00" }, end: { date: "2026-11-04", time: "21:00" } }), undefined],
    ["a timed item ending at its start", item({ start: { date: "2026-11-10", time: "14:00" }, end: { date: "2026-11-10", time: "14:00" } }), undefined],
    ["an all-day item", item({ start: { date: "2026-11-10" }, end: { date: "2026-11-04" } }), "DTEND;VALUE=DATE:20261111"],
  ])("writes no end before the start of %s whose stored end precedes it", (_case, backwards, dtend) => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [backwards], NOW));

    // Assert
    expect(propertyOf(event!, "DTEND")).toBe(dtend);
  });

  it.each([
    ["a Monday start", "2026-11-02", "DTSTART;TZID=Asia/Seoul:20261104T190000", "DTEND;TZID=Asia/Seoul:20261104T210000"],
    ["a start on a listed day", "2026-11-06", "DTSTART;TZID=Asia/Seoul:20261106T190000", "DTEND;TZID=Asia/Seoul:20261106T210000"],
    ["a Saturday start", "2026-11-07", "DTSTART;TZID=Asia/Seoul:20261111T190000", "DTEND;TZID=Asia/Seoul:20261111T210000"],
  ])("starts a series with %s on the first of its days on or after the start", (_case, date, dtstart, dtend) => {
    // Arrange
    const series = item({ start: { date, time: "19:00" }, end: { date, time: "21:00" }, repeat: { freq: "weekly", byDay: ["WE", "FR"] } });

    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [series], NOW));

    // Assert
    expect([propertyOf(event!, "DTSTART"), propertyOf(event!, "DTEND")]).toEqual([dtstart, dtend]);
  });

  it("writes no event for a series whose days fall only after its last day", () => {
    // Arrange
    const empty = item({ start: { date: "2026-11-02" }, repeat: { freq: "weekly", byDay: ["WE"], until: "2026-11-03" } });

    // Act & Assert
    expect(eventsOf(toCalendar(NOTICE, [empty, TALK], NOW)).map((event) => propertyOf(event, "UID"))).toEqual(["UID:6a5ed9e520097db8672d2097-D2@skkuverse"]);
  });

  it("writes no BYDAY for a series with an empty day list", () => {
    // Act
    const [event] = eventsOf(toCalendar(NOTICE, [item({ repeat: { freq: "weekly", byDay: [] } })], NOW));

    // Assert
    expect(propertyOf(event!, "RRULE")).toBe("RRULE:FREQ=WEEKLY");
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

  it("writes each slot line once in the DESCRIPTION, and no DESCRIPTION or LOCATION for an item with neither", () => {
    // Arrange
    const slot = (time: string, text: string) => ({ start: { date: "2026-11-02", time }, text });
    const slotted = item({ slots: [slot("10:00", "A조 10:00, B조 11:00"), slot("11:00", "A조 10:00, B조 11:00"), slot("14:00", "C조 14:00")] });

    // Act
    const [first, second] = eventsOf(toCalendar(NOTICE, [slotted, item({ id: "D2" })], NOW));

    // Assert
    expect(propertyOf(first!, "DESCRIPTION")).toBe("DESCRIPTION:A조 10:00\\, B조 11:00\\nC조 14:00");
    expect([propertyOf(second!, "DESCRIPTION"), propertyOf(second!, "LOCATION")]).toEqual([undefined, undefined]);
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
    [undefined, true],
    ["month", false],
    ["week", false],
  ] as const)("is %s-precision item exportable: %s", (precision, exportable) => {
    // Act & Assert
    expect(isExportable(item(precision ? { precision } : {}))).toBe(exportable);
  });
});

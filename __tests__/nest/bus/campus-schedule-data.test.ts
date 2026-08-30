/**
 * The committed campus shuttle timetable — scripts/data/campus-schedule.json
 * and the reader that turns it into bus_schedules documents.
 *
 * These tests deliberately do NOT snapshot the departure times. A test
 * asserting `entries[3].time === "10:00"` is a change-detector: it gets edited
 * in the same commit as the data it claims to verify, so it can never fail for
 * a reason anyone cares about. What is pinned here is the SHAPE the data must
 * always have, and one real cross-file contract (routeType ↔ routeBadges) that
 * nothing else checks.
 *
 * The database is not this file's job. `npm run schedule -- --check --prod`
 * answers "is prod the file"; jest answers "is the file well-formed".
 */

import fs from "fs";
import path from "path";
import { getBusGroups } from "../../../src/bus/bus-config/bus-config.data";

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const {
  buildDocuments,
  parseTimetableFile,
} = require("../../../scripts/lib/campus-schedule-file");

const REAL_FILE = path.join(__dirname, "../../../scripts/data/campus-schedule.json");
const realTimetable = JSON.parse(fs.readFileSync(REAL_FILE, "utf8"));

/** A minimal valid file; each test bends one thing about it. */
function makeFile(entries: unknown[]) {
  return {
    semester: "2026-2",
    effectiveFrom: "2026-08-31",
    patterns: [
      {
        patternId: "weekday",
        days: [1, 2, 3, 4],
        serviceIds: ["campus-inja"],
        entries,
      },
    ],
  };
}

const OK_ENTRY = { time: "08:00", routeType: "regular", busCount: 1, notes: null };

describe("the committed timetable", () => {
  it("parses and builds one document per (serviceId, patternId)", () => {
    const docs = buildDocuments(parseTimetableFile(realTimetable));
    expect(docs.map((d: { serviceId: string; patternId: string }) => `${d.serviceId}/${d.patternId}`).sort()).toEqual([
      "campus-inja/friday",
      "campus-inja/weekday",
      "campus-jain/friday",
      "campus-jain/weekday",
    ]);
  });

  it("gives each service a non-overlapping Mon–Fri partition", () => {
    const docs = buildDocuments(parseTimetableFile(realTimetable));
    const byService = new Map<string, number[]>();
    for (const doc of docs) {
      byService.set(doc.serviceId, [...(byService.get(doc.serviceId) ?? []), ...doc.days]);
    }
    for (const [serviceId, days] of byService) {
      expect(`${serviceId}:${[...days].sort().join(",")}`).toBe(`${serviceId}:1,2,3,4,5`);
    }
  });

  it("numbers index 1..N by position in every document", () => {
    for (const doc of buildDocuments(parseTimetableFile(realTimetable))) {
      expect(doc.entries.map((e: { index: number }) => e.index)).toEqual(
        doc.entries.map((_: unknown, i: number) => i + 1),
      );
    }
  });

  it("only uses routeTypes the app has a badge for", () => {
    // Imported, not hardcoded: routeType is the join key between this data and
    // the client's badge list. A routeType with no matching badge renders as a
    // blank chip on a live screen and no server test would ever see it, because
    // BusScheduleDoc.entries is unknown[] and no server code reads routeType.
    const campus = getBusGroups("ko").find((g) => g.id === "campus");
    const badgeIds = (campus as { screen: { routeBadges: Array<{ id: string }> } }).screen.routeBadges.map(
      (b) => b.id,
    );
    expect(badgeIds.length).toBeGreaterThan(0);

    for (const doc of buildDocuments(parseTimetableFile(realTimetable))) {
      for (const entry of doc.entries) {
        expect(badgeIds).toContain(entry.routeType);
      }
    }
  });

  it("holds the 2026-2 shape: 7 weekday, 19 Friday, 14 hakbu buses", () => {
    const docs = buildDocuments(parseTimetableFile(realTimetable));
    for (const doc of docs) {
      expect(doc.entries).toHaveLength(doc.patternId === "weekday" ? 7 : 19);
    }
    const friday = docs.find((d: { patternId: string }) => d.patternId === "friday");
    const hakbuBuses = friday.entries
      .filter((e: { routeType: string }) => e.routeType === "hakbu")
      .reduce((sum: number, e: { busCount: number }) => sum + e.busCount, 0);
    expect(hakbuBuses).toBe(14);
  });
});

describe("parseTimetableFile rejects", () => {
  it("a hand-written index, by name", () => {
    // The whole reason buildDocuments derives index from position: a
    // hand-maintained 1..19 grows a duplicate the first time somebody inserts
    // a bus in the middle. Ignoring the key would hide that; rejecting says it.
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, index: 1 }]))).toThrow(/must not carry "index"/);
  });

  it("an unknown entry key", () => {
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, isAvailableBus: true }]))).toThrow(
      /unknown entry key/,
    );
  });

  it.each([["24:00"], ["8:00"], ["07:60"], ["0700"]])("a malformed time %s", (time) => {
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, time }]))).toThrow(/entry\.time/);
  });

  it.each([[0], [-1], [1.5], ["1"], [null]])("a busCount of %p", (busCount) => {
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, busCount }]))).toThrow(/busCount/);
  });

  it("an unknown routeType", () => {
    expect(() => parseTimetableFile(makeFile([{ ...OK_ENTRY, routeType: "fasttrack" }]))).toThrow(
      /routeType must be one of/,
    );
  });

  it("a duplicate (time, routeType)", () => {
    expect(() => parseTimetableFile(makeFile([OK_ENTRY, { ...OK_ENTRY }]))).toThrow(/duplicate entry/);
  });

  it("entries out of time order", () => {
    expect(() =>
      parseTimetableFile(makeFile([{ ...OK_ENTRY, time: "10:00" }, { ...OK_ENTRY, time: "09:00" }])),
    ).toThrow(/must be sorted/);
  });

  it("hakbu placed before regular at the same time", () => {
    expect(() =>
      parseTimetableFile(
        makeFile([
          { ...OK_ENTRY, routeType: "hakbu" },
          { ...OK_ENTRY, routeType: "regular" },
        ]),
      ),
    ).toThrow(/must be sorted/);
  });

  it("two patterns of one service claiming the same weekday", () => {
    // ScheduleService.resolveWeek uses patterns.find(...) — first match over an
    // unordered scan. An overlap does not error at runtime, it silently serves
    // one of two timetables, possibly differing between api-1 and api-2.
    const file = makeFile([OK_ENTRY]);
    file.patterns.push({ ...file.patterns[0]!, patternId: "other" });
    expect(() => parseTimetableFile(file)).toThrow(/claimed by more than one pattern/);
  });
});

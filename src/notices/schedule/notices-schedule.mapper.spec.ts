/**
 * The schedule items the detail serves: each stored item and part as it was stored, less its `evidence`, with its
 * occurrences and the count of those left out, its place keeping the notice's words and adding the name and building
 * sheet building gave its stored id, or nulls for a place with no id or one building does not name. Items come in
 * timeline order, on their end, else their start; parts keep their stored order. Place ids, of items and parts, are
 * collected once each.
 */
import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { SkkuId, SpaceCd } from "../../building/building.types";
import type { ScheduleItem } from "./notices-schedule.schema";
import { toPlaceIds, toScheduleItems } from "./notices-schedule.mapper";

const EVIDENCE = [{ text: "11/10", from: "body", for: "when" as const }];
const item = (extra: Partial<ScheduleItem>): ScheduleItem => ({ id: "0a1b2c3d", title: "설명회", status: "scheduled", start: { date: "2026-11-10" }, evidence: EVIDENCE, ...extra });
const part = (extra: Partial<NonNullable<ScheduleItem["parts"]>[number]>): NonNullable<ScheduleItem["parts"]>[number] => ({ id: "1b2c3d4e", title: "설명회", status: "scheduled", start: { date: "2026-11-10" }, evidence: EVIDENCE, ...extra });
const HALL: PlaceDisplay = { name: "경영관", code: "33B101", mapTarget: { skkuId: 12 as SkkuId, spaceCd: "33B101" as SpaceCd } };

describe("toScheduleItems", () => {
  it("serves an item with only its required keys as stored, less its evidence, with its one occurrence", () => {
    // Act & Assert
    expect(toScheduleItems([item({})], [], [])).toEqual([{ id: "0a1b2c3d", title: "설명회", status: "scheduled", start: { date: "2026-11-10" }, occurrences: [{ start: { date: "2026-11-10" } }], omittedCount: 0 }]);
  });

  it("keeps a series' rule and removed days beside its occurrences", () => {
    // Arrange
    const series = item({ start: { date: "2026-11-04", time: "19:00" }, rrule: { freq: "weekly", until: "2026-11-18" }, exdate: ["2026-11-11"], gaps: [], rdate: [{ start: { date: "2026-11-20", time: "19:00" } }] });

    // Act
    const [served] = toScheduleItems([series], [], []);

    // Assert
    expect(served).toEqual({
      id: "0a1b2c3d",
      title: "설명회",
      status: "scheduled",
      start: { date: "2026-11-04", time: "19:00" },
      rrule: { freq: "weekly", until: "2026-11-18" },
      exdate: ["2026-11-11"],
      gaps: [],
      rdate: [{ start: { date: "2026-11-20", time: "19:00" } }],
      occurrences: [{ start: { date: "2026-11-04", time: "19:00" } }, { start: { date: "2026-11-18", time: "19:00" } }, { start: { date: "2026-11-20", time: "19:00" } }],
      omittedCount: 0,
    });
  });

  it("orders items on their end, else their start, and keeps each part in its stored order with its own occurrences", () => {
    // Arrange
    const event = item({
      id: "E",
      start: { date: "2026-11-10", time: "14:00" },
      end: { date: "2026-11-10", time: "16:00" },
      parts: [part({ id: "P2", start: { date: "2026-11-10", time: "15:00" } }), part({ id: "P1", start: { date: "2026-11-10", time: "14:00" }, rrule: { freq: "daily", until: "2026-11-11" } })],
    });
    const items = [item({ id: "S", start: { date: "2026-11-01" }, end: { date: "2026-11-12" } }), event, item({ id: "D", start: undefined, end: { date: "2026-11-06", time: "24:00" } })];

    // Act
    const served = toScheduleItems(items, [], []);

    // Assert
    expect(served.map((scheduleItem) => scheduleItem.id)).toEqual(["D", "E", "S"]);
    expect(served[1]?.parts).toEqual([
      { id: "P2", title: "설명회", status: "scheduled", start: { date: "2026-11-10", time: "15:00" }, occurrences: [{ start: { date: "2026-11-10", time: "15:00" } }], omittedCount: 0 },
      {
        id: "P1",
        title: "설명회",
        status: "scheduled",
        start: { date: "2026-11-10", time: "14:00" },
        rrule: { freq: "daily", until: "2026-11-11" },
        occurrences: [{ start: { date: "2026-11-10", time: "14:00" } }, { start: { date: "2026-11-11", time: "14:00" } }],
        omittedCount: 0,
      },
    ]);
  });

  it("names a place building knows, on an item or a part, and keeps the words and nulls for one with no id or an id building does not name", () => {
    // Arrange
    const items = [
      item({ id: "D1", place: { text: "경영관 33B101호", id: "space:hssc:33B101", campus: "hssc" } }),
      item({ id: "D2", place: { text: "온라인", reason: "online" } }),
      item({ id: "D3", place: { text: "어딘가", id: "building:nsc:999", campus: "nsc" }, parts: [part({ id: "D4", place: { text: "경영관", id: "building:hssc:133", campus: "hssc" } })] }),
    ];
    const placeIds = ["space:hssc:33B101", "building:nsc:999", "building:hssc:133"];

    // Act
    const served = toScheduleItems(items, placeIds, [HALL, null, { name: "경영관", mapTarget: null }]);

    // Assert
    expect([...served.map((scheduleItem) => scheduleItem.place), served[2]?.parts?.[0]?.place]).toEqual([
      { text: "경영관 33B101호", name: "경영관 33B101", mapTarget: { skkuId: 12, spaceCd: "33B101" } },
      { text: "온라인", name: null, mapTarget: null },
      { text: "어딘가", name: null, mapTarget: null },
      { text: "경영관", name: "경영관", mapTarget: null },
    ]);
  });
});

describe("toPlaceIds", () => {
  it("lists each stored place id of the items and their parts once, in order, and none for a place with no id", () => {
    // Arrange
    const items = [
      item({ place: { text: "a", id: "building:hssc:133", campus: "hssc" } }),
      item({ place: { text: "b", reason: "online" }, parts: [part({ place: { text: "e", id: "space:hssc:2", campus: "hssc" } })] }),
      item({}),
      item({ place: { text: "c", id: "building:hssc:133", campus: "hssc" } }),
      item({ place: { text: "d", id: "space:hssc:1", campus: "hssc" } }),
    ];

    // Act & Assert
    expect(toPlaceIds(items)).toEqual(["building:hssc:133", "space:hssc:2", "space:hssc:1"]);
  });
});

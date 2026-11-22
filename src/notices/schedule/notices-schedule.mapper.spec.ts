/**
 * The schedule items the detail serves: each stored item as it was stored, except its place, which keeps the notice's
 * words and adds the name and building sheet building gave its stored id, or nulls for a place with no id or one
 * building does not name. Place ids are collected once each.
 */
import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { SkkuId, SpaceCd } from "../../building/building.types";
import type { ScheduleItem } from "./notices-schedule.schema";
import { toPlaceIds, toScheduleItems } from "./notices-schedule.mapper";

const item = (extra: Partial<ScheduleItem>): ScheduleItem => ({ id: "D1", title: "설명회", start: { date: "2026-11-10" }, except: [], slots: [], status: "scheduled", ...extra });
const HALL: PlaceDisplay = { name: "경영관", code: "33B101", mapTarget: { skkuId: 12 as SkkuId, spaceCd: "33B101" as SpaceCd } };

describe("toScheduleItems", () => {
  it("serves an item with no place as stored, optional fields missing", () => {
    // Act & Assert
    expect(toScheduleItems([item({})], [], [])).toEqual([{ id: "D1", title: "설명회", start: { date: "2026-11-10" }, except: [], slots: [], status: "scheduled" }]);
  });

  it("names a place building knows, and keeps the words and nulls for one with no id or an id building does not name", () => {
    // Arrange
    const items = [
      item({ id: "D1", place: { text: "경영관 33B101호", id: "space:hssc:33B101", campus: "hssc" } }),
      item({ id: "D2", place: { text: "온라인", reason: "online" } }),
      item({ id: "D3", place: { text: "어딘가", id: "building:nsc:999" } }),
      item({ id: "D4", place: { text: "경영관", id: "building:hssc:133" } }),
    ];
    const placeIds = ["space:hssc:33B101", "building:nsc:999", "building:hssc:133"];

    // Act
    const served = toScheduleItems(items, placeIds, [HALL, null, { name: "경영관", mapTarget: null }]);

    // Assert
    expect(served.map((scheduleItem) => scheduleItem.place)).toEqual([
      { text: "경영관 33B101호", name: "경영관 33B101", mapTarget: { skkuId: 12, spaceCd: "33B101" } },
      { text: "온라인", name: null, mapTarget: null },
      { text: "어딘가", name: null, mapTarget: null },
      { text: "경영관", name: "경영관", mapTarget: null },
    ]);
  });
});

describe("toPlaceIds", () => {
  it("lists each stored place id once, in item order, and none for a place with no id", () => {
    // Arrange
    const items = [item({ place: { text: "a", id: "building:hssc:133" } }), item({ place: { text: "b" } }), item({}), item({ place: { text: "c", id: "building:hssc:133" } }), item({ place: { text: "d", id: "space:hssc:1" } })];

    // Act & Assert
    expect(toPlaceIds(items)).toEqual(["building:hssc:133", "space:hssc:1"]);
  });
});

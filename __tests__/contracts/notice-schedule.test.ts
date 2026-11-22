/**
 * The server's zod mirror of the crawler's stored `schedule` (src/notices/schedule/notices-schedule.schema.ts) against
 * the vendored JSON Schema (contracts/consumed/notice-schedule.schema.json, umbrella ADR 0012 D4).
 *
 * Each fixture is judged twice, by the vendored schema through Ajv and by the mirror, and the two verdicts must match:
 * every schedule a crawler dev run stored, hand-written ones for the shapes that run did not store (a repeat, an except,
 * a campus-only place), each enum value the vendored schema lists, and one break of each rule it states. A value or a
 * required key the crawler adds, or a key it renames, turns a verdict here. What the mirror accepts it hands over whole,
 * less the crawler's bookkeeping, so a key it forgot to declare cannot be stripped unnoticed.
 *
 * Four differences are deliberate, and pinned below so a move on either side shows:
 *   - an unknown key: the schema refuses it, the mirror strips it, as every reader of a crawler record does;
 *   - the bookkeeping `key` and `groupId`: the schema requires them, the mirror never reads them;
 *   - an item id that is not eight hex digits: the reader needs only an id unique within the notice;
 *   - a repeated item id or a day no calendar has: the schema's patterns let them through, the mirror refuses what the
 *     calendar export cannot render.
 */
import Ajv2020 from "ajv/dist/2020";
import fs from "fs";
import path from "path";
import { storedSchedule } from "../../src/notices/schedule/notices-schedule.schema";

type Json = Record<string, unknown>;

const VENDORED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../contracts/consumed/notice-schedule.schema.json"), "utf8")) as Json;
const DEV_RECORDS = JSON.parse(fs.readFileSync(path.join(__dirname, "../nest/notices/fixtures/notice-schedule.dev-records.json"), "utf8")) as { schedules: Json[] };
const schemaAccepts = new Ajv2020({ allErrors: true }).compile(VENDORED);
const mirrorAccepts = (schedule: unknown): boolean => storedSchedule.safeParse(schedule).success;

const ITEM = { id: "0a1b2c3d", title: "Info session", start: { date: "2026-11-10", time: "14:00" }, except: [], slots: [], status: "scheduled" };
const scheduleOf = (...items: Json[]): Json => ({ version: "schedule-1", key: "5b173dd8abacf46cbcec", groupId: "50c7684082ba97e1", items });
const withItem = (patch: Json): Json => scheduleOf({ ...ITEM, ...patch });
const withPlace = (place: Json): Json => withItem({ place });
const without = (record: Json, key: string): Json => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const withoutBookkeeping = (schedule: Json): Json => without(without(schedule, "key"), "groupId");
/** The node of the vendored schema at a path of keys. */
const schemaAt = (...keys: string[]): Json => keys.reduce<Json>((node, key) => node[key] as Json, VENDORED);
const itemValues = (...keys: string[]): string[] => schemaAt("$defs", "item", "properties", ...keys).enum as string[];
const placeValues = (key: string): string[] => schemaAt("$defs", "place", "properties", key).enum as string[];

const WRITTEN: Array<[string, Json]> = [
  ["a pinned place", withPlace({ text: "Business Hall 33B101", id: "space:hssc:33B101", campus: "hssc" })],
  ["a building pinned on the other campus", withPlace({ text: "Engineering Hall 1", id: "building:nsc:21", campus: "nsc" })],
  ["an unpinned place with its reason", withPlace({ text: "Zoom", reason: "online" })],
  ["a campus-only place with its campus", withPlace({ text: "Natural Sciences Campus", reason: "campus_only", campus: "nsc" })],
  ["a weekly repeat with an until and an except", withItem({ end: { date: "2026-11-04", time: "21:00" }, repeat: { freq: "weekly", byDay: ["WE", "FR"], until: "2026-12-16" }, except: ["2026-11-25"] })],
  ["an open daily repeat", withItem({ repeat: { freq: "daily" } })],
  ["slots with and without an end", withItem({ slots: [{ start: { date: "2026-11-10", time: "14:00" }, end: { date: "2026-11-10", time: "15:00" }, text: "Part 1" }, { start: { date: "2026-11-10" }, text: "" }] })],
  ["a month with no time", withItem({ start: { date: "2026-12-01" }, precision: "month" })],
  ["a cancelled item with its quote", withItem({ status: "cancelled", quote: "The session is cancelled." })],
  ["a range ending at the next midnight", withItem({ start: { date: "2026-11-10", time: "22:00" }, end: { date: "2026-11-11", time: "00:00" } })],
  ["no dated item", scheduleOf()],
];

const EVERY_VALUE: Array<[string, Json]> = [
  ...itemValues("status").map((status): [string, Json] => [`status ${status}`, withItem({ status })]),
  ...itemValues("precision").map((precision): [string, Json] => [`precision ${precision}`, withItem({ precision })]),
  ...itemValues("repeat", "properties", "freq").map((freq): [string, Json] => [`freq ${freq}`, withItem({ repeat: { freq } })]),
  ...itemValues("repeat", "properties", "byDay", "items").map((day): [string, Json] => [`byDay ${day}`, withItem({ repeat: { freq: "weekly", byDay: [day] } })]),
  ...placeValues("reason").map((reason): [string, Json] => [`reason ${reason}`, withPlace({ text: "Somewhere", reason })]),
  ...placeValues("campus").map((campus): [string, Json] => [`campus ${campus}`, withPlace({ text: "Somewhere", id: `facility:${campus}:library`, campus })]),
];

const REQUIRED_KEYS: Array<[string, Json]> = [
  ...["version", "items"].map((key): [string, Json] => [`a schedule with no ${key}`, without(scheduleOf(ITEM), key)]),
  ...(schemaAt("$defs", "item").required as string[]).map((key): [string, Json] => [`an item with no ${key}`, scheduleOf(without(ITEM, key))]),
  ["a point with no date", withItem({ start: { time: "14:00" } })],
  ["a slot with no text", withItem({ slots: [{ start: { date: "2026-11-10" } }] })],
  ["a slot with no start", withItem({ slots: [{ text: "Part 1" }] })],
  ["a repeat with no freq", withItem({ repeat: { byDay: ["MO"] } })],
  ["a place with no text", withPlace({ reason: "online" })],
];

const BROKEN_RULES: Array<[string, Json]> = [
  ...["end", "precision", "repeat", "quote", "place"].map((key): [string, Json] => [`an item's ${key} stored as null`, withItem({ [key]: null })]),
  ["a time stored as null", withItem({ start: { date: "2026-11-10", time: null } })],
  ["an unknown status", withItem({ status: "postponed" })],
  ["an unknown precision", withItem({ precision: "day" })],
  ["an unknown freq", withItem({ repeat: { freq: "monthly" } })],
  ["an unknown weekday", withItem({ repeat: { freq: "weekly", byDay: ["MON"] } })],
  ["a date with no day", withItem({ start: { date: "2026-11" } })],
  ["an except that is not a date", withItem({ except: ["next week"] })],
  ["a clock past 23:59", withItem({ start: { date: "2026-11-10", time: "24:00" } })],
  ["a clock with no leading zero", withItem({ start: { date: "2026-11-10", time: "9:00" } })],
  ["an empty title", withItem({ title: "" })],
  ["an empty version", { ...scheduleOf(ITEM), version: "" }],
  ["an empty place text", withPlace({ text: "", reason: "online" })],
  ["a place with both an id and a reason", withPlace({ text: "Business Hall", id: "building:hssc:33", campus: "hssc", reason: "ambiguous" })],
  ["a place with neither an id nor a reason", withPlace({ text: "Business Hall" })],
  ["a place with an id and no campus", withPlace({ text: "Business Hall", id: "building:hssc:33" })],
  ["a place with a campus and nothing else", withPlace({ text: "Business Hall", campus: "hssc" })],
  ["a place id of an unknown kind", withPlace({ text: "Business Hall", id: "room:hssc:33", campus: "hssc" })],
  ["a place id on an unknown campus", withPlace({ text: "Business Hall", id: "building:dmc:33", campus: "hssc" })],
  ["an unknown reason", withPlace({ text: "Business Hall", reason: "far" })],
  ["an unknown campus", withPlace({ text: "Business Hall", id: "building:hssc:33", campus: "dmc" })],
  ["items that are not a list", { ...scheduleOf(), items: {} }],
];

describe("the notice schedule mirror accepts what the vendored schema accepts", () => {
  it("has every schedule of the crawler dev run to judge", () => {
    // Act & Assert
    expect(DEV_RECORDS.schedules).toHaveLength(9);
  });

  it.each(DEV_RECORDS.schedules.map((schedule, index): [string, Json] => [`dev record ${index + 1}`, schedule]))("accepts %s and hands it over whole", (_name, schedule) => {
    // Act
    const parsed = storedSchedule.safeParse(schedule);

    // Assert
    expect(schemaAccepts(schedule)).toBe(true);
    expect(parsed.success && parsed.data).toEqual(withoutBookkeeping(schedule));
  });

  it.each([...WRITTEN, ...EVERY_VALUE])("accepts %s and hands it over whole", (_name, schedule) => {
    // Act
    const parsed = storedSchedule.safeParse(schedule);

    // Assert
    expect(schemaAccepts(schedule)).toBe(true);
    expect(parsed.success && parsed.data).toEqual(withoutBookkeeping(schedule));
  });
});

describe("the notice schedule mirror refuses what the vendored schema refuses", () => {
  it.each([...REQUIRED_KEYS, ...BROKEN_RULES])("refuses %s", (_name, schedule) => {
    // Act & Assert
    expect([schemaAccepts(schedule), mirrorAccepts(schedule)]).toEqual([false, false]);
  });
});

describe("the notice schedule mirror departs from the vendored schema only where it means to", () => {
  it("strips a key it does not know, which the schema refuses", () => {
    // Arrange
    const schedule = scheduleOf({ ...ITEM, confidence: 0.9 });

    // Act
    const parsed = storedSchedule.parse(schedule);

    // Assert
    expect(schemaAccepts(schedule)).toBe(false);
    expect(parsed.items[0]).not.toHaveProperty("confidence");
  });

  it.each(["key", "groupId"])("reads a schedule with no %s, which the schema requires and the reader never uses", (key) => {
    // Arrange
    const schedule = without(scheduleOf(ITEM), key);

    // Act & Assert
    expect([schemaAccepts(schedule), mirrorAccepts(schedule)]).toEqual([false, true]);
  });

  it("reads an item id that is not eight hex digits", () => {
    // Arrange
    const schedule = withItem({ id: "D5" });

    // Act & Assert
    expect([schemaAccepts(schedule), mirrorAccepts(schedule)]).toEqual([false, true]);
  });

  it.each([
    ["an item id the next item repeats", scheduleOf(ITEM, { ...ITEM, title: "Second session" })],
    ["a day no calendar has", withItem({ start: { date: "2026-02-30" } })],
  ])("refuses %s, which the schema's patterns let through", (_name, schedule) => {
    // Act & Assert
    expect([schemaAccepts(schedule), mirrorAccepts(schedule)]).toEqual([true, false]);
  });
});

/**
 * The server's zod mirror of the crawler's stored `schedule` (src/notices/schedule/notices-schedule.schema.ts) against
 * the vendored JSON Schema (contracts/consumed/notice-schedule.schema.json), in its v2 shape.
 *
 * Each fixture is judged twice, by the vendored schema through Ajv and by the mirror, and the two verdicts must match:
 * the hand-written stored schedule the route tests serve, hand-written ones for each shape the schema allows (a
 * series, a deadline, a gap, an extra occurrence, parts, a range of days, each place, evidence and run field), each
 * enum value the vendored schema lists, and one break of each rule it states. Every v1 schedule a crawler dev run
 * stored is refused by both: v2 keeps no compatibility. A value or a required key the crawler adds, or a key it
 * renames, turns a verdict here. What the mirror accepts it hands over whole, less the crawler's bookkeeping `key` and
 * `groupId`, so a key it forgot to declare cannot be stripped unnoticed. Ajv runs without format checks, which it
 * would refuse to compile: the one format, `run.nextTry`'s date-time, is bookkeeping no reader reads.
 *
 * Six differences are deliberate, and pinned below so a move on either side shows:
 *   - an unknown key: the schema refuses it, the mirror strips it, as every reader of a crawler record does;
 *   - the bookkeeping `key` and `groupId`: the schema requires them, the mirror never reads them;
 *   - an item id that is not eight hex digits: the reader needs only an id unique within the notice;
 *   - an id another item or part repeats, a day no calendar has, and a part with parts of its own: the schema's
 *     patterns let them through, the mirror refuses what the calendar export and the detail cannot serve.
 */
import Ajv2020 from "ajv/dist/2020";
import fs from "fs";
import path from "path";
import { storedSchedule } from "../../src/notices/schedule/notices-schedule.schema";

type Json = Record<string, unknown>;

const VENDORED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../contracts/consumed/notice-schedule.schema.json"), "utf8")) as Json;
const V1_RECORDS = JSON.parse(fs.readFileSync(path.join(__dirname, "../nest/notices/fixtures/notice-schedule.dev-records.json"), "utf8")) as { schedules: Json[] };
const STORED = (JSON.parse(fs.readFileSync(path.join(__dirname, "../nest/notices/fixtures/notice-schedule.stored.json"), "utf8")) as { schedule: Json }).schedule;
const schemaAccepts = new Ajv2020({ allErrors: true, validateFormats: false }).compile(VENDORED);
const mirrorAccepts = (schedule: unknown): boolean => storedSchedule.safeParse(schedule).success;

const RUN = { usd: 0.01, ms: 900, model: "claude-sonnet-4-5", prompt: "schedule-v4.2", repaired: false, warnings: [], unplaced: [], missed: [], decided: {}, missing: [], failures: 0, nextTry: null };
const ITEM = { id: "0a1b2c3d", title: "Info session", status: "scheduled", start: { date: "2026-11-10", time: "14:00" }, evidence: [] };
const scheduleOf = (...items: Json[]): Json => ({ version: "schedule-v4.2", key: "5b173dd8abacf46cbcec", groupId: "50c7684082ba97e1", items, run: RUN });
const withItem = (patch: Json): Json => scheduleOf({ ...ITEM, ...patch });
const withPlace = (place: Json): Json => withItem({ place });
const withEvidence = (evidence: Json): Json => withItem({ evidence: [evidence] });
const withRun = (patch: Json): Json => ({ ...scheduleOf(ITEM), run: { ...RUN, ...patch } });
const without = (record: Json, key: string): Json => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const withoutBookkeeping = (schedule: Json): Json => without(without(schedule, "key"), "groupId");
const PART = { id: "1b2c3d4e", title: "Part 1", status: "scheduled", start: { date: "2026-11-10", time: "14:00" }, end: { date: "2026-11-10", time: "15:00" }, evidence: [] };
/** The node of the vendored schema at a path of keys. */
const schemaAt = (...keys: string[]): Json => keys.reduce<Json>((node, key) => node[key] as Json, VENDORED);
const enumAt = (...keys: string[]): string[] => schemaAt("$defs", ...keys).enum as string[];

const WRITTEN: Array<[string, Json]> = [
  ["the stored schedule the route tests serve", STORED],
  ["a pinned place", withPlace({ text: "Business Hall 33B101", id: "space:hssc:33B101", campus: "hssc" })],
  ["a building pinned on the other campus", withPlace({ text: "Engineering Hall 1", id: "building:nsc:21", campus: "nsc" })],
  ["an unpinned place with its reason", withPlace({ text: "Zoom", reason: "online" })],
  ["a campus-only place with its campus", withPlace({ text: "Natural Sciences Campus", reason: "campus_only", campus: "nsc" })],
  ["a weekly series with an until and an exdate", withItem({ end: { date: "2026-11-10", time: "16:00" }, rrule: { freq: "weekly", byDay: ["TU", "TH"], until: "2026-12-15" }, exdate: ["2026-11-24"] })],
  ["an open daily series", withItem({ rrule: { freq: "daily" } })],
  ["a span of days", withItem({ start: { date: "2026-11-02" }, end: { date: "2026-11-06" } })],
  ["a deadline at the end of its day", withItem({ start: undefined, end: { date: "2026-11-06", time: "24:00" } })],
  ["a gap", withItem({ end: { date: "2026-11-13", time: "18:00" }, gaps: [{ start: { date: "2026-11-11", time: "12:00" }, end: { date: "2026-11-11", time: "13:00" } }] })],
  ["extra occurrences with and without an end", withItem({ rdate: [{ start: { date: "2026-11-17", time: "14:00" }, end: { date: "2026-11-17", time: "16:00" } }, { start: { date: "2026-11-24" } }] })],
  ["parts, one with its own series", withItem({ end: { date: "2026-11-10", time: "16:00" }, parts: [PART, { ...PART, id: "2c3d4e5f", rrule: { freq: "daily", until: "2026-11-12" } }] })],
  ["a range of days on each end", withItem({ start: { date: "2026-11-21", latest: "2026-11-30" }, end: { date: "2026-12-21", latest: "2026-12-31" } })],
  ["evidence with and without offsets", withItem({ evidence: [{ text: "Nov 10", from: "body", for: "when", begin: 0, end: 6 }, { text: "Postponed", from: "poster:2", for: "status" }] })],
  ["a run with every list filled", withRun({ warnings: ["dropped D3"], unplaced: ["row 4"], missed: [{ text: "11/31", where: "body" }], decided: { D1: { end: "order" } }, missing: ["poster:2"], failures: 3, nextTry: "2026-11-27T10:00:00+09:00" })],
  ["no dated item", scheduleOf()],
];

const EVERY_VALUE: Array<[string, Json]> = [
  ...enumAt("item", "properties", "status").map((status): [string, Json] => [`status ${status}`, withItem({ status })]),
  ...enumAt("rrule", "properties", "freq").map((freq): [string, Json] => [`freq ${freq}`, withItem({ rrule: { freq } })]),
  ...enumAt("rrule", "properties", "byDay", "items").map((day): [string, Json] => [`byDay ${day}`, withItem({ rrule: { freq: "weekly", byDay: [day] } })]),
  ...enumAt("place", "properties", "reason").map((reason): [string, Json] => [`reason ${reason}`, withPlace({ text: "Somewhere", reason })]),
  ...enumAt("place", "properties", "campus").map((campus): [string, Json] => [`campus ${campus}`, withPlace({ text: "Somewhere", id: `facility:${campus}:library`, campus })]),
  ...enumAt("evidence", "properties", "for").map((purpose): [string, Json] => [`evidence for ${purpose}`, withEvidence({ text: "x", from: "title", for: purpose })]),
];

const REQUIRED_KEYS: Array<[string, Json]> = [
  ...(VENDORED.required as string[]).filter((key) => key !== "key" && key !== "groupId").map((key): [string, Json] => [`a schedule with no ${key}`, without(scheduleOf(ITEM), key)]),
  ...(schemaAt("$defs", "item").required as string[]).map((key): [string, Json] => [`an item with no ${key}`, scheduleOf(without(ITEM, key))]),
  ...(schemaAt("$defs", "run").required as string[]).map((key): [string, Json] => [`a run with no ${key}`, { ...scheduleOf(ITEM), run: without(RUN, key) }]),
  ["an item with neither a start nor an end", scheduleOf(without(ITEM, "start"))],
  ["a point with no date", withItem({ start: { time: "14:00" } })],
  ["a series with no freq", withItem({ rrule: { byDay: ["MO"] } })],
  ["a gap with no end", withItem({ gaps: [{ start: { date: "2026-11-10", time: "15:00" } }] })],
  ["an extra occurrence with no start", withItem({ rdate: [{ end: { date: "2026-11-17", time: "16:00" } }] })],
  ["a place with no text", withPlace({ reason: "online" })],
  ["evidence with no source", withEvidence({ text: "x", for: "when" })],
  ["a missed date with no place", withRun({ missed: [{ text: "11/31" }] })],
];

const BROKEN_RULES: Array<[string, Json]> = [
  ...["end", "rrule", "exdate", "gaps", "rdate", "parts", "place"].map((key): [string, Json] => [`an item's ${key} stored as null`, withItem({ [key]: null })]),
  ["a time stored as null", withItem({ start: { date: "2026-11-10", time: null } })],
  ["a series with no start", scheduleOf({ ...without(ITEM, "start"), end: { date: "2026-11-10" }, rrule: { freq: "weekly" } })],
  ["an unknown status", withItem({ status: "postponed" })],
  ["an unknown freq", withItem({ rrule: { freq: "monthly" } })],
  ["an unknown weekday", withItem({ rrule: { freq: "weekly", byDay: ["MON"] } })],
  ["an empty byDay", withItem({ rrule: { freq: "weekly", byDay: [] } })],
  ["a repeated byDay day", withItem({ rrule: { freq: "weekly", byDay: ["MO", "MO"] } })],
  ["a date with no day", withItem({ start: { date: "2026-11" } })],
  ["an exdate that is not a date", withItem({ exdate: ["next week"] })],
  ["24:00 on a start", withItem({ start: { date: "2026-11-10", time: "24:00" } })],
  ["24:00 on a gap's start", withItem({ gaps: [{ start: { date: "2026-11-10", time: "24:00" }, end: { date: "2026-11-10", time: "24:00" } }] })],
  ["a clock past 24:00", withItem({ end: { date: "2026-11-10", time: "24:01" } })],
  ["a clock with no leading zero", withItem({ start: { date: "2026-11-10", time: "9:00" } })],
  ["a time beside a latest day", withItem({ start: { date: "2026-11-10", time: "14:00", latest: "2026-11-12" } })],
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
  ["evidence from an unknown source", withEvidence({ text: "x", from: "footer", for: "when" })],
  ["evidence from poster 0", withEvidence({ text: "x", from: "poster:0", for: "when" })],
  ["evidence for an unknown value", withEvidence({ text: "x", from: "body", for: "who" })],
  ["evidence with a begin and no end", withEvidence({ text: "x", from: "body", for: "when", begin: 3 })],
  ["evidence at a negative offset", withEvidence({ text: "x", from: "body", for: "when", begin: -1, end: 2 })],
  ["a negative cost", withRun({ usd: -0.01 })],
  ["a fractional wall time", withRun({ ms: 1.5 })],
  ["a negative failure count", withRun({ failures: -1 })],
  ["a missing part named twice", withRun({ missing: ["poster:2", "poster:2"] })],
  ["an empty missing part", withRun({ missing: [""] })],
  ["items that are not a list", { ...scheduleOf(), items: {} }],
];

describe("the notice schedule mirror accepts what the vendored schema accepts", () => {
  it.each([...WRITTEN, ...EVERY_VALUE])("accepts %s and hands it over whole", (_name, schedule) => {
    // Arrange
    const stored = JSON.parse(JSON.stringify(schedule)) as Json;

    // Act
    const parsed = storedSchedule.safeParse(stored);

    // Assert
    expect(schemaAccepts(stored)).toBe(true);
    expect(parsed.success && parsed.data).toEqual(withoutBookkeeping(stored));
  });
});

describe("the notice schedule mirror refuses what the vendored schema refuses", () => {
  it("has every v1 schedule of the crawler dev run to judge", () => {
    // Act & Assert
    expect(V1_RECORDS.schedules).toHaveLength(9);
  });

  it.each(V1_RECORDS.schedules.map((schedule, index): [string, Json] => [`v1 dev record ${index + 1}`, schedule]))("refuses %s", (_name, schedule) => {
    // Act & Assert
    expect([schemaAccepts(schedule), mirrorAccepts(schedule)]).toEqual([false, false]);
  });

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
    ["a part id its item repeats", withItem({ parts: [{ ...PART, id: ITEM.id }] })],
    ["a day no calendar has", withItem({ start: { date: "2026-02-30" } })],
    ["a part with parts of its own", withItem({ parts: [{ ...PART, parts: [] }] })],
  ])("refuses %s, which the schema's patterns let through", (_name, schedule) => {
    // Act & Assert
    expect([schemaAccepts(schedule), mirrorAccepts(schedule)]).toEqual([true, false]);
  });
});

/**
 * storedSchedule: the server's reader of the `schedule` the crawler stores on a notice, in its v2 shape. Its agreement
 * with the crawler's vendored JSON Schema is __tests__/contracts/notice-schedule.test.ts.
 *
 * The hand-written schedule in fixtures/notice-schedule.stored.json parses and comes out equal to what was stored, less
 * the crawler's `key` and `groupId`. A copy missing any top-level key or any required key of an item does not parse,
 * nor does an item with neither a start nor an end, a repeat with no start, a part with parts of its own, an optional
 * key stored as null, an unknown status, a month-less date, 24:00 on a start, a time beside a latest day, or an id
 * that another item or part repeats. A key the mirror does not know is stripped, never refused.
 */
import fs from "fs";
import path from "path";
import { storedSchedule } from "./notices-schedule.schema";

type Json = Record<string, unknown>;

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-schedule.stored.json");
const STORED = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { schedule: { items: Json[] } & Json }).schedule;
const EVENT = STORED.items[3]!;

const without = (key: string) => (stored: Json) => Object.fromEntries(Object.entries(stored).filter(([name]) => name !== key));
const withItem = (patch: (stored: Json) => Json) => ({ ...STORED, items: [patch({ ...EVENT })] });

describe("storedSchedule", () => {
  it("parses the stored schedule to exactly what was stored, less the crawler's bookkeeping keys", () => {
    // Act
    const parsed = storedSchedule.safeParse(STORED);

    // Assert
    expect(parsed.success && parsed.data).toEqual(without("groupId")(without("key")(STORED)));
  });

  it.each(["version", "items", "run"])("refuses a schedule with no %s", (key) => {
    // Act & Assert
    expect(storedSchedule.safeParse(without(key)(STORED)).success).toBe(false);
  });

  it.each(["id", "title", "status", "evidence"])("refuses an item with no %s", (key) => {
    // Act & Assert
    expect(storedSchedule.safeParse(withItem(without(key))).success).toBe(false);
  });

  it.each([
    ["an item with neither a start nor an end", (stored: Json) => without("end")(without("start")(stored))],
    ["a repeat with no start", (stored: Json) => ({ ...without("start")(stored), rrule: { freq: "weekly" } })],
    ["a part with parts of its own", (stored: Json) => ({ ...stored, parts: [{ ...(stored.parts as Json[])[0], parts: [] }] })],
    ["an optional key stored as null", (stored: Json) => ({ ...stored, rdate: null })],
    ["an unknown status", (stored: Json) => ({ ...stored, status: "postponed" })],
    ["a date with no day", (stored: Json) => ({ ...stored, start: { date: "2026-11" } })],
    ["24:00 on a start", (stored: Json) => ({ ...stored, start: { date: "2026-11-10", time: "24:00" } })],
    ["a time beside a latest day", (stored: Json) => ({ ...stored, end: { date: "2026-11-10", time: "16:00", latest: "2026-11-12" } })],
    ["a part id the item repeats", (stored: Json) => ({ ...stored, id: "3c4d5e6f" })],
  ])("refuses %s", (_case, patch) => {
    // Act & Assert
    expect(storedSchedule.safeParse(withItem(patch)).success).toBe(false);
  });

  it("strips a key it does not know", () => {
    // Act
    const parsed = storedSchedule.parse(withItem((stored) => ({ ...stored, confidence: 0.9 })));

    // Assert
    expect(parsed.items[0]).not.toHaveProperty("confidence");
    expect(parsed).not.toHaveProperty("key");
  });
});

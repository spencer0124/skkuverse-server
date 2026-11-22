/**
 * storedSchedule: the server's reader of the `schedule` the crawler stores on a notice (umbrella ADR 0012 D4), mirrored
 * by hand until the crawler's JSON Schema is vendored.
 *
 * The hand-written schedule in fixtures/notice-schedule.stored.json parses and comes out equal to what was stored. A copy
 * missing any top-level key or any required key of an item does not parse, and neither does an optional key stored as
 * null, an unknown status, a month-less date or a repeated item id. A key the mirror does not know is stripped, never
 * refused.
 */
import fs from "fs";
import path from "path";
import { storedSchedule } from "./notices-schedule.schema";

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-schedule.stored.json");
const STORED = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { schedule: { version: string; items: Array<Record<string, unknown>> } }).schedule;

const withItem = (patch: (stored: Record<string, unknown>) => Record<string, unknown>) => ({ ...STORED, items: [patch({ ...STORED.items[1]! }), ...STORED.items.slice(2)] });
const without = (key: string) => (stored: Record<string, unknown>) => Object.fromEntries(Object.entries(stored).filter(([name]) => name !== key));

describe("storedSchedule", () => {
  it("parses the stored schedule to exactly what was stored", () => {
    // Act
    const parsed = storedSchedule.safeParse(STORED);

    // Assert
    expect(parsed.success && parsed.data).toEqual(STORED);
  });

  it.each(["version", "items"])("refuses a schedule with no %s", (key) => {
    // Act & Assert
    expect(storedSchedule.safeParse(without(key)(STORED)).success).toBe(false);
  });

  it.each(["id", "title", "start", "except", "slots", "status"])("refuses an item with no %s", (key) => {
    // Act & Assert
    expect(storedSchedule.safeParse(withItem(without(key))).success).toBe(false);
  });

  it.each([
    ["an optional key stored as null", (stored: Record<string, unknown>) => ({ ...stored, quote: null })],
    ["an unknown status", (stored: Record<string, unknown>) => ({ ...stored, status: "postponed" })],
    ["a date with no day", (stored: Record<string, unknown>) => ({ ...stored, start: { date: "2026-11" } })],
    ["a clock past 23:59", (stored: Record<string, unknown>) => ({ ...stored, start: { date: "2026-11-10", time: "24:00" } })],
    ["an id the next item repeats", (stored: Record<string, unknown>) => ({ ...stored, id: "D5" })],
  ])("refuses %s", (_case, patch) => {
    // Act & Assert
    expect(storedSchedule.safeParse(withItem(patch)).success).toBe(false);
  });

  it("strips a key it does not know", () => {
    // Act
    const parsed = storedSchedule.parse({ ...withItem((stored) => ({ ...stored, confidence: 0.9 })), key: "h1" });

    // Assert
    expect(parsed).not.toHaveProperty("key");
    expect(parsed.items[0]).not.toHaveProperty("confidence");
  });
});

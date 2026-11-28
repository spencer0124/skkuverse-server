/**
 * NoticesRowService.readNotice: the door the detail flow reads one notice through. It parses the notice's facts and
 * history through NoticesFactsService and reads the notice at the caller's moment as one RowReading, or null when the
 * notice has no facts or facts the schema refuses. The words are notices-row.rules.spec.ts's.
 *
 * src/infra/logger.ts is mocked: the refused record logs `notices.facts.unparsed`.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesRowService } from "./notices-row.service";
import type { RowNotice } from "./notices-row.types";

const CASE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/facts-rows/a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json");
const RECORD = (JSON.parse(fs.readFileSync(CASE, "utf8")) as { record: Record<string, unknown> }).record;
const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };

const notice = (facts: unknown): RowNotice => ({ _id: new ObjectId(), title: "2026학년도 장학금 신청 안내", facts, factsHistory: [] });

describe("NoticesRowService.readNotice", () => {
  const service = new NoticesRowService(new NoticesFactsService(FIXED_CLOCK));
  const OPEN_DAY = new Date("2026-10-25T03:00:00Z");

  it("reads the row of a notice with facts at the caller's moment", () => {
    // Act
    const reading = service.readNotice(notice(RECORD), OPEN_DAY);

    // Assert
    expect(reading?.row.line2).toBe("내일 마감");
  });

  it.each([
    ["23:59 KST, the day before the deadline", "2026-10-25T14:59:00Z", 1, "내일 마감"],
    ["00:00 KST, the deadline day", "2026-10-25T15:00:00Z", 0, "오늘"],
  ])("reads at the caller's moment: %s", (_label, instant, daysToDeadline, token) => {
    // Act
    const reading = service.readNotice(notice(RECORD), new Date(instant));

    // Assert
    expect(reading?.row.token?.text).toBe(token);
    expect(reading?.dayOffset("2026-10-26")).toBe(daysToDeadline);
  });

  it("reads nothing for a notice with no facts or facts the schema refuses", () => {
    // Act
    const readings = [notice(undefined), notice(null), notice({ ...RECORD, v: 2 })].map((stored) => service.readNotice(stored, OPEN_DAY));

    // Assert
    expect(readings).toEqual([null, null, null]);
  });

  it("reads the notice's history without a snapshot the schema refuses", () => {
    // Arrange
    const valid = { extractedAt: "2026-10-20T03:00:00Z", inputHash: "h1", times: [], status: ["closed"] };
    const withoutTimes = { extractedAt: "2026-10-21T03:00:00Z", inputHash: "h2", status: ["closed"] };
    const stored = { ...notice(RECORD), factsHistory: [valid, withoutTimes, "garbage", null] };

    // Act
    const reading = service.readNotice(stored, OPEN_DAY);

    // Assert
    expect(reading?.factsHistory).toEqual([valid]);
    expect(reading?.title).toBe("2026학년도 장학금 신청 안내");
  });
});

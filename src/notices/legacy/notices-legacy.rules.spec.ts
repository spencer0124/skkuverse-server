/**
 * The rough one-liner, type and window an app that still reads `summary` gets for a notice with facts and no AI
 * summary (umbrella ADR 0001, owner decision 2026-10-28): line 2 of the row then its qualifier, the shown window's end,
 * and a type from the shown item's kind.
 *
 * Each case is a golden case of the crawler's row.py (__tests__/nest/notices/fixtures/facts-rows/) read at its own
 * moment through NoticesFactsService, as production reads it. src/infra/logger.ts is mocked.
 */
import { ObjectId } from "mongodb";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import fs from "fs";
import path from "path";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesRowService } from "../row/notices-row.service";
import type { RowReading } from "../row/notices-row.types";
import { toDerivedBrief } from "./notices-legacy.rules";

const FIXTURES = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/facts-rows");

function readingOf(name: string): RowReading {
  const stored = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as { now: string; record: unknown };
  const now = new Date(stored.now);
  const rows = new NoticesRowService(new NoticesFactsService({ now: () => now }));
  const reading = rows.readNotice({ _id: new ObjectId(), title: "제목", facts: stored.record, factsHistory: [] }, now);
  if (!reading) throw new Error(`${name} does not parse`);
  return reading;
}

describe("toDerivedBrief", () => {
  it.each([
    [
      "an open window is an action_required deadline",
      "a_deadline_tomorrow_reads_as_one_while_the_window_is_open",
      { oneLiner: "내일 마감", type: "action_required", startAt: { date: "2026-10-19", time: null }, endAt: { date: "2026-10-26", time: null, label: null } },
    ],
    [
      "a closed window keeps its end so the app shows it closed",
      "a_closed_application_closes_the_row_though_a_report_is_due_later",
      { oneLiner: "10/15(목) 마감됨", type: "action_required", startAt: { date: "2026-10-06", time: null }, endAt: { date: "2026-10-15", time: null, label: null } },
    ],
    [
      "a month-only deadline ends on its latest day, with no time",
      "a_month_only_deadline_still_shows_when_nothing_else_is_dated",
      { oneLiner: "2027년 4월", type: "action_required", startAt: null, endAt: { date: "2027-04-30", time: null, label: null } },
    ],
    [
      "a session is an event that starts at its time",
      "a_specific_session_wins_over_the_span_that_contains_it",
      { oneLiner: "11/5(목) 11시", type: "event", startAt: { date: "2026-11-05", time: "11:00" }, endAt: null },
    ],
    [
      "the qualifier follows line 2",
      "the_place_qualifier_comes_from_the_item_the_row_shows__2",
      { oneLiner: "10/29(목) · 경영관 33101호", type: "event", startAt: { date: "2026-10-29", time: null }, endAt: null },
    ],
    [
      "a bounded period is an informational range",
      "a_bounded_period_under_way_comes_before_what_takes_effect_after_it",
      { oneLiner: "오늘까지 해제", type: "informational", startAt: { date: "2026-10-12", time: null }, endAt: { date: "2026-10-25", time: null, label: null } },
    ],
    [
      "a period with one day has no range",
      "a_period_with_no_end_written_is_that_one_day__2",
      { oneLiner: "10/20(화)", type: "informational", startAt: null, endAt: null },
    ],
    [
      "a row that abstains gives no date",
      "a_row_abstains_when_its_only_deadline_was_dropped_by_the_date_check",
      { oneLiner: "날짜 원문 확인", type: "informational", startAt: null, endAt: null },
    ],
    [
      "a cancelled notice says so and gives no date",
      "a_stopped_or_filled_notice_keeps_its_token_on_the_last_days__1",
      { oneLiner: "취소", type: "informational", startAt: null, endAt: null },
    ],
    [
      "a notice with no date still carries its qualifier",
      "not_for_students_needs_a_quote__2",
      { oneLiner: "교직원 대상", type: "informational", startAt: null, endAt: null },
    ],
    [
      "a notice with nothing to say has no one-liner",
      "a_stopped_or_filled_notice_keeps_its_token_on_the_last_days__3",
      { oneLiner: null, type: "informational", startAt: null, endAt: null },
    ],
  ])("%s", (_title, name, expected) => {
    // Arrange
    const reading = readingOf(name);

    // Act
    const brief = toDerivedBrief(reading);

    // Assert
    expect(brief).toEqual(expected);
  });

  it("opens with the word of a change token, which line 2 does not say", () => {
    // Arrange
    const reading = readingOf("a_specific_session_wins_over_the_span_that_contains_it");
    const changed: RowReading = { ...reading, row: { ...reading.row, token: { text: "연장", tone: "extended" } } };

    // Act
    const brief = toDerivedBrief(changed);

    // Assert
    expect(brief.oneLiner).toBe("연장 · 11/5(목) 11시");
  });

  it("leaves out a qualifier that only counts conditions, which says nothing outside the detail", () => {
    // Arrange
    const reading = readingOf("a_specific_session_wins_over_the_span_that_contains_it");
    const dated: RowReading = { ...reading, row: { ...reading.row, token: null, qualifier: "조건 2개" }, fullQualifier: "조건 2개" };
    const dateless: RowReading = { ...dated, row: { ...dated.row, line2: "", trackedLine2: "" } };

    // Act
    const [withDate, withoutDate] = [toDerivedBrief(dated), toDerivedBrief(dateless)];

    // Assert
    expect(withDate.oneLiner).toBe("11/5(목) 11시");
    expect(withoutDate.oneLiner).toBeNull();
  });

  it("keeps the track tag and a qualifier too long for the row, since a summary or push body has no 26-character line", () => {
    // Arrange
    const reading = readingOf("a_specific_session_wins_over_the_span_that_contains_it");
    const tracked: RowReading = {
      ...reading,
      row: { ...reading.row, token: null, line2: "11/10(화) 10시", trackedLine2: "[신관 A,B동] 11/10(화) 10시", qualifier: null },
      fullQualifier: "경영학과, 글로벌경영학과 재적생",
    };

    // Act
    const brief = toDerivedBrief(tracked);

    // Assert
    expect(brief.oneLiner).toBe("[신관 A,B동] 11/10(화) 10시 · 경영학과, 글로벌경영학과 재적생");
  });
});

describe("toDerivedBrief, the table label of codebook v3.11", () => {
  const MAIN_THING = "th_441ff75112a0";
  const labelledBrief = (label: string | undefined) => {
    const stored = JSON.parse(fs.readFileSync(path.join(FIXTURES, "a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json"), "utf8")) as { now: string; record: { benefits: unknown[] } };
    const ev = { src: "body", quote: "월 50만원", start: 0, end: 6, match: "exact", ...(label === undefined ? {} : { label }) };
    stored.record.benefits.push({ ev, thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw: false, track: "", appliesTo: [], tag: "", tagBy: "" });
    const now = new Date(stored.now);
    const reading = new NoticesRowService(new NoticesFactsService({ now: () => now })).readNotice({ _id: new ObjectId(), title: "제목", facts: stored.record, factsHistory: [] }, now);
    if (!reading) throw new Error("the test record does not parse");
    return { brief: toDerivedBrief(reading), qualifier: reading.row.qualifier };
  };

  it("keeps the label before the full qualifier even where the row's 26 characters leave the qualifier out", () => {
    // Act
    const { brief, qualifier } = labelledBrief("장학금 지급 기준 금액");

    // Assert
    expect(qualifier).toBeNull();
    expect(brief.oneLiner).toBe("내일 마감 · 장학금 지급 기준 금액 · 월 50만원");
  });

  it("reads a notice with no label as it did", () => {
    // Act
    const { brief, qualifier } = labelledBrief(undefined);

    // Assert
    expect(qualifier).toBe("월 50만원");
    expect(brief.oneLiner).toBe("내일 마감 · 월 50만원");
  });
});

describe("toDerivedBrief, the crawler's compact, which only the list row shows", () => {
  const MAIN_THING = "th_441ff75112a0";
  const QUOTE = "월 50만원 지급 및 기숙사비 전액 면제";
  const compactBrief = (label: string | undefined) => {
    const stored = JSON.parse(fs.readFileSync(path.join(FIXTURES, "a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json"), "utf8")) as { now: string; record: { benefits: unknown[] } };
    const ev = { src: "body", quote: QUOTE, start: 0, end: QUOTE.length, match: "exact", compact: "월 50만원", ...(label === undefined ? {} : { label }) };
    stored.record.benefits.push({ ev, thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw: false, track: "", appliesTo: [], tag: "", tagBy: "" });
    const now = new Date(stored.now);
    const reading = new NoticesRowService(new NoticesFactsService({ now: () => now })).readNotice({ _id: new ObjectId(), title: "제목", facts: stored.record, factsHistory: [] }, now);
    if (!reading) throw new Error("the test record does not parse");
    return { brief: toDerivedBrief(reading), qualifier: reading.row.qualifier };
  };

  it("keeps the whole quote in the one-liner where the row's 26 characters take the compact", () => {
    // Act
    const { brief, qualifier } = compactBrief(undefined);

    // Assert
    expect(qualifier).toBe("월 50만원");
    expect(brief.oneLiner).toBe(`내일 마감 · ${QUOTE}`);
  });

  it("keeps the label before the whole quote where the row takes the labelled compact", () => {
    // Act
    const { brief, qualifier } = compactBrief("장학금");

    // Assert
    expect(qualifier).toBe("장학금 · 월 50만원");
    expect(brief.oneLiner).toBe(`내일 마감 · 장학금 · ${QUOTE}`);
  });
});


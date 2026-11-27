/**
 * The calendar check every stored date shares: a date is a real day written
 * YYYY-MM-DD, so a push cannot store a day the calendar does not have, or one
 * the strict reads would not find.
 *
 * Day arithmetic on such dates: a day's number counts days from 1970-01-01, so
 * adding to it crosses a month, a year end and a leap day, and the number and
 * the date it converts back to are the same whatever the host's time zone.
 */
import { isCalendarDate, toCalendarDate, toDayNumber } from "./calendar-date.util";

describe("isCalendarDate", () => {
  it.each([
    ["2026-12-21", true],
    ["2028-02-29", true],
    ["2027-02-29", false],
    ["2026-02-28", true],
    ["2026-12-31", true],
    ["2026-12-32", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-12-1", false],
    ["26-12-21", false],
    ["2026-12-21T00:00", false],
    ["", false],
  ])("%j is a calendar date: %s", (value, expected) => {
    // Act & Assert
    expect(isCalendarDate(value)).toBe(expected);
  });
});

describe("toDayNumber", () => {
  it.each([
    ["1970-01-01", 0],
    ["1970-01-02", 1],
    ["2026-11-27", 20_784],
  ])("numbers %s as day %d", (date, dayNumber) => {
    // Act & Assert
    expect(toDayNumber(date)).toBe(dayNumber);
  });
});

describe("toCalendarDate", () => {
  it.each([
    ["2026-11-30", 1, "2026-12-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-11-01", -1, "2026-10-31"],
  ])("writes %s moved by %d days as %s", (date, days, expected) => {
    // Act & Assert
    expect(toCalendarDate(toDayNumber(date) + days)).toBe(expected);
  });

  it.each(["UTC", "Asia/Seoul", "America/Los_Angeles", "Pacific/Kiritimati"])("gives the same day and number when the host zone is %s", (zone) => {
    // Arrange
    const hostZone = process.env.TZ;
    let results: [number, string];

    // Act
    try {
      process.env.TZ = zone;
      results = [toDayNumber("2026-11-27"), toCalendarDate(20_784)];
    } finally {
      process.env.TZ = hostZone;
    }

    // Assert
    expect(results).toEqual([20_784, "2026-11-27"]);
  });
});

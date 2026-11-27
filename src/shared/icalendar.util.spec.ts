/**
 * The iCalendar (RFC 5545) text encoding: content lines joined and ended by CRLF, each longer than 75 octets folded
 * onto continuation lines that open with a space and never split a character; TEXT values escaped; an instant written
 * as a UTC DATE-TIME.
 */
import { toEscapedText, toICalendarText, toUtcStamp } from "./icalendar.util";

describe("toICalendarText", () => {
  it.each([
    [74, ["x".repeat(74)]],
    [75, ["x".repeat(75)]],
    [76, ["x".repeat(75), ` ${"x".repeat(1)}`]],
    [150, ["x".repeat(75), ` ${"x".repeat(74)}`, ` ${"x".repeat(1)}`]],
  ])("folds a line of %i octets into lines of at most 75 octets", (octets, physical) => {
    // Act & Assert
    expect(toICalendarText(["x".repeat(octets)])).toBe(`${physical.join("\r\n")}\r\n`);
  });

  it("folds a Korean line between characters, and ends every line in CRLF", () => {
    // Arrange
    const korean = "가".repeat(30);

    // Act
    const text = toICalendarText(["BEGIN:VCALENDAR", korean]);

    // Assert
    expect(text).toBe(`BEGIN:VCALENDAR\r\n${"가".repeat(25)}\r\n ${"가".repeat(5)}\r\n`);
  });
});

describe("toEscapedText", () => {
  it("escapes backslashes, semicolons, commas and line breaks", () => {
    // Act & Assert
    expect(toEscapedText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("toUtcStamp", () => {
  it("writes an instant as a UTC DATE-TIME", () => {
    // Act & Assert
    expect(toUtcStamp(new Date("2026-12-16T14:59:59.000Z"))).toBe("20261216T145959Z");
  });
});

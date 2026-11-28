/**
 * A block with nothing to show is served as null, so the app tests one thing: an empty bullet list, an audience that
 * names no level and no status, and refs with no link, phone or email are empty, and one entry in any list makes a
 * block worth showing.
 */
import { isEmptyAudience, isEmptyBrief, isEmptyRefs } from "./notices-blocks.rules";

describe("isEmptyBrief", () => {
  it.each([
    [0, true],
    [1, false],
    [3, false],
  ])("is %j for a brief of %i bullets, each below, at and above the first", (count, expected) => {
    // Act & Assert
    expect(isEmptyBrief({ bullets: Array.from({ length: count }, (_unused, index) => ({ text: `bullet ${index}` })) })).toBe(expected);
  });
});

describe("isEmptyAudience", () => {
  it.each([
    ["no level and no status", { level: { include: [] }, status: { include: [], exclude: [] } }, true],
    ["a level only", { level: { include: ["grad" as const] }, status: { include: [], exclude: [] } }, false],
    ["a status to include only", { level: { include: [] }, status: { include: ["enrolled" as const], exclude: [] } }, false],
    ["a status to exclude only", { level: { include: [] }, status: { include: [], exclude: ["leave" as const] } }, false],
  ])("for %s is %j", (_case, audience, expected) => {
    // Act & Assert
    expect(isEmptyAudience(audience)).toBe(expected);
  });
});

describe("isEmptyRefs", () => {
  it.each([
    ["nothing", { links: [], phones: [], emails: [] }, true],
    ["a link only", { links: [{ url: "https://skku.edu", domain: "skku.edu" }], phones: [], emails: [] }, false],
    ["a phone only", { links: [], phones: [{ value: "02-740-1722" }], emails: [] }, false],
    ["an email only", { links: [], phones: [], emails: [{ value: "a@skku.edu" }] }, false],
  ])("for %s is %j", (_case, refs, expected) => {
    // Act & Assert
    expect(isEmptyRefs(refs)).toBe(expected);
  });
});

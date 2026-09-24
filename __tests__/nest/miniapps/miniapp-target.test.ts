/**
 * The mini-app target grammar: `<miniAppId>[<root-relative path>]`.
 *
 * The cases that matter are the ones that would let the shell frame a page on a
 * host nobody registered. `//evil.com` and `/\evil.com` are both read by a URL
 * parser as a new authority, so a path that begins with either must be refused
 * here — the device checks the resolved origin again, but a map action never
 * reaches the device if it fails here, and that is the cheaper place to learn.
 */
import {
  isKnownMiniAppTarget,
  parseMiniAppTarget,
} from "../../../src/miniapps/miniapp-target";

describe("parseMiniAppTarget", () => {
  it.each([
    ["eskara-2026", { id: "eskara-2026" }],
    ["eskara-2026/eskara/wristband", { id: "eskara-2026", path: "/eskara/wristband" }],
    ["eskara-2026/eskara/lineup?day=2", { id: "eskara-2026", path: "/eskara/lineup?day=2" }],
    ["hssc/", { id: "hssc", path: "/" }],
  ])("parses %s", (value, expected) => {
    expect(parseMiniAppTarget(value)).toEqual(expected);
  });

  it.each([
    ["a protocol-relative path", "eskara-2026//evil.com/x"],
    ["a backslash authority", "eskara-2026/\\evil.com"],
    ["a trailing newline", "eskara-2026/eskara\n"],
    ["an inner space", "eskara-2026/a b"],
    ["an absolute URL", "https://eskara.miniapp.skkuverse.com/eskara"],
    ["a leading slash", "/eskara-2026/x"],
    ["an uppercase id", "Eskara-2026"],
    ["a query with no path", "eskara-2026?x=1"],
    ["an empty string", ""],
    ["a non-string", 42],
  ])("refuses %s", (_label, value) => {
    expect(parseMiniAppTarget(value)).toBeNull();
  });
});

describe("isKnownMiniAppTarget", () => {
  it("accepts a target naming a registered mini app", () => {
    expect(isKnownMiniAppTarget("eskara-2026/eskara/wristband")).toBe(true);
  });

  it("refuses a well-formed target naming nothing registered", () => {
    expect(isKnownMiniAppTarget("no-such-app/x")).toBe(false);
  });
});

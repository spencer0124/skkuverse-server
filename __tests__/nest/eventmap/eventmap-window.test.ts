/**
 * scripts/eventmap-window.js — the activation lever.
 *
 * Two pure pieces are worth pinning. `isLive` must agree exactly with
 * `findActiveActivation`'s query, because the whole point of `status` is to
 * answer "can anyone see this right now?" without guessing; and `--minutes` has
 * to reject what Number() would happily take, which is the bug this file caught
 * during the first verification run.
 *
 * Expected values were taken from a live probe of the module, not assumed —
 * `Number.isInteger(Number("1e2"))` is true, which is exactly how a window a
 * hundred times longer than it looks gets opened.
 */
// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const { isLive, parseArgs } = require("../../../scripts/eventmap-window");

const NOW = new Date("2026-08-27T06:00:00Z");
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

describe("eventmap-window — parseArgs", () => {
  it("defaults to a 15-minute window rather than an open-ended one", () => {
    // The dead man's switch is the default because a forgotten `enabled: true`
    // is the expensive mistake, not a window that closed too early.
    expect(parseArgs(["open"])).toEqual({
      command: "open",
      layerSetId: "eskara-2026",
      minutes: 15,
    });
  });

  it("accepts a plain whole number of minutes", () => {
    expect(parseArgs(["open", "--minutes", "10"]).minutes).toBe(10);
    expect(parseArgs(["open", "--minutes", "1"]).minutes).toBe(1);
    expect(parseArgs(["open", "--minutes", "2880"]).minutes).toBe(2880);
  });

  it("rejects everything Number() would silently accept", () => {
    // "1e2" is the one that matters: Number("1e2") is 100 and Number.isInteger
    // says true, so an isInteger-only guard opens a 100-minute window for what
    // reads as a typo.
    for (const value of ["1e2", "0", "01", "1.5", "-5", "", "abc", " 10", "Infinity"]) {
      expect(() => parseArgs(["open", "--minutes", value])).toThrow(
        /--minutes must be a positive whole number/,
      );
    }
  });

  it("requires exactly one command", () => {
    expect(() => parseArgs([])).toThrow(/expected one of \[status, open, close\]/);
    expect(() => parseArgs(["open", "close"])).toThrow(/two commands given/);
    expect(() => parseArgs(["enable"])).toThrow(/unknown argument: enable/);
  });

  it("takes a layer set id", () => {
    expect(parseArgs(["status", "--layer-set-id", "other-2027"]).layerSetId).toBe(
      "other-2027",
    );
  });
});

describe("eventmap-window — isLive agrees with findActiveActivation", () => {
  // The query is: enabled: true, AND (activeFrom null OR <= now),
  // AND (activeUntil null OR > now). Each case below is one of its clauses.
  const cases: Array<[string, Record<string, unknown> | null, boolean]> = [
    ["disabled inside its window", { enabled: false, activeFrom: at(-10), activeUntil: at(10) }, false],
    ["enabled inside its window", { enabled: true, activeFrom: at(-10), activeUntil: at(10) }, true],
    ["enabled but not started", { enabled: true, activeFrom: at(5), activeUntil: at(10) }, false],
    ["enabled but expired", { enabled: true, activeFrom: at(-20), activeUntil: at(-1) }, false],
    ["open-ended both ends", { enabled: true, activeFrom: null, activeUntil: null }, true],
    ["no document at all", null, false],
  ];

  it.each(cases)("%s", (_name, doc, expected) => {
    expect(isLive(doc, NOW)).toBe(expected);
  });

  it("treats activeUntil exactly at now as closed", () => {
    // The server's clause is `activeUntil: { $gt: now }`, so the window is
    // half-open. A `>=` here would report the map live for the one tick after
    // it actually went dark.
    expect(isLive({ enabled: true, activeFrom: at(-20), activeUntil: NOW }, NOW)).toBe(false);
  });

  it("treats activeFrom exactly at now as open", () => {
    // The matching clause is `$lte`, so a window opened "now" is live at once —
    // which is what `open` relies on to take effect without a second command.
    expect(isLive({ enabled: true, activeFrom: NOW, activeUntil: at(10) }, NOW)).toBe(true);
  });
});

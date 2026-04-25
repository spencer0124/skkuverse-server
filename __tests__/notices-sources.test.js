const sources = require("../features/notices/sources");

describe("sources loader", () => {
  it("loads 147 entries", () => {
    expect(sources.list).toHaveLength(147);
  });

  it("every entry has the required shape", () => {
    for (const s of sources.list) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.hasCategory).toBe("boolean");
      expect(typeof s.hasAuthor).toBe("boolean");
      // campus/appCategory are scaffolded as null
      expect(s).toHaveProperty("campus");
      expect(s).toHaveProperty("appCategory");
    }
  });

  it("freezes both the list and individual entries", () => {
    expect(Object.isFrozen(sources.list)).toBe(true);
    expect(Object.isFrozen(sources.list[0])).toBe(true);
  });

  it("map lookup returns the same object as list entries", () => {
    const first = sources.list[0];
    expect(sources.map.get(first.id)).toBe(first);
  });

  it("map.has returns false for unknown ids", () => {
    expect(sources.map.has("nope-not-real")).toBe(false);
  });

  it("version is a 64-char sha256 hex string", () => {
    expect(sources.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("version is stable across reloads (not random)", () => {
    // Re-require by clearing the cache — should produce same hash
    jest.resetModules();
    const reloaded = require("../features/notices/sources");
    expect(reloaded.version).toBe(sources.version);
  });

  it("contains the well-known skku-main source as skku-standard (hasCategory+hasAuthor)", () => {
    const m = sources.map.get("skku-main");
    expect(m).toBeDefined();
    expect(m.hasCategory).toBe(true);
    expect(m.hasAuthor).toBe(true);
  });

  it("contains cheme (wordpress-api) with both flags false", () => {
    const m = sources.map.get("cheme");
    expect(m).toBeDefined();
    expect(m.hasCategory).toBe(false);
    expect(m.hasAuthor).toBe(false);
  });

  it("contains nano (gnuboard-custom) with hasAuthor only", () => {
    const m = sources.map.get("nano");
    expect(m).toBeDefined();
    expect(m.hasCategory).toBe(false);
    expect(m.hasAuthor).toBe(true);
  });
});

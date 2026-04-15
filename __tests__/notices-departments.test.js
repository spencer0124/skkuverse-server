const departments = require("../features/notices/departments");

describe("departments loader", () => {
  it("loads 147 entries", () => {
    expect(departments.list).toHaveLength(147);
  });

  it("every entry has the required shape", () => {
    for (const d of departments.list) {
      expect(typeof d.id).toBe("string");
      expect(typeof d.name).toBe("string");
      expect(typeof d.hasCategory).toBe("boolean");
      expect(typeof d.hasAuthor).toBe("boolean");
      // campus/appCategory are scaffolded as null
      expect(d).toHaveProperty("campus");
      expect(d).toHaveProperty("appCategory");
    }
  });

  it("freezes both the list and individual entries", () => {
    expect(Object.isFrozen(departments.list)).toBe(true);
    expect(Object.isFrozen(departments.list[0])).toBe(true);
  });

  it("map lookup returns the same object as list entries", () => {
    const first = departments.list[0];
    expect(departments.map.get(first.id)).toBe(first);
  });

  it("map.has returns false for unknown ids", () => {
    expect(departments.map.has("nope-not-real")).toBe(false);
  });

  it("version is a 64-char sha256 hex string", () => {
    expect(departments.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("version is stable across reloads (not random)", () => {
    // Re-require by clearing the cache — should produce same hash
    jest.resetModules();
    const reloaded = require("../features/notices/departments");
    expect(reloaded.version).toBe(departments.version);
  });

  it("contains the well-known skku-main dept as skku-standard (hasCategory+hasAuthor)", () => {
    const m = departments.map.get("skku-main");
    expect(m).toBeDefined();
    expect(m.hasCategory).toBe(true);
    expect(m.hasAuthor).toBe(true);
  });

  it("contains cheme (wordpress-api) with both flags false", () => {
    const m = departments.map.get("cheme");
    expect(m).toBeDefined();
    expect(m.hasCategory).toBe(false);
    expect(m.hasAuthor).toBe(false);
  });

  it("contains nano (gnuboard-custom) with hasAuthor only", () => {
    const m = departments.map.get("nano");
    expect(m).toBeDefined();
    expect(m.hasCategory).toBe(false);
    expect(m.hasAuthor).toBe(true);
  });
});

// IMPORTANT: date-holidays must be MOCKED here. Loading the real library under
// ts-jest spins at ~95% CPU and never returns (incompatible with jest's module
// loader). In production (plain node) it loads instantly. The real KR lookup is
// verified out-of-band via a node probe against dist/. Here we stub it to test
// THIS helper's wiring: SKKU-first lookup, public-type filtering, and null.
// Do NOT mock "fs" — wrapping fs.readFileSync also hangs ts-jest.
jest.mock("date-holidays", () =>
  jest.fn().mockImplementation(() => ({
    isHoliday: (date: Date) => {
      const ds = date.toISOString().slice(0, 10); // T12:00+09:00 → same calendar date in UTC
      const table: Record<string, Array<{ name: string; type: string }>> = {
        "2026-01-01": [{ name: "신정", type: "public" }],
        "2026-10-09": [{ name: "한글날", type: "public" }],
        // non-public type must be filtered out (not a no-service day)
        "2026-12-24": [{ name: "Christmas Eve", type: "observance" }],
      };
      return table[ds] ?? false;
    },
  })),
);

const { getNonOperatingDayLabel } = require("../features/bus/holiday-calendar");

describe("getNonOperatingDayLabel", () => {
  it("returns the Korean name for a KR public holiday", () => {
    expect(getNonOperatingDayLabel("2026-01-01")).toBe("신정");
    expect(getNonOperatingDayLabel("2026-10-09")).toBe("한글날");
  });

  it("ignores non-public holiday types (e.g. observance)", () => {
    expect(getNonOperatingDayLabel("2026-12-24")).toBeNull();
  });

  it("returns null for an ordinary weekday", () => {
    expect(getNonOperatingDayLabel("2026-03-02")).toBeNull();
  });
});

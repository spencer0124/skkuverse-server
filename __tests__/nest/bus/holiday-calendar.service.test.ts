/**
 * Nest port of holiday-calendar.test.ts — HolidayCalendarService delegates to
 * features/bus/holiday-calendar.getNonOperatingDayLabel.
 *
 * date-holidays MUST be mocked (loading the real lib under ts-jest hangs — see
 * the original test's header comment). We stub it to verify wiring: SKKU-first
 * lookup, public-type filtering, and null for ordinary days.
 */

jest.mock("date-holidays", () =>
  jest.fn().mockImplementation(() => ({
    isHoliday: (date: Date) => {
      const ds = date.toISOString().slice(0, 10);
      const table: Record<string, Array<{ name: string; type: string }>> = {
        "2026-01-01": [{ name: "신정", type: "public" }],
        "2026-10-09": [{ name: "한글날", type: "public" }],
        "2026-12-24": [{ name: "Christmas Eve", type: "observance" }],
      };
      return table[ds] ?? false;
    },
  })),
);

import { HolidayCalendarService } from "../../../src/bus/schedule/holiday-calendar.service";

let service: HolidayCalendarService;

beforeEach(() => {
  service = new HolidayCalendarService();
});

describe("HolidayCalendarService.getNonOperatingDayLabel", () => {
  it("returns the Korean name for a KR public holiday", () => {
    expect(service.getNonOperatingDayLabel("2026-01-01")).toBe("신정");
    expect(service.getNonOperatingDayLabel("2026-10-09")).toBe("한글날");
  });

  it("ignores non-public holiday types (e.g. observance)", () => {
    expect(service.getNonOperatingDayLabel("2026-12-24")).toBeNull();
  });

  it("returns null for an ordinary weekday", () => {
    expect(service.getNonOperatingDayLabel("2026-03-02")).toBeNull();
  });
});

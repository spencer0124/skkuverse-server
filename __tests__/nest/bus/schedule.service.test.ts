/**
 * Nest port of schedule-data.test.ts — ScheduleService is the exact port of
 * features/bus/schedule.data.ts.
 *
 * Same mocking strategy as the Express test: lib/db (driver-level reads),
 * lib/config (dbName), lib/logger, and the holiday calendar feature module
 * (HolidayCalendarService delegates to it). features/bus/schedule-db is mocked
 * so onModuleInit's ensureScheduleIndexes is a no-op.
 *
 * The service holds its 1-hr cache on the instance, so we new it up per test.
 * serviceConfig is the same shared object the Express test mutates, so the
 * suspend-window tests mutate it identically.
 */

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(),
}));

jest.mock("../../../src/infra/config", () => ({
  mongo: { dbName: "test_db" },
}));

jest.mock("../../../src/infra/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock("../../../src/bus/schedule/holiday-calendar", () => ({
  getNonOperatingDayLabel: jest.fn(() => null),
}));

jest.mock("../../../src/bus/schedule/schedule-db", () => ({
  ensureScheduleIndexes: jest.fn().mockResolvedValue(undefined),
}));

import { ScheduleService } from "../../../src/bus/schedule/schedule.service";
import { HolidayCalendarService } from "../../../src/bus/schedule/holiday-calendar.service";

const logger = require("../../../src/infra/logger");
const { getNonOperatingDayLabel } = require("../../../src/bus/schedule/holiday-calendar");
const { getClient } = require("../../../src/infra/db");
const serviceConfig = require("../../../src/bus/schedule/service-config").default;

let mockSchedules: unknown[] = [];
let mockOverrides: unknown[] = [];

const mockFind = jest.fn();
const mockCollection = jest.fn();

let service: ScheduleService;
// Convenience wrappers so the test bodies mirror the Express functional style.
const resolveWeek = (...args: [string, string?]) => service.resolveWeek(...args);
const resolveSmartSchedule = (id: string) => service.resolveSmartSchedule(id);
const clearCache = () => service.clearCache();
const clearCacheForService = (id: string) => service.clearCacheForService(id);

beforeEach(() => {
  mockSchedules = [];
  mockOverrides = [];
  getNonOperatingDayLabel.mockImplementation(() => null);

  mockFind.mockImplementation(() => ({
    toArray: jest.fn().mockImplementation(() => {
      const lastCall =
        mockCollection.mock.calls[mockCollection.mock.calls.length - 1];
      if (lastCall && lastCall[0] === "bus_overrides") {
        return Promise.resolve(mockOverrides);
      }
      return Promise.resolve(mockSchedules);
    }),
  }));

  mockCollection.mockReturnValue({ find: mockFind });

  getClient.mockReturnValue({
    db: jest.fn().mockReturnValue({
      collection: mockCollection,
    }),
  });

  service = new ScheduleService(new HolidayCalendarService());
});

afterEach(() => {
  clearCache();
  jest.clearAllMocks();
});

describe("resolveWeek", () => {
  it("weekday pattern (days:[1,2,3,4]) resolves Mon-Thu to schedule", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result).not.toBeNull();
    expect(result!.days).toHaveLength(7);

    for (let i = 0; i < 4; i++) {
      expect(result!.days[i].display).toBe("schedule");
      expect(result!.days[i].schedule).toHaveLength(1);
    }
  });

  it("separate friday pattern (days:[5]) resolves Friday to its entries", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
      { serviceId: "campus-inja", patternId: "friday", days: [5], entries: [{ index: 1, time: "09:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result!.days[4].display).toBe("schedule");
    expect((result!.days[4].schedule[0] as { time: string }).time).toBe("09:00");
  });

  it("Sat/Sun with no pattern and hidden fallback → display hidden", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result!.days[5].display).toBe("hidden");
    expect(result!.days[5].schedule).toEqual([]);
    expect(result!.days[6].display).toBe("hidden");
    expect(result!.days[6].schedule).toEqual([]);
  });

  it("override type replace → display schedule with override entries and merged notices", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "ESKARA 1일차", notices: [{ style: "warning", text: "특별 운행" }], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 2, notes: "special" }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0];
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("ESKARA 1일차");
    expect((monday.schedule[0] as { time: string }).time).toBe("10:00");
    const serviceNotices = monday.notices.filter((n) => n.source === "service");
    const overrideNotices = monday.notices.filter((n) => n.source === "override");
    expect(serviceNotices.length).toBeGreaterThan(0);
    expect(overrideNotices).toHaveLength(1);
    expect(overrideNotices[0].text).toBe("특별 운행");
  });

  it("override type noService → display noService, empty schedule/notices, label set", async () => {
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-10", type: "noService", label: "삼일절", notices: [], entries: [] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const tuesday = result!.days[1];
    expect(tuesday.display).toBe("noService");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(tuesday.label).toBe("삼일절");
  });

  it("override on a Monday overrides the weekday pattern", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "특별", notices: [], entries: [{ index: 1, time: "11:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0];
    expect(monday.display).toBe("schedule");
    expect((monday.schedule[0] as { time: string }).time).toBe("11:00");
    expect(monday.label).toBe("특별");
  });

  it("holiday on a weekday → noService + label, beating the weekday pattern", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    getNonOperatingDayLabel.mockImplementation((d: string) =>
      d === "2026-03-10" ? "삼일절 대체공휴일" : null,
    );

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const tuesday = result!.days[1];
    expect(tuesday.display).toBe("noService");
    expect(tuesday.label).toBe("삼일절 대체공휴일");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(result!.days[0].display).toBe("schedule");
  });

  it("service without respectsKoreanHolidays ignores holidays", async () => {
    mockSchedules = [
      { serviceId: "fasttrack-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
    ];
    getNonOperatingDayLabel.mockImplementation(() => "공휴일");

    const result = await resolveWeek("fasttrack-inja", "2026-03-09");
    expect(result!.days[0].display).toBe("schedule");
    expect((result!.days[0].schedule[0] as { time: string }).time).toBe("10:00");
    expect(getNonOperatingDayLabel).not.toHaveBeenCalled();
  });

  it("override on a holiday wins over the holiday (escape hatch)", async () => {
    getNonOperatingDayLabel.mockImplementation(() => "신정");
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "replace", label: "신정 특별운행", notices: [], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result!.days[0];
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("신정 특별운행");
    expect((monday.schedule[0] as { time: string }).time).toBe("10:00");
  });

  it("fasttrack with hidden fallback on non-event day → display hidden", async () => {
    mockSchedules = [];

    const result = await resolveWeek("fasttrack-inja", "2026-03-09");
    expect(result).not.toBeNull();
    for (const day of result!.days) {
      expect(day.display).toBe("hidden");
      expect(day.schedule).toEqual([]);
    }
  });

  it("Wednesday date normalizes to that week Monday", async () => {
    mockSchedules = [];
    const result = await resolveWeek("campus-inja", "2026-03-11");
    expect(result!.from).toBe("2026-03-09");
  });

  it("from omitted defaults to current week Monday", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [];

    const result = await resolveWeek("campus-inja");
    expect(result!.from).toBe("2026-03-09");
    jest.useRealTimers();
  });

  it("requestedFrom preserves original value, null if omitted", async () => {
    mockSchedules = [];

    const result1 = await resolveWeek("campus-inja", "2026-03-11");
    expect(result1!.requestedFrom).toBe("2026-03-11");

    clearCache();
    const result2 = await resolveWeek("campus-inja");
    expect(result2!.requestedFrom).toBeNull();
  });

  it("unknown serviceId returns null", async () => {
    const result = await resolveWeek("nonexistent-service", "2026-03-09");
    expect(result).toBeNull();
  });

  it("second call with same key does not re-query DB", async () => {
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    await resolveWeek("campus-inja", "2026-03-09");
    const callCount = mockCollection.mock.calls.length;

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBe(callCount);
  });

  it("after 1hr TTL, re-queries DB", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T00:00:00.000Z"));
    mockSchedules = [];

    await resolveWeek("campus-inja", "2026-03-09");
    const callCount = mockCollection.mock.calls.length;

    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBeGreaterThan(callCount);
    jest.useRealTimers();
  });

  it("always returns exactly 7 days Mon-Sun in order", async () => {
    mockSchedules = [];
    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result!.days).toHaveLength(7);
    expect(result!.days[0].dayOfWeek).toBe(1);
    expect(result!.days[6].dayOfWeek).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(result!.days[i].dayOfWeek).toBe(i + 1);
    }
  });

  it("response has correct top-level shape", async () => {
    mockSchedules = [];
    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result).toMatchObject({
      serviceId: "campus-inja",
      requestedFrom: "2026-03-09",
      from: "2026-03-09",
    });
    expect(result!.days).toHaveLength(7);
    expect(result!.days[0]).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dayOfWeek: expect.any(Number),
      display: expect.stringMatching(/^(schedule|noService|hidden)$/),
      schedule: expect.any(Array),
      notices: expect.any(Array),
    });
    expect(result!.days[0]).toHaveProperty("label");
  });
});

describe("resolveSmartSchedule", () => {
  it("on a weekday with schedule, selectedDate = today and hidden days filtered", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).not.toBeNull();
    expect(result!.selectedDate).toBe("2026-03-10");
    expect(result!.from).toBe("2026-03-09");
    expect(result!.days.every((d) => d.display !== "hidden")).toBe(true);
    expect(result!.days).toHaveLength(5);
    jest.useRealTimers();
  });

  it("on Saturday, selectedDate crosses to next week Monday", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-14T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.selectedDate).toBe("2026-03-16");
    expect(result!.from).toBe("2026-03-16");
    expect(result!.days).toHaveLength(5);
    jest.useRealTimers();
  });

  it("holiday (noService override) on today, selectedDate skips to next schedule day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];
    mockOverrides = [
      { serviceId: "campus-inja", date: "2026-03-09", type: "noService", label: "공휴일", notices: [], entries: [] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.selectedDate).toBe("2026-03-10");
    const holidayDay = result!.days.find((d) => d.date === "2026-03-09");
    expect(holidayDay).toBeDefined();
    expect(holidayDay!.display).toBe("noService");
    expect(holidayDay!.label).toBe("공휴일");
    jest.useRealTimers();
  });

  it("fasttrack with only override days → only those days visible", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [];
    mockOverrides = [
      { serviceId: "fasttrack-inja", date: "2026-03-09", type: "replace", label: "ESKARA 1일차", notices: [], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
      { serviceId: "fasttrack-inja", date: "2026-03-10", type: "replace", label: "ESKARA 2일차", notices: [], entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("fasttrack-inja");
    expect(result!.selectedDate).toBe("2026-03-09");
    expect(result!.days).toHaveLength(2);
    expect(result!.days[0].date).toBe("2026-03-09");
    expect(result!.days[1].date).toBe("2026-03-10");
    jest.useRealTimers();
  });

  it("all days hidden → status noData, selectedDate null, days empty", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [];
    mockOverrides = [];

    const result = await resolveSmartSchedule("fasttrack-inja");
    expect(result!.status).toBe("noData");
    expect(result!.selectedDate).toBeNull();
    expect(result!.from).toBeNull();
    expect(result!.days).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { serviceId: "fasttrack-inja" },
      expect.stringContaining("noData"),
    );
    jest.useRealTimers();
  });

  it("unknown serviceId returns null", async () => {
    const result = await resolveSmartSchedule("nonexistent");
    expect(result).toBeNull();
  });

  it("response has correct shape", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).toMatchObject({
      serviceId: "campus-inja",
      status: "active",
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      days: expect.any(Array),
    });
    for (const day of result!.days) {
      expect(day).toMatchObject({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        dayOfWeek: expect.any(Number),
        display: expect.stringMatching(/^(schedule|noService)$/),
        schedule: expect.any(Array),
        notices: expect.any(Array),
      });
      expect(day).toHaveProperty("label");
    }
    jest.useRealTimers();
  });

  it("within suspend period → status suspended, resumeDate = until+1, no DB query", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const callsBefore = mockCollection.mock.calls.length;
    const result = await resolveSmartSchedule("campus-inja");

    expect(result!.status).toBe("suspended");
    expect(result!.resumeDate).toBe("2026-09-01");
    expect(result!.from).toBeNull();
    expect(result!.selectedDate).toBeNull();
    expect(result!.days).toHaveLength(0);
    expect(mockCollection.mock.calls.length).toBe(callsBefore);

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("outside suspend period → status active", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-02T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("active");
    expect(result!.selectedDate).not.toBeNull();

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend null → status active when schedule exists", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("active");
    jest.useRealTimers();
  });

  it("suspend boundary: until day itself → suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-31T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend boundary: day after until → not suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend boundary: from day itself → suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-21T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("suspend boundary: day before from → not suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("invalid suspend config (from > until) → ignored, logs warning", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-08-31", until: "2026-06-21" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "campus-inja", suspend: expect.any(Object) }),
      expect.stringContaining("invalid suspend config"),
    );

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("invalid suspend date format → ignored, logs warning", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "bad-date", until: "2026-08-31" };
    mockSchedules = [
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result!.status).not.toBe("suspended");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "campus-inja" }),
      expect.stringContaining("invalid suspend config"),
    );

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  it("onModuleInit warns (non-fatal) when ensureScheduleIndexes rejects", async () => {
    const { ensureScheduleIndexes } = require("../../../src/bus/schedule/schedule-db");
    ensureScheduleIndexes.mockRejectedValueOnce(new Error("idx boom"));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: "idx boom" },
      expect.stringContaining("ensureScheduleIndexes failed"),
    );
  });
});

describe("clearCacheForService", () => {
  it("clears only entries for a specific service", async () => {
    mockSchedules = [];

    await resolveWeek("campus-inja", "2026-03-09");
    await resolveWeek("campus-inja", "2026-03-16");
    const callsBefore = mockCollection.mock.calls.length;

    clearCacheForService("campus-inja");

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

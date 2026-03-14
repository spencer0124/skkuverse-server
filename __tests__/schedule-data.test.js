jest.mock("../lib/db", () => ({
  getClient: jest.fn(),
}));

jest.mock("../lib/config", () => ({
  mongo: { dbName: "test_db" },
}));

jest.mock("../lib/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const logger = require("../lib/logger");

const { getClient } = require("../lib/db");

// Mock collections
let mockSchedules = [];
let mockOverrides = [];

const mockFind = jest.fn();
const mockCollection = jest.fn();

beforeEach(() => {
  mockSchedules = [];
  mockOverrides = [];

  mockFind.mockImplementation(() => ({
    toArray: jest.fn().mockImplementation(() => {
      // Determine which collection was last requested
      const lastCall = mockCollection.mock.calls[mockCollection.mock.calls.length - 1];
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
});

// We need to require after mocks are set up
const { resolveWeek, resolveSmartSchedule, clearCache, clearCacheForService } = require("../features/bus/schedule.data");
const serviceConfig = require("../features/bus/service.config");

afterEach(() => {
  clearCache();
  jest.clearAllMocks();
});

describe("resolveWeek", () => {
  // Test 1: Pattern matching — weekday pattern
  it("weekday pattern (days:[1,2,3,4]) resolves Mon-Thu to schedule", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09"); // Monday
    expect(result).not.toBeNull();
    expect(result.days).toHaveLength(7);

    // Mon-Thu should have schedule
    for (let i = 0; i < 4; i++) {
      expect(result.days[i].display).toBe("schedule");
      expect(result.days[i].schedule).toHaveLength(1);
    }
  });

  // Test 2: Friday pattern
  it("separate friday pattern (days:[5]) resolves Friday to its entries", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
      {
        serviceId: "campus-inja",
        patternId: "friday",
        days: [5],
        entries: [{ index: 1, time: "09:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    // Friday (index 4, dayOfWeek 5)
    expect(result.days[4].display).toBe("schedule");
    expect(result.days[4].schedule[0].time).toBe("09:00");
  });

  // Test 3: No pattern for Sat/Sun + hidden fallback (campus services)
  it("Sat/Sun with no pattern and hidden fallback → display hidden", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    // Sat (index 5), Sun (index 6)
    expect(result.days[5].display).toBe("hidden");
    expect(result.days[5].schedule).toEqual([]);
    expect(result.days[6].display).toBe("hidden");
    expect(result.days[6].schedule).toEqual([]);
  });

  // Test 4: Override replace
  it("override type replace → display schedule with override entries and merged notices", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];
    mockOverrides = [
      {
        serviceId: "campus-inja",
        date: "2026-03-09",
        type: "replace",
        label: "ESKARA 1일차",
        notices: [{ style: "warning", text: "특별 운행" }],
        entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 2, notes: "special" }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result.days[0];
    expect(monday.display).toBe("schedule");
    expect(monday.label).toBe("ESKARA 1일차");
    expect(monday.schedule[0].time).toBe("10:00");
    // Notices: service notices (source:"service") + override notices (source:"override")
    const serviceNotices = monday.notices.filter((n) => n.source === "service");
    const overrideNotices = monday.notices.filter((n) => n.source === "override");
    expect(serviceNotices.length).toBeGreaterThan(0);
    expect(overrideNotices).toHaveLength(1);
    expect(overrideNotices[0].text).toBe("특별 운행");
  });

  // Test 5: Override noService
  it("override type noService → display noService, empty schedule/notices, label set", async () => {
    mockOverrides = [
      {
        serviceId: "campus-inja",
        date: "2026-03-10",
        type: "noService",
        label: "삼일절",
        notices: [],
        entries: [],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const tuesday = result.days[1]; // 2026-03-10
    expect(tuesday.display).toBe("noService");
    expect(tuesday.schedule).toEqual([]);
    expect(tuesday.notices).toEqual([]);
    expect(tuesday.label).toBe("삼일절");
  });

  // Test 6: Override takes priority over pattern
  it("override on a Monday overrides the weekday pattern", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];
    mockOverrides = [
      {
        serviceId: "campus-inja",
        date: "2026-03-09",
        type: "replace",
        label: "특별",
        notices: [],
        entries: [{ index: 1, time: "11:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    const monday = result.days[0];
    expect(monday.display).toBe("schedule");
    expect(monday.schedule[0].time).toBe("11:00");
    expect(monday.label).toBe("특별");
  });

  // Test 7: Hidden fallback for fasttrack
  it("fasttrack with hidden fallback on non-event day → display hidden", async () => {
    mockSchedules = [];

    const result = await resolveWeek("fasttrack-inja", "2026-03-09");
    expect(result).not.toBeNull();
    for (const day of result.days) {
      expect(day.display).toBe("hidden");
      expect(day.schedule).toEqual([]);
    }
  });

  // Test 8: from normalization
  it("Wednesday date normalizes to that week Monday", async () => {
    mockSchedules = [];

    const result = await resolveWeek("campus-inja", "2026-03-11"); // Wednesday
    expect(result.from).toBe("2026-03-09"); // Monday
  });

  // Test 9: from omitted
  it("from omitted defaults to current week Monday", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z")); // Tue 2026-03-10 12:00 KST
    mockSchedules = [];

    const result = await resolveWeek("campus-inja");
    expect(result.from).toBe("2026-03-09"); // Monday
    jest.useRealTimers();
  });

  // Test 10: requestedFrom tracking
  it("requestedFrom preserves original value, null if omitted", async () => {
    mockSchedules = [];

    const result1 = await resolveWeek("campus-inja", "2026-03-11");
    expect(result1.requestedFrom).toBe("2026-03-11");

    clearCache();
    const result2 = await resolveWeek("campus-inja");
    expect(result2.requestedFrom).toBeNull();
  });

  // Test 11: Unknown serviceId
  it("unknown serviceId returns null", async () => {
    const result = await resolveWeek("nonexistent-service", "2026-03-09");
    expect(result).toBeNull();
  });

  // Test 12: Cache hit
  it("second call with same key does not re-query DB", async () => {
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    await resolveWeek("campus-inja", "2026-03-09");
    const callCount = mockCollection.mock.calls.length;

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBe(callCount); // no new DB calls
  });

  // Test 13: Cache expiry
  it("after 1hr TTL, re-queries DB", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T00:00:00.000Z"));
    mockSchedules = [];

    await resolveWeek("campus-inja", "2026-03-09");
    const callCount = mockCollection.mock.calls.length;

    // Advance past 1hr
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    await resolveWeek("campus-inja", "2026-03-09");
    expect(mockCollection.mock.calls.length).toBeGreaterThan(callCount);
    jest.useRealTimers();
  });

  // Test 14: Always 7 days
  it("always returns exactly 7 days Mon-Sun in order", async () => {
    mockSchedules = [];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result.days).toHaveLength(7);
    expect(result.days[0].dayOfWeek).toBe(1); // Mon
    expect(result.days[6].dayOfWeek).toBe(7); // Sun
    for (let i = 0; i < 7; i++) {
      expect(result.days[i].dayOfWeek).toBe(i + 1);
    }
  });

  // Additional: response shape
  it("response has correct top-level shape", async () => {
    mockSchedules = [];

    const result = await resolveWeek("campus-inja", "2026-03-09");
    expect(result).toMatchObject({
      serviceId: "campus-inja",
      requestedFrom: "2026-03-09",
      from: "2026-03-09",
    });
    expect(result.days).toHaveLength(7);
    expect(result.days[0]).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dayOfWeek: expect.any(Number),
      display: expect.stringMatching(/^(schedule|noService|hidden)$/),
      schedule: expect.any(Array),
      notices: expect.any(Array),
    });
    expect(result.days[0]).toHaveProperty("label");
  });
});

describe("resolveSmartSchedule", () => {
  // Test 1: Weekday — selectedDate is today
  it("on a weekday with schedule, selectedDate = today and hidden days filtered", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z")); // Tue 2026-03-10 12:00 KST
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).not.toBeNull();
    expect(result.selectedDate).toBe("2026-03-10");
    expect(result.from).toBe("2026-03-09"); // Monday of this week
    // No hidden days (Sat/Sun are hidden → filtered out)
    expect(result.days.every((d) => d.display !== "hidden")).toBe(true);
    // Only Mon-Fri visible
    expect(result.days).toHaveLength(5);
    jest.useRealTimers();
  });

  // Test 2: Saturday — cross-week to next Monday
  it("on Saturday, selectedDate crosses to next week Monday", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-14T03:00:00.000Z")); // Sat 2026-03-14 12:00 KST
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.selectedDate).toBe("2026-03-16"); // Next Monday
    expect(result.from).toBe("2026-03-16"); // Next week
    expect(result.days).toHaveLength(5); // Only Mon-Fri
    jest.useRealTimers();
  });

  // Test 3: Holiday override — selectedDate skips to next schedule day
  it("holiday (noService override) on today, selectedDate skips to next schedule day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z")); // Mon 2026-03-09 12:00 KST
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];
    mockOverrides = [
      {
        serviceId: "campus-inja",
        date: "2026-03-09",
        type: "noService",
        label: "공휴일",
        notices: [],
        entries: [],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.selectedDate).toBe("2026-03-10"); // Tuesday (first schedule day)
    // Holiday chip is still visible
    const holidayDay = result.days.find((d) => d.date === "2026-03-09");
    expect(holidayDay).toBeDefined();
    expect(holidayDay.display).toBe("noService");
    expect(holidayDay.label).toBe("공휴일");
    jest.useRealTimers();
  });

  // Test 4: Fasttrack — only override days visible
  it("fasttrack with only override days → only those days visible", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z")); // Mon 2026-03-09
    mockSchedules = [];
    mockOverrides = [
      {
        serviceId: "fasttrack-inja",
        date: "2026-03-09",
        type: "replace",
        label: "ESKARA 1일차",
        notices: [],
        entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }],
      },
      {
        serviceId: "fasttrack-inja",
        date: "2026-03-10",
        type: "replace",
        label: "ESKARA 2일차",
        notices: [],
        entries: [{ index: 1, time: "10:00", routeType: "fasttrack", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("fasttrack-inja");
    expect(result.selectedDate).toBe("2026-03-09");
    // Only 2 visible days (the overrides), rest are hidden
    expect(result.days).toHaveLength(2);
    expect(result.days[0].date).toBe("2026-03-09");
    expect(result.days[1].date).toBe("2026-03-10");
    jest.useRealTimers();
  });

  // Test 5: No operating days → status noData
  it("all days hidden → status noData, selectedDate null, days empty", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-09T03:00:00.000Z"));
    mockSchedules = [];
    mockOverrides = [];

    const result = await resolveSmartSchedule("fasttrack-inja");
    expect(result.status).toBe("noData");
    expect(result.selectedDate).toBeNull();
    expect(result.from).toBeNull();
    expect(result.days).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { serviceId: "fasttrack-inja" },
      expect.stringContaining("noData"),
    );
    jest.useRealTimers();
  });

  // Test 6: Unknown serviceId
  it("unknown serviceId returns null", async () => {
    const result = await resolveSmartSchedule("nonexistent");
    expect(result).toBeNull();
  });

  // Test 7: Response shape
  it("response has correct shape", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z")); // Tuesday
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result).toMatchObject({
      serviceId: "campus-inja",
      status: "active",
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      days: expect.any(Array),
    });
    for (const day of result.days) {
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
  // Test 8: suspend period — returns suspended, DB queries 0
  it("within suspend period → status suspended, resumeDate = until+1, no DB query", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z")); // mid-summer
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const callsBefore = mockCollection.mock.calls.length;
    const result = await resolveSmartSchedule("campus-inja");

    expect(result.status).toBe("suspended");
    expect(result.resumeDate).toBe("2026-09-01");
    expect(result.from).toBeNull();
    expect(result.selectedDate).toBeNull();
    expect(result.days).toHaveLength(0);
    // No DB queries made
    expect(mockCollection.mock.calls.length).toBe(callsBefore);

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 9: outside suspend period → status active
  it("outside suspend period → status active", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-02T03:00:00.000Z")); // after suspend
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).toBe("active");
    expect(result.selectedDate).not.toBeNull();

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 10: suspend null → status active
  it("suspend null → status active when schedule exists", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).toBe("active");
    jest.useRealTimers();
  });

  // Test 11: suspend boundary — until day → suspended
  it("suspend boundary: until day itself → suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-31T03:00:00.000Z")); // exactly until day
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 12: suspend boundary — day after until → active (or noData)
  it("suspend boundary: day after until → not suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T03:00:00.000Z")); // until + 1
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).not.toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 13: suspend boundary — from day itself → suspended
  it("suspend boundary: from day itself → suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-21T03:00:00.000Z")); // exactly from day
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 14: suspend boundary — day before from → not suspended
  it("suspend boundary: day before from → not suspended", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T03:00:00.000Z")); // from - 1
    serviceConfig["campus-inja"].suspend = { from: "2026-06-21", until: "2026-08-31" };
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).not.toBe("suspended");

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 15: invalid suspend config → ignored with logger.warn
  it("invalid suspend config (from > until) → ignored, logs warning", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "2026-08-31", until: "2026-06-21" }; // inverted
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).not.toBe("suspended");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "campus-inja", suspend: expect.any(Object) }),
      expect.stringContaining("invalid suspend config"),
    );

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
  });

  // Test 16: invalid suspend date format → ignored with logger.warn
  it("invalid suspend date format → ignored, logs warning", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    serviceConfig["campus-inja"].suspend = { from: "bad-date", until: "2026-08-31" };
    mockSchedules = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
      },
    ];

    const result = await resolveSmartSchedule("campus-inja");
    expect(result.status).not.toBe("suspended");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "campus-inja" }),
      expect.stringContaining("invalid suspend config"),
    );

    serviceConfig["campus-inja"].suspend = null;
    jest.useRealTimers();
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

/**
 * Mock factories for the three bus-schedule modules that supertest files
 * mock together: `schedule.data`, `schedule-db`, `campus-eta.data`. Exposed
 * as named factories so each can be wired independently into its own
 * `jest.mock(path, factory)` call.
 *
 * `scheduleData` includes `resolveSmartSchedule` as a bare jest.fn() in the
 * default; only schedule-routes.test.js uses it and overrides via beforeEach.
 * For other consumers the extra key is unused and harmless.
 */
interface ScheduleDataOptions {
  resolveWeek?: jest.Mock;
  resolveSmartSchedule?: jest.Mock;
}

interface CampusEtaDataOptions {
  eta?: { inja: unknown; jain: unknown };
}

function scheduleData({
  resolveWeek = jest.fn().mockResolvedValue(null),
  resolveSmartSchedule = jest.fn(),
}: ScheduleDataOptions = {}) {
  return {
    resolveWeek,
    resolveSmartSchedule,
    clearCache: jest.fn(),
    clearCacheForService: jest.fn(),
  };
}

function scheduleDb() {
  return {
    ensureScheduleIndexes: jest.fn().mockResolvedValue(undefined),
  };
}

function campusEtaData({
  eta = { inja: null, jain: null },
}: CampusEtaDataOptions = {}) {
  return {
    getEtaData: jest.fn().mockResolvedValue(eta),
    clearCache: jest.fn(),
  };
}

export = { scheduleData, scheduleDb, campusEtaData };

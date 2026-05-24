/**
 * Mock factories for the three bus-schedule modules that supertest files
 * mock together: `schedule.data`, `schedule-db`, `campus-eta.data`. Exposed
 * as named factories so each can be wired independently into its own
 * `jest.mock(path, factory)` call.
 *
 * `scheduleData` includes `resolveSmartSchedule` as a bare jest.fn() in the
 * default; only schedule-routes.test.js uses it and overrides via beforeEach.
 * For other consumers the extra key is unused and harmless.
 *
 * Usage:
 *   const bus = require("./helpers/mocks/busSchedule");
 *   jest.mock("../features/bus/schedule.data", () => bus.scheduleData());
 *   jest.mock("../features/bus/schedule-db",   () => bus.scheduleDb());
 *   jest.mock("../features/bus/campus-eta.data", () => bus.campusEtaData());
 *
 * TODO(ts): type each factory against its source module's typeof.
 */

function scheduleData({
  resolveWeek = jest.fn().mockResolvedValue(null),
  resolveSmartSchedule = jest.fn(),
} = {}) {
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

function campusEtaData({ eta = { inja: null, jain: null } } = {}) {
  return {
    getEtaData: jest.fn().mockResolvedValue(eta),
    clearCache: jest.fn(),
  };
}

module.exports = { scheduleData, scheduleDb, campusEtaData };

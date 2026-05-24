/**
 * Mock factory for `../lib/busCache`. Used by supertest files that mount the
 * full Express app — busCache is touched during bootstrap (ensureIndex) and
 * by realtime route handlers (cachedRead). Default behavior: every read returns
 * null so routes fall back to in-memory fetcher getters.
 *
 * Override `cachedRead` when a route needs to see a specific cached payload
 * (e.g., route-responses.test.js historically swaps it per test).
 *
 * Usage:
 *   jest.mock("../lib/busCache", () => require("./helpers/mocks/busCache")());
 *   jest.mock("../lib/busCache", () =>
 *     require("./helpers/mocks/busCache")({ cachedRead: customFn })
 *   );
 *
 * TODO(ts): type as jest.Mocked<typeof import("../../../lib/busCache")>.
 */
module.exports = function makeBusCacheMock({
  cachedRead,
  read,
} = {}) {
  return {
    ensureIndex: jest.fn().mockResolvedValue(undefined),
    write: jest.fn().mockResolvedValue(undefined),
    read: read || jest.fn().mockResolvedValue(null),
    cachedRead: cachedRead || jest.fn().mockResolvedValue(null),
  };
};

/**
 * Mock factory for `../features/ad/ad.data`. Used by supertest files that mount
 * the full Express app — ad.data is touched during bootstrap (ensureIndexes,
 * seedIfEmpty) and by /ad/placements route handlers (getPlacements).
 *
 * Variation across files: `getPlacements` returns either an empty object
 * (app-config, bus-config-routes, schedule-routes), a minimal splash-only
 * shape (route-responses, security), or the full 4-placement detail
 * (static-endpoints). Use the `placements` option to pin the return value.
 *
 * Usage:
 *   jest.mock("../features/ad/ad.data", () => require("./helpers/mocks/adData")());
 *   jest.mock("../features/ad/ad.data", () =>
 *     require("./helpers/mocks/adData")({
 *       placements: { splash: { type: "image", ... } },
 *     })
 *   );
 *
 * Note: `weightedRandomSelect`, `getAdsCollection`, `getEventsCollection` are
 * exposed as bare jest.fn() because no consumer asserts on their behavior at
 * the route layer. Callers needing specific return values should pass them via
 * `overrides`.
 *
 * TODO(ts): type as jest.Mocked<typeof import("../../../features/ad/ad.data")>.
 */
module.exports = function makeAdDataMock({ placements = {}, ...overrides } = {}) {
  return {
    getPlacements: jest.fn().mockResolvedValue(placements),
    ensureIndexes: jest.fn().mockResolvedValue(undefined),
    seedIfEmpty: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn(),
    weightedRandomSelect: jest.fn(),
    getAdsCollection: jest.fn(),
    getEventsCollection: jest.fn(),
    FALLBACK_PLACEMENTS: {},
    ...overrides,
  };
};

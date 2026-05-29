/**
 * Mock factory for `../features/ad/ad.data`. Used by supertest files that mount
 * the full Express app — ad.data is touched during bootstrap (ensureIndexes,
 * seedIfEmpty) and by /ad/placements route handlers (getPlacements).
 *
 * Variation across files: `getPlacements` returns either an empty object
 * (app-config, bus-config-routes, schedule-routes), a minimal splash-only
 * shape (route-responses, security), or the full 4-placement detail
 * (static-endpoints). Use the `placements` option to pin the return value.
 */
interface AdDataMockOptions {
  placements?: Record<string, unknown>;
  [k: string]: unknown;
}

const makeAdDataMock = ({
  placements = {},
  ...overrides
}: AdDataMockOptions = {}) => ({
  getPlacements: jest.fn().mockResolvedValue(placements),
  ensureIndexes: jest.fn().mockResolvedValue(undefined),
  seedIfEmpty: jest.fn().mockResolvedValue(undefined),
  clearCache: jest.fn(),
  weightedRandomSelect: jest.fn(),
  getAdsCollection: jest.fn(),
  getEventsCollection: jest.fn(),
  FALLBACK_PLACEMENTS: {},
  ...overrides,
});

export = makeAdDataMock;

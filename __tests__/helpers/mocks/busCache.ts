/**
 * Mock factory for `../lib/busCache`. Used by supertest files that mount the
 * full Express app — busCache is touched during bootstrap (ensureIndex) and
 * by realtime route handlers (cachedRead). Default behavior: every read returns
 * null so routes fall back to in-memory fetcher getters.
 *
 * Override `cachedRead` when a route needs to see a specific cached payload.
 */
interface BusCacheMockOptions {
  cachedRead?: jest.Mock;
  read?: jest.Mock;
}

const makeBusCacheMock = ({ cachedRead, read }: BusCacheMockOptions = {}) => ({
  ensureIndex: jest.fn().mockResolvedValue(undefined),
  write: jest.fn().mockResolvedValue(undefined),
  read: read || jest.fn().mockResolvedValue(null),
  cachedRead: cachedRead || jest.fn().mockResolvedValue(null),
});

export = makeBusCacheMock;

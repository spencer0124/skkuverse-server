/**
 * Mock factory for `../features/ad/ad.stats`. Used by supertest files that
 * mount the full Express app — ad.stats is wired into the request path for
 * impression/click event recording and needs to be no-op'd to avoid Mongo writes.
 *
 * Shape is uniform across all consumers (recordEvent + getStats both resolve
 * to empty). security.test.js historically only stubbed recordEvent; exposing
 * getStats too is harmless since unused keys are ignored.
 *
 * TODO(ts): type as jest.Mocked<typeof import("../../../features/ad/ad.stats")>.
 */
module.exports = function makeAdStatsMock() {
  return {
    recordEvent: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn().mockResolvedValue({}),
  };
};

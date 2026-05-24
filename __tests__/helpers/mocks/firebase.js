/**
 * Mock factory for `../lib/firebase` used by supertest files that mount the
 * full Express app via `require("../index")`.
 *
 * Every supertest file that mounts the full app needs to stub Firebase Admin
 * so the auth middleware does not try to initialize a real service account.
 * The shape is uniform across all consumers; only the test `uid` varies
 * (most files use "test-uid", security.test.js uses "test-uid-123").
 *
 * Each `jest.mock("../lib/firebase", () => makeFirebaseMock())` call gets a
 * FRESH mock object — state never leaks across test files because jest.mock
 * factories are evaluated per-file.
 *
 * Usage:
 *   jest.mock("../lib/firebase", () => require("./helpers/mocks/firebase")());
 *   jest.mock("../lib/firebase", () => require("./helpers/mocks/firebase")({ uid: "alice" }));
 *
 * TODO(ts): type the return as jest.Mocked<typeof import("../../lib/firebase")>.
 */
module.exports = function makeFirebaseMock({ uid = "test-uid", verifyIdToken } = {}) {
  return {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: verifyIdToken || jest.fn().mockResolvedValue({ uid }),
    }),
  };
};

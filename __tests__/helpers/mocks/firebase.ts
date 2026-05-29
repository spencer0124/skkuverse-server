/**
 * Mock factory for `../lib/firebase` used by supertest files that mount the
 * full Express app via `require("../index")`.
 *
 * Each `jest.mock("../lib/firebase", () => makeFirebaseMock())` call gets a
 * FRESH mock object — state never leaks across test files because jest.mock
 * factories are evaluated per-file.
 *
 * Usage:
 *   jest.mock("../lib/firebase", () => require("./helpers/mocks/firebase")());
 *   jest.mock("../lib/firebase", () => require("./helpers/mocks/firebase")({ uid: "alice" }));
 */
interface FirebaseMockOptions {
  uid?: string;
  verifyIdToken?: jest.Mock;
}

const makeFirebaseMock = ({
  uid = "test-uid",
  verifyIdToken,
}: FirebaseMockOptions = {}) => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: verifyIdToken || jest.fn().mockResolvedValue({ uid }),
  }),
});

export = makeFirebaseMock;

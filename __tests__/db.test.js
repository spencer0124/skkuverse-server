/**
 * Tests for lib/db — MongoClient singleton + ping.
 *
 * Strategy:
 *   - Mock `mongodb` so `new MongoClient(...)` is observable without an actual
 *     network handle. Each `MongoClient` instance gets `close()` and `db()`
 *     stubs the test can assert on.
 *   - `jest.resetModules()` per test resets the module-level `client` singleton.
 */

const mockClose = jest.fn().mockResolvedValue(undefined);
const mockCommand = jest.fn().mockResolvedValue({ ok: 1 });
const mockDb = jest.fn().mockReturnValue({ command: mockCommand });
const ctorCalls = [];

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation((url, opts) => {
    const inst = { close: mockClose, db: mockDb };
    ctorCalls.push({ url, opts, inst });
    return inst;
  }),
}));

describe("lib/db", () => {
  let db;
  let MongoClient;

  beforeEach(() => {
    jest.resetModules();
    ctorCalls.length = 0;
    mockClose.mockClear();
    mockCommand.mockClear();
    mockDb.mockClear();
    db = require("../lib/db");
    MongoClient = require("mongodb").MongoClient;
    MongoClient.mockClear();
  });

  describe("getClient", () => {
    it("constructs MongoClient with the configured url and pool sizes on first call", () => {
      const client = db.getClient();
      expect(MongoClient).toHaveBeenCalledTimes(1);
      const [url, opts] = MongoClient.mock.calls[0];
      // jest.setup.js sets MONGO_URL=mongodb://localhost:27017
      expect(url).toBe("mongodb://localhost:27017");
      expect(opts).toEqual({ maxPoolSize: 5, minPoolSize: 1 });
      expect(client).toBe(ctorCalls[0].inst);
    });

    it("returns the same instance on subsequent calls (singleton)", () => {
      const first = db.getClient();
      const second = db.getClient();
      expect(second).toBe(first);
      expect(MongoClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("closeClient", () => {
    it("closes the active client and clears the singleton", async () => {
      const client = db.getClient();
      await db.closeClient();
      expect(mockClose).toHaveBeenCalledTimes(1);
      // After close, a new client is constructed on next getClient
      const fresh = db.getClient();
      expect(MongoClient).toHaveBeenCalledTimes(2);
      expect(fresh).not.toBe(client);
    });

    it("is a no-op when no client was constructed", async () => {
      await expect(db.closeClient()).resolves.toBeUndefined();
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("ping", () => {
    it("issues { ping: 1 } against the admin database", async () => {
      await db.ping();
      expect(mockDb).toHaveBeenCalledWith("admin");
      expect(mockCommand).toHaveBeenCalledWith({ ping: 1 });
    });

    it("lazily constructs the client if not yet initialized", async () => {
      expect(MongoClient).not.toHaveBeenCalled();
      await db.ping();
      expect(MongoClient).toHaveBeenCalledTimes(1);
    });

    it("propagates command failures", async () => {
      mockCommand.mockRejectedValueOnce(new Error("server selection timed out"));
      await expect(db.ping()).rejects.toThrow("server selection timed out");
    });
  });
});

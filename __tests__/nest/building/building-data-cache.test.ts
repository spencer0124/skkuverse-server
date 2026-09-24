/**
 * The building list and the campus shapes are read on every map open and every
 * /building/* request, so both sit behind a single-flight cache. What matters:
 * concurrent requests cost one scan, a sync's clearCache() forces the next read
 * back to the database, a buildings failure still reaches the caller (that is
 * what marks the campus overlay degraded), and a shapes failure serves the last
 * good shapes rather than an outline-less map cached for a day.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../../src/infra/logger", () => mockLogger);

const toArrayFor: Record<string, jest.Mock> = {
  buildings: jest.fn(),
  campus_shapes: jest.fn(),
};
const findFor: Record<string, jest.Mock> = {};
for (const name of Object.keys(toArrayFor)) {
  findFor[name] = jest.fn(() => ({
    sort: jest.fn(() => ({ toArray: toArrayFor[name] })),
  }));
}

jest.mock("../../../src/infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../../src/infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: jest.fn(() => ({ collection: (name: string) => ({ find: findFor[name] }) })),
  })),
}));

import {
  clearCache,
  getAllBuildings,
  getAllCampusShapes,
} from "../../../src/building/building.data";
import { HOT_READ_MAX_TIME_MS } from "../../../src/infra/db";

const HSSC = { _id: 1, campus: "hssc" };
const NSC = { _id: 2, campus: "nsc" };
const SHAPE = { _id: "wall", order: 1 };
const FIVE_MIN = 5 * 60 * 1000;

let clock = 1_000_000;
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  toArrayFor.buildings!.mockResolvedValue([HSSC, NSC]);
  toArrayFor.campus_shapes!.mockResolvedValue([SHAPE]);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("getAllBuildings", () => {
  it("scans once for concurrent requests, and filters the cached list by campus", async () => {
    const [all, hssc, nsc] = await Promise.all([
      getAllBuildings(),
      getAllBuildings("hssc"),
      getAllBuildings("nsc"),
    ]);
    expect(all).toEqual([HSSC, NSC]);
    expect(hssc).toEqual([HSSC]);
    expect(nsc).toEqual([NSC]);
    expect(findFor.buildings).toHaveBeenCalledTimes(1);
    expect(findFor.buildings!.mock.calls[0]![1]).toMatchObject({
      maxTimeMS: HOT_READ_MAX_TIME_MS,
    });
  });

  it("re-reads after clearCache(), which the building sync calls after writing", async () => {
    await getAllBuildings();
    clearCache();
    await getAllBuildings();
    expect(findFor.buildings).toHaveBeenCalledTimes(2);
  });

  it("re-reads once the TTL has passed", async () => {
    await getAllBuildings();
    clock += FIVE_MIN;
    await getAllBuildings();
    expect(findFor.buildings).toHaveBeenCalledTimes(2);
  });

  it("still surfaces a failed read, which is what marks the overlay degraded", async () => {
    await getAllBuildings();
    toArrayFor.buildings!.mockRejectedValue(new Error("mongo down"));
    clock += FIVE_MIN;
    await expect(getAllBuildings()).rejects.toThrow("mongo down");
  });
});

describe("getAllCampusShapes", () => {
  it("is cached like the buildings", async () => {
    await Promise.all([getAllCampusShapes(), getAllCampusShapes()]);
    await getAllCampusShapes();
    expect(findFor.campus_shapes).toHaveBeenCalledTimes(1);
    expect(findFor.campus_shapes!.mock.calls[0]).toEqual([
      {},
      { maxTimeMS: HOT_READ_MAX_TIME_MS },
    ]);
  });

  it("serves the last good shapes when a re-read fails, with a warning", async () => {
    await getAllCampusShapes();
    toArrayFor.campus_shapes!.mockRejectedValue(new Error("mongo down"));
    clock += FIVE_MIN;
    await expect(getAllCampusShapes()).resolves.toEqual([SHAPE]);
    // Answered from the old shapes at once; the failed reload logs behind it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it("re-reads after clearCache()", async () => {
    await getAllCampusShapes();
    clearCache();
    await getAllCampusShapes();
    expect(findFor.campus_shapes).toHaveBeenCalledTimes(2);
  });
});

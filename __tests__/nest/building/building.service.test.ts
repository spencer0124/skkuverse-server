/**
 * Unit test for BuildingService — verifies it delegates 1:1 to
 * features/building/building.data (mocked) and that onModuleInit reproduces the
 * index.ts:197-203 NON-FATAL ensureIndexes contract (success logs + swallowed
 * failure, never throws).
 */

jest.mock("../../../features/building/building.data", () => ({
  ensureIndexes: jest.fn(),
  getAllBuildings: jest.fn(),
  getBuildingBySkkuId: jest.fn(),
  getFloorsByBuildNo: jest.fn(),
  getConnectionsForBuilding: jest.fn(),
  searchBuildings: jest.fn(),
  searchSpaces: jest.fn(),
  countSearchBuildings: jest.fn(),
  countSearchSpaces: jest.fn(),
}));

import * as data from "../../../features/building/building.data";
import { BuildingService } from "../../../src/building/building.service";

const mocked = data as jest.Mocked<typeof data>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingService.onModuleInit (non-fatal ensureIndexes)", () => {
  it("calls ensureIndexes on success", async () => {
    mocked.ensureIndexes.mockResolvedValue(undefined);
    const svc = new BuildingService();
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(mocked.ensureIndexes).toHaveBeenCalledTimes(1);
  });

  it("swallows ensureIndexes failure (warn-and-continue, no throw)", async () => {
    mocked.ensureIndexes.mockRejectedValue(new Error("no db"));
    const svc = new BuildingService();
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(mocked.ensureIndexes).toHaveBeenCalledTimes(1);
  });
});

describe("BuildingService delegation", () => {
  const svc = new BuildingService();

  it("getAllBuildings forwards campus arg", async () => {
    mocked.getAllBuildings.mockResolvedValue([]);
    await svc.getAllBuildings("hssc");
    expect(mocked.getAllBuildings).toHaveBeenCalledWith("hssc");
    await svc.getAllBuildings();
    expect(mocked.getAllBuildings).toHaveBeenLastCalledWith(undefined);
  });

  it("getBuildingBySkkuId forwards id", async () => {
    mocked.getBuildingBySkkuId.mockResolvedValue(null);
    await svc.getBuildingBySkkuId(7);
    expect(mocked.getBuildingBySkkuId).toHaveBeenCalledWith(7);
  });

  it("getFloorsByBuildNo forwards buildNo", async () => {
    mocked.getFloorsByBuildNo.mockResolvedValue([]);
    await svc.getFloorsByBuildNo("100");
    expect(mocked.getFloorsByBuildNo).toHaveBeenCalledWith("100");
  });

  it("getConnectionsForBuilding forwards id", async () => {
    mocked.getConnectionsForBuilding.mockResolvedValue([]);
    await svc.getConnectionsForBuilding(3);
    expect(mocked.getConnectionsForBuilding).toHaveBeenCalledWith(3);
  });

  it("searchBuildings / searchSpaces forward query + campus", async () => {
    mocked.searchBuildings.mockResolvedValue([]);
    mocked.searchSpaces.mockResolvedValue([]);
    await svc.searchBuildings("law", "nsc");
    await svc.searchSpaces("law", null);
    expect(mocked.searchBuildings).toHaveBeenCalledWith("law", "nsc");
    expect(mocked.searchSpaces).toHaveBeenCalledWith("law", null);
  });

  it("countSearchBuildings / countSearchSpaces forward query", async () => {
    mocked.countSearchBuildings.mockResolvedValue({ hssc: 0, nsc: 0, total: 0 });
    mocked.countSearchSpaces.mockResolvedValue({ hssc: 0, nsc: 0, total: 0 });
    await svc.countSearchBuildings("q");
    await svc.countSearchSpaces("q");
    expect(mocked.countSearchBuildings).toHaveBeenCalledWith("q");
    expect(mocked.countSearchSpaces).toHaveBeenCalledWith("q");
  });
});

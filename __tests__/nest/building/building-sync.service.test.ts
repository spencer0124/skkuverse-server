/**
 * Unit test for BuildingSyncService — verifies it registers syncBuildings()
 * with the Nest PollerRegistry under name "building-sync" at the configured
 * interval, and that the registered wrapper swallows a syncBuildings rejection
 * (logs "[building-sync] Poller error", never rethrows). syncBuildings is
 * mocked so neither lib/db nor the SKKU API is touched.
 */

jest.mock("../../../features/building/building.sync", () => ({
  syncBuildings: jest.fn(),
}));

import config from "../../../lib/config";
import { syncBuildings } from "../../../features/building/building.sync";
import { BuildingSyncService } from "../../../src/building/building-sync.service";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";

const mockedSync = syncBuildings as jest.MockedFunction<typeof syncBuildings>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingSyncService.onModuleInit", () => {
  it("registers a 'building-sync' poller at config.building.syncIntervalMs", () => {
    const registry = new PollerRegistryService();
    const spy = jest.spyOn(registry, "registerPoller");
    const svc = new BuildingSyncService(registry);
    svc.onModuleInit();

    expect(spy).toHaveBeenCalledTimes(1);
    const [fn, intervalMs, name] = spy.mock.calls[0]!;
    expect(intervalMs).toBe(config.building.syncIntervalMs);
    expect(name).toBe("building-sync");
    expect(typeof fn).toBe("function");
  });

  it("registered fn invokes syncBuildings and swallows its rejection", async () => {
    const registry = new PollerRegistryService();
    const spy = jest.spyOn(registry, "registerPoller");
    new BuildingSyncService(registry).onModuleInit();
    const fn = spy.mock.calls[0]![0];

    mockedSync.mockRejectedValueOnce(new Error("crawl failed"));
    await expect(Promise.resolve(fn())).resolves.toBeUndefined();
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("registered fn resolves on syncBuildings success", async () => {
    const registry = new PollerRegistryService();
    const spy = jest.spyOn(registry, "registerPoller");
    new BuildingSyncService(registry).onModuleInit();
    const fn = spy.mock.calls[0]![0];

    mockedSync.mockResolvedValueOnce(undefined);
    await expect(Promise.resolve(fn())).resolves.toBeUndefined();
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });
});

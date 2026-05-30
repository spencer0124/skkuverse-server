/**
 * Nest port of jongro-transform.test.ts — JongroPollerService is the exact port
 * of features/bus/jongro.fetcher.ts.
 *
 * The single 40s poller tick iterates the registry and calls the (private)
 * list + loc updaters per route. We capture the registered tick fn via the
 * registry stub and invoke it directly (deterministic, no fake timers), with
 * axios mocked to return the same shape to every URL — so both registered codes
 * ("02","07") get populated, matching the Express test's "both get the same
 * data" behavior. carNumber slice(-4), the stId→staOrd mapping, and the
 * location station-name mapping are asserted verbatim.
 */

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { JongroPollerService } from "../../../src/bus/fetchers/jongro.poller.service";
import { jongroRoutes } from "../../../src/bus/registry/jongro-registry";
import type { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import type { BusCacheService } from "../../../src/bus/cache/bus-cache.service";

const axios = require("axios");

let capturedTick: () => void;
const registryStub = {
  registerPoller: jest.fn((fn: () => void) => {
    capturedTick = fn;
  }),
} as unknown as PollerRegistryService;
const cacheStub = { write: jest.fn().mockResolvedValue(undefined) } as unknown as BusCacheService;

let service: JongroPollerService;

async function runTickAndFlush(): Promise<void> {
  capturedTick();
  // Flush the per-route list+loc promises (no setInterval involved).
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  service = new JongroPollerService(registryStub, cacheStub, jongroRoutes);
  service.onModuleInit();
});

describe("JongroPollerService", () => {
  it("onModuleInit registers a 40s 'jongro' poller", () => {
    expect(registryStub.registerPoller).toHaveBeenCalledWith(
      expect.any(Function),
      40000,
      "jongro",
    );
  });

  describe("getJongroBusList", () => {
    it("initially returns undefined for uninitialized codes", () => {
      expect(service.getJongroBusList("07")).toBeUndefined();
      expect(service.getJongroBusList("02")).toBeUndefined();
    });

    it("maps bus list data correctly after a tick", async () => {
      axios.get.mockResolvedValue({
        data: {
          msgHeader: { headerCd: "0" },
          msgBody: {
            itemList: [
              {
                stId: "100900197",
                staOrd: "1",
                stNm: "명륜새마을금고",
                plainNo1: "서울74사5537",
                mkTm: "2024-01-01 12:00:00",
                arsId: "01504",
                arrmsg1: "3분후[1번째 전]",
              },
            ],
          },
        },
      });

      await runTickAndFlush();

      const result = service.getJongroBusList("07");
      expect(result).toHaveLength(1);
      expect(result![0]).toMatchObject({
        stationId: "100900197",
        sequence: "1",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        stationNumber: "01504",
        eta: "3분후[1번째 전]",
      });
    });

    it("extracts last 4 chars of plainNo1 as carNumber", async () => {
      axios.get.mockResolvedValue({
        data: {
          msgHeader: { headerCd: "0" },
          msgBody: {
            itemList: [
              {
                stId: "100900204",
                staOrd: "1",
                stNm: "성균관대학교",
                plainNo1: "서울74사1234",
                mkTm: "2024-01-01 12:00:00",
                arsId: "01881",
                arrmsg1: "곧 도착",
              },
            ],
          },
        },
      });

      await runTickAndFlush();

      const result07 = service.getJongroBusList("07");
      const result02 = service.getJongroBusList("02");
      const result = result07 && result07.length > 0 ? result07 : result02!;
      expect(result[0].carNumber).toBe("1234");
    });
  });

  describe("getJongroBusLocation", () => {
    it("maps location data with station mapping", async () => {
      axios.get.mockResolvedValue({
        data: {
          msgHeader: { headerCd: "0" },
          msgBody: {
            itemList: [
              {
                lastStnId: "100900197",
                tmX: "126.998",
                tmY: "37.587",
                plainNo: "서울74사5537",
              },
            ],
          },
        },
      });

      await runTickAndFlush();

      const result = service.getJongroBusLocation("07");
      expect(result).toHaveLength(1);
      expect(result![0]).toMatchObject({
        sequence: "1",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        latitude: "37.587",
        longitude: "126.998",
      });
      expect(result![0].estimatedTime).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("handles API error without crash (state stays undefined)", async () => {
      axios.get.mockRejectedValue(new Error("Network error"));
      await runTickAndFlush();
      expect(service.getJongroBusList("07")).toBeUndefined();
    });

    it("handles empty itemList → empty list array", async () => {
      axios.get.mockResolvedValue({
        data: { msgHeader: { headerCd: "0" }, msgBody: { itemList: [] } },
      });
      await runTickAndFlush();
      expect(service.getJongroBusList("07")).toHaveLength(0);
    });
  });
});

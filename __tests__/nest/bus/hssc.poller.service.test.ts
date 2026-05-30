/**
 * Nest port of hssc-transform.test.ts — HsscPollerService is the exact port of
 * features/bus/hssc.fetcher.ts.
 *
 * The Express test drives the transform via a setInterval tick; here we call
 * updateHSSCBusList() directly (deterministic, no fake-timer plumbing) with
 * axios mocked. The registry + cache deps are inert stubs. lib/config is the
 * real module (jest.setup supplies API_HSSC_NEW_PROD). Stale thresholds,
 * stopNameMapping, and the circular→linear sequence math are asserted verbatim.
 */

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import "moment/locale/ko";
import moment from "moment-timezone";
import { HsscPollerService } from "../../../src/bus/fetchers/hssc.poller.service";
import type { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import type { BusCacheService } from "../../../src/bus/cache/bus-cache.service";

const axios = require("axios");

function koreanNow(offsetMinutes = 0): string {
  const t = moment().tz("Asia/Seoul");
  if (offsetMinutes) t.subtract(offsetMinutes, "minutes");
  return t.locale("ko").format("YYYY-MM-DD a h:mm:ss");
}

function createApiItem(
  stop_name: string,
  seq: string,
  get_date: string,
  line_no = "1",
  stop_no = "1",
) {
  return { stop_name, seq, get_date, line_no, stop_no };
}

const registryStub = { registerPoller: jest.fn() } as unknown as PollerRegistryService;
const cacheStub = { write: jest.fn().mockResolvedValue(undefined) } as unknown as BusCacheService;

let service: HsscPollerService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new HsscPollerService(registryStub, cacheStub);
});

describe("HsscPollerService", () => {
  it("onModuleInit registers a 10s 'hssc' poller", () => {
    service.onModuleInit();
    expect(registryStub.registerPoller).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      "hssc",
    );
  });

  it("initially returns empty array", () => {
    expect(service.getHSSCBusList()).toEqual([]);
  });

  describe("stopNameMapping", () => {
    it("maps 농구장정류소 correctly", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("농구장정류소", "5", koreanNow())] });
      await service.updateHSSCBusList();
      const result = service.getHSSCBusList();
      expect(result.length).toBe(1);
      expect(result[0].stationName).toBe("농구장 (셔틀버스정류소)");
    });

    it("maps 혜화동로터리 correctly", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("혜화동로터리", "6", koreanNow())] });
      await service.updateHSSCBusList();
      const result = service.getHSSCBusList();
      expect(result.length).toBe(1);
      expect(result[0].stationName).toBe("혜화동로터리 [미정차]");
    });

    it("passes unmapped names through", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("새로운정류장", "3", koreanNow())] });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList()[0].stationName).toBe("새로운정류장");
    });
  });

  describe("sequence calculation", () => {
    it.each([
      [5, "1"],
      [0, "7"],
      [8, "4"],
      [10, "6"],
    ])("seq=%i → realsequence=%s", async (seq, expected) => {
      axios.get.mockResolvedValue({
        data: [createApiItem("성균관대입구사거리", String(seq), koreanNow())],
      });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList()[0].sequence).toBe(expected);
    });
  });

  describe("time filtering", () => {
    it("keeps items within 10min for non-농구장 stations", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("혜화동로터리", "6", koreanNow(5))] });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList().length).toBe(1);
    });

    it("filters out items older than 10min for non-농구장 stations", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("혜화동로터리", "6", koreanNow(15))] });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList().length).toBe(0);
    });

    it("filters out 농구장 items older than 3min", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("농구장정류소", "5", koreanNow(4))] });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList().length).toBe(0);
    });

    it("keeps 농구장 items within 3min", async () => {
      axios.get.mockResolvedValue({ data: [createApiItem("농구장정류소", "5", koreanNow(2))] });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList().length).toBe(1);
    });
  });

  describe("empty/error responses", () => {
    it("handles empty API response", async () => {
      axios.get.mockResolvedValue({ data: [] });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList()).toEqual([]);
    });

    it("handles API error without crash", async () => {
      axios.get.mockRejectedValue(new Error("Network error"));
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList()).toEqual([]);
    });

    it("ignores a non-array response shape (keeps previous state)", async () => {
      axios.get.mockResolvedValue({ data: { unexpected: true } });
      await service.updateHSSCBusList();
      expect(service.getHSSCBusList()).toEqual([]);
    });
  });
});

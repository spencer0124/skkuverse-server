/**
 * Nest port of campus-eta.test.ts — CampusEtaService is the exact port of
 * features/bus/campus-eta.data.ts (raw axios, 10-min success-only cache).
 *
 * Mocks lib/config (naver keys), lib/logger, and axios exactly as the Express
 * test does. The instance holds its own cache, so a fresh service per test
 * replaces the module-scoped clearCache().
 */

jest.mock("../../../lib/config", () => ({
  naver: {
    apiKeyId: "test-key-id",
    apiKey: "test-key-secret",
  },
}));

jest.mock("../../../lib/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

jest.mock("axios");

import { CampusEtaService } from "../../../src/bus/campus-eta/campus-eta.service";

const axios = require("axios");

let service: CampusEtaService;

beforeEach(() => {
  service = new CampusEtaService();
});

afterEach(() => {
  service.clearCache();
  jest.clearAllMocks();
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(service.formatDuration(5_400_000)).toBe("1시간 30분");
  });
  it("formats hours only when minutes are zero", () => {
    expect(service.formatDuration(3_600_000)).toBe("1시간");
  });
  it("formats minutes only when under an hour", () => {
    expect(service.formatDuration(1_800_000)).toBe("30분");
  });
  it("formats zero minutes", () => {
    expect(service.formatDuration(0)).toBe("0분");
  });
  it("rounds to nearest minute", () => {
    expect(service.formatDuration(5_430_000)).toBe("1시간 31분");
  });
  it("handles multi-hour durations", () => {
    expect(service.formatDuration(7_200_000)).toBe("2시간");
    expect(service.formatDuration(9_000_000)).toBe("2시간 30분");
  });
});

function mockNaverResponse(duration: number, distance: number) {
  return {
    data: {
      code: 0,
      route: { traoptimal: [{ summary: { duration, distance } }] },
    },
  };
}

describe("getEtaData", () => {
  it("returns inja and jain ETAs on success", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    const result = await service.getEtaData();

    expect(result.inja).toEqual({
      duration: 5_400_000,
      durationText: "1시간 30분",
      distance: 131_100,
    });
    expect(result.jain).toEqual({
      duration: 5_520_000,
      durationText: "1시간 32분",
      distance: 130_500,
    });
  });

  it("returns cached data on second call", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    await service.getEtaData();
    const second = await service.getEtaData();

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(second.inja!.duration).toBe(5_400_000);
  });

  it("returns partial response when one direction fails", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockRejectedValueOnce(new Error("network error"));

    const result = await service.getEtaData();

    expect(result.inja).not.toBeNull();
    expect(result.jain).toBeNull();
  });

  it("does not cache partial responses", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockRejectedValueOnce(new Error("network error"));

    await service.getEtaData();

    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    const result = await service.getEtaData();
    expect(result.inja).not.toBeNull();
    expect(result.jain).not.toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  it("throws when both directions fail and no stale cache", async () => {
    axios.get
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"));

    await expect(service.getEtaData()).rejects.toThrow(
      "Naver Directions API unavailable for both directions",
    );
  });

  it("returns stale cache when both directions fail after a previous success", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    const first = await service.getEtaData();
    expect(first.inja).not.toBeNull();

    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 11 * 60_000;

    axios.get
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"));

    const result = await service.getEtaData();
    expect(result.inja!.duration).toBe(5_400_000);
    expect(result.jain!.duration).toBe(5_520_000);

    Date.now = realDateNow;
  });

  it("sends correct headers to Naver API", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    await service.getEtaData();

    expect(axios.get).toHaveBeenCalledWith(
      "https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving",
      expect.objectContaining({
        headers: {
          "X-NCP-APIGW-API-KEY-ID": "test-key-id",
          "X-NCP-APIGW-API-KEY": "test-key-secret",
        },
      }),
    );
  });
});

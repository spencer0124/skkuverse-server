jest.mock("../lib/config", () => ({
  naver: {
    apiKeyId: "test-key-id",
    apiKey: "test-key-secret",
  },
}));

jest.mock("../lib/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

jest.mock("axios");

const axios = require("axios");
const { getEtaData, formatDuration, clearCache } = require("../features/bus/campus-eta.data");

afterEach(() => {
  clearCache();
  jest.clearAllMocks();
});

// --- formatDuration ---

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(5_400_000)).toBe("1시간 30분"); // 90 min
  });

  it("formats hours only when minutes are zero", () => {
    expect(formatDuration(3_600_000)).toBe("1시간"); // 60 min
  });

  it("formats minutes only when under an hour", () => {
    expect(formatDuration(1_800_000)).toBe("30분"); // 30 min
  });

  it("formats zero minutes", () => {
    expect(formatDuration(0)).toBe("0분");
  });

  it("rounds to nearest minute", () => {
    expect(formatDuration(5_430_000)).toBe("1시간 31분"); // 90.5 min → 91
  });

  it("handles multi-hour durations", () => {
    expect(formatDuration(7_200_000)).toBe("2시간"); // 120 min
    expect(formatDuration(9_000_000)).toBe("2시간 30분"); // 150 min
  });
});

// --- getEtaData ---

function mockNaverResponse(duration, distance) {
  return {
    data: {
      code: 0,
      route: {
        traoptimal: [
          {
            summary: { duration, distance },
          },
        ],
      },
    },
  };
}

describe("getEtaData", () => {
  it("returns inja and jain ETAs on success", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    const result = await getEtaData();

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

    await getEtaData();
    const second = await getEtaData();

    // axios should only be called 2 times (both from the first call)
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(second.inja.duration).toBe(5_400_000);
  });

  it("returns partial response when one direction fails", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockRejectedValueOnce(new Error("network error"));

    const result = await getEtaData();

    expect(result.inja).not.toBeNull();
    expect(result.jain).toBeNull();
  });

  it("does not cache partial responses", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockRejectedValueOnce(new Error("network error"));

    await getEtaData();

    // Second call should hit the API again (not cached)
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    const result = await getEtaData();
    expect(result.inja).not.toBeNull();
    expect(result.jain).not.toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  it("throws when both directions fail and no stale cache", async () => {
    axios.get
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"));

    await expect(getEtaData()).rejects.toThrow(
      "Naver Directions API unavailable for both directions"
    );
  });

  it("returns stale cache when both directions fail after a previous success", async () => {
    // First call succeeds
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    const first = await getEtaData();
    expect(first.inja).not.toBeNull();

    // Expire the cache by advancing time past TTL (10 minutes)
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 11 * 60_000;

    // Second call: both fail — should return stale data
    axios.get
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"));

    const result = await getEtaData();
    expect(result.inja.duration).toBe(5_400_000);
    expect(result.jain.duration).toBe(5_520_000);

    Date.now = realDateNow;
  });

  it("sends correct headers to Naver API", async () => {
    axios.get
      .mockResolvedValueOnce(mockNaverResponse(5_400_000, 131_100))
      .mockResolvedValueOnce(mockNaverResponse(5_520_000, 130_500));

    await getEtaData();

    expect(axios.get).toHaveBeenCalledWith(
      "https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving",
      expect.objectContaining({
        headers: {
          "X-NCP-APIGW-API-KEY-ID": "test-key-id",
          "X-NCP-APIGW-API-KEY": "test-key-secret",
        },
      })
    );
  });
});

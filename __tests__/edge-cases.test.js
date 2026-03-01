afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.resetModules();
  jest.useRealTimers();
});

describe("HSSC edge cases", () => {
  it("stale data (all >10min old) results in empty array", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const moment = require("moment-timezone");
    const fifteenMinAgo = moment()
      .tz("Asia/Seoul")
      .subtract(15, "minutes")
      .locale("ko")
      .format("YYYY-MM-DD a h:mm:ss");

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: [
          {
            stop_name: "혜화동로터리",
            seq: "6",
            get_date: fifteenMinAgo,
            line_no: "1",
            stop_no: "1",
          },
          {
            stop_name: "성균관대입구사거리",
            seq: "3",
            get_date: fifteenMinAgo,
            line_no: "1",
            stop_no: "2",
          },
        ],
      }),
    }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));

    const { getHSSCBusList } = require("../features/bus/hssc.fetcher");

    await jest.advanceTimersByTimeAsync(10000);

    const result = getHSSCBusList();
    expect(result).toEqual([]);
  });

  it("API error does not crash, returns previous data", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const moment = require("moment-timezone");
    const now = moment().tz("Asia/Seoul").locale("ko").format("YYYY-MM-DD a h:mm:ss");

    const mockGet = jest.fn();
    // After heartbeat removal, updateHSSCBusList makes one axios.get call per interval
    mockGet
      .mockResolvedValueOnce({
        data: [
          {
            stop_name: "혜화동로터리",
            seq: "6",
            get_date: now,
            line_no: "1",
            stop_no: "1",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("API down")); // API fails on 2nd tick

    jest.doMock("axios", () => ({ get: mockGet }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));

    const { getHSSCBusList } = require("../features/bus/hssc.fetcher");

    // First tick — data loads
    await jest.advanceTimersByTimeAsync(10000);
    expect(getHSSCBusList().length).toBe(1);

    // Second tick — API fails
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    await jest.advanceTimersByTimeAsync(10000);

    // Data from first call should still be there (error in try block doesn't clear it)
    const result = getHSSCBusList();
    expect(result.length).toBe(1);
    consoleSpy.mockRestore();
  });
});

describe("Jongro edge cases", () => {
  it("empty itemList results in empty arrays", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: { msgBody: { itemList: [] } },
      }),
    }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));

    const { getJongroBusList } = require("../features/bus/jongro.fetcher");

    await jest.advanceTimersByTimeAsync(15000);

    const result = getJongroBusList("07");
    expect(result).toHaveLength(0);
  });

  it("API error does not crash", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockRejectedValue(new Error("Network error")),
    }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { getJongroBusList } = require("../features/bus/jongro.fetcher");

    await jest.advanceTimersByTimeAsync(15000);

    expect(getJongroBusList("07")).toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe("Station edge cases", () => {
  it("API error returns default '정보 없음'", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockRejectedValue(new Error("Network error")),
    }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { getStationInfo } = require("../features/station/station.fetcher");

    await jest.advanceTimersByTimeAsync(15000);

    expect(getStationInfo()).toBe("정보 없음");
    consoleSpy.mockRestore();
  });

  it("successful API update changes return value", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          msgBody: {
            itemList: [{ arrmsg1: "3분후[1번째 전]" }],
          },
        },
      }),
    }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));

    const { getStationInfo } = require("../features/station/station.fetcher");

    // Default value before any interval fires
    expect(getStationInfo()).toBe("정보 없음");

    await jest.advanceTimersByTimeAsync(15000);

    expect(getStationInfo()).toBe("3분후[1번째 전]");
  });

  it("empty itemList resets to '정보 없음' and writes to bus_cache (not ghost data)", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const mockWrite = jest.fn().mockResolvedValue();
    const mockGet = jest.fn()
      // First poll: real data
      .mockResolvedValueOnce({ data: { msgBody: { itemList: [{ arrmsg1: "2분후 도착" }] } } })
      // Second poll: genuinely empty (no buses)
      .mockResolvedValueOnce({ data: { msgBody: { itemList: [] } } });

    jest.doMock("axios", () => ({ get: mockGet }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: mockWrite,
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));

    const { getStationInfo } = require("../features/station/station.fetcher");

    // First tick: data arrives
    await jest.advanceTimersByTimeAsync(15000);
    expect(getStationInfo()).toBe("2분후 도착");

    // Second tick: empty response → must reset, not keep ghost "2분후 도착"
    await jest.advanceTimersByTimeAsync(15000);
    expect(getStationInfo()).toBe("정보 없음");
    expect(mockWrite).toHaveBeenLastCalledWith("station", "정보 없음");
  });

  it("API network error preserves previous state — no ghost reset", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const mockGet = jest.fn()
      .mockResolvedValueOnce({ data: { msgBody: { itemList: [{ arrmsg1: "1분후 도착" }] } } })
      .mockRejectedValueOnce(new Error("Network error"));

    jest.doMock("axios", () => ({ get: mockGet }));
    jest.doMock("../lib/pollers", () => ({
      registerPoller: (fn, ms) => setInterval(fn, ms),
      startAll: jest.fn(),
      stopAll: jest.fn(),
    }));
    jest.doMock("../lib/busCache", () => ({
      write: jest.fn().mockResolvedValue(),
      read: jest.fn().mockResolvedValue(null),
      ensureIndex: jest.fn().mockResolvedValue(),
    }));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { getStationInfo } = require("../features/station/station.fetcher");

    await jest.advanceTimersByTimeAsync(15000);
    expect(getStationInfo()).toBe("1분후 도착");

    // Network error: state must NOT change
    await jest.advanceTimersByTimeAsync(15000);
    expect(getStationInfo()).toBe("1분후 도착");
    consoleSpy.mockRestore();
  });
});

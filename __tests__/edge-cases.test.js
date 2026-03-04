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
    require("moment/locale/ko");
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
    require("moment/locale/ko");
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

describe("HSSC edge cases — non-array response guard", () => {
  it("non-array response.data does not crash, keeps previous data", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const moment = require("moment-timezone");
    require("moment/locale/ko");
    const now = moment().tz("Asia/Seoul").locale("ko").format("YYYY-MM-DD a h:mm:ss");

    const mockGet = jest.fn();
    // First call: valid array data
    mockGet.mockResolvedValueOnce({
      data: [
        {
          stop_name: "혜화동로터리",
          seq: "6",
          get_date: now,
          line_no: "1",
          stop_no: "1",
        },
      ],
    });
    // Second call: non-array response (e.g., HTML error page or object)
    mockGet.mockResolvedValueOnce({ data: "<html>Service Unavailable</html>" });

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

    // First tick: valid data loads
    await jest.advanceTimersByTimeAsync(10000);
    expect(getHSSCBusList().length).toBe(1);

    // Second tick: non-array response → guard returns early, keeps previous data
    await jest.advanceTimersByTimeAsync(10000);
    expect(getHSSCBusList().length).toBe(1);
  });

  it("object response.data does not crash", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: { error: "internal server error" },
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

    // Should return initial empty array, not crash
    expect(getHSSCBusList()).toEqual([]);
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

    await jest.advanceTimersByTimeAsync(40000);

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

    await jest.advanceTimersByTimeAsync(40000);

    expect(getJongroBusList("07")).toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe("Jongro edge cases — plainNo (location API) whitespace handling", () => {
  it("null plainNo in location data returns '----'", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          msgBody: {
            itemList: [
              {
                lastStnId: "100900197",
                tmX: "126.998",
                tmY: "37.587",
                plainNo: null,
              },
            ],
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

    const { getJongroBusLocation } = require("../features/bus/jongro.fetcher");

    await jest.advanceTimersByTimeAsync(40000);

    const result = getJongroBusLocation("07");
    expect(result[0].carNumber).toBe("----");
  });
});

describe("Jongro edge cases — plainNo1 (list API) whitespace handling", () => {
  it("plainNo1 with single space returns '----' not ' '", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          msgBody: {
            itemList: [
              {
                stId: "100",
                staOrd: "1",
                stNm: "명륜새마을금고",
                plainNo1: " ",
                mkTm: "2025-03-03 08:00:00",
                arsId: "01592",
                arrmsg1: "출발대기",
              },
            ],
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

    const { getJongroBusList } = require("../features/bus/jongro.fetcher");

    await jest.advanceTimersByTimeAsync(40000);

    const result = getJongroBusList("07");
    expect(result[0].carNumber).toBe("----");
  });

  it("null plainNo1 returns '----'", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          msgBody: {
            itemList: [
              {
                stId: "100",
                staOrd: "1",
                stNm: "명륜새마을금고",
                plainNo1: null,
                mkTm: "2025-03-03 08:00:00",
                arsId: "01592",
                arrmsg1: "운행종료",
              },
            ],
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

    const { getJongroBusList } = require("../features/bus/jongro.fetcher");

    await jest.advanceTimersByTimeAsync(40000);

    const result = getJongroBusList("07");
    expect(result[0].carNumber).toBe("----");
  });
});

describe("Station edge cases — malformed response handling", () => {
  it("response with missing msgBody does not crash (optional chaining)", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const mockGet = jest.fn()
      .mockResolvedValueOnce({
        data: { msgBody: { itemList: [{ arrmsg1: "3분후 도착" }] } },
      })
      // Second response: msgBody is missing entirely
      .mockResolvedValueOnce({ data: {} });

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

    const { getStationInfo } = require("../features/station/station.fetcher");

    // First tick: valid data
    await jest.advanceTimersByTimeAsync(40000);
    expect(getStationInfo()).toBe("3분후 도착");

    // Second tick: malformed response → early return, keeps previous state
    await jest.advanceTimersByTimeAsync(40000);
    expect(getStationInfo()).toBe("3분후 도착");
  });

  it("null response.data does not crash", async () => {
    jest.useFakeTimers();
    jest.resetModules();

    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({ data: null }),
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

    await jest.advanceTimersByTimeAsync(40000);

    // Should keep default value, not crash
    expect(getStationInfo()).toBe("정보 없음");
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

    await jest.advanceTimersByTimeAsync(40000);

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

    await jest.advanceTimersByTimeAsync(40000);

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
    await jest.advanceTimersByTimeAsync(40000);
    expect(getStationInfo()).toBe("2분후 도착");

    // Second tick: empty response → must reset, not keep ghost "2분후 도착"
    await jest.advanceTimersByTimeAsync(40000);
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

    await jest.advanceTimersByTimeAsync(40000);
    expect(getStationInfo()).toBe("1분후 도착");

    // Network error: state must NOT change
    await jest.advanceTimersByTimeAsync(40000);
    expect(getStationInfo()).toBe("1분후 도착");
    consoleSpy.mockRestore();
  });
});

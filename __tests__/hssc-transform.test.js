afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.resetModules();
  jest.useRealTimers();
});

// The API sends Korean AM/PM format (오전/오후), and fetchhssc_new.js
// parses with moment(get_date, "YYYY-MM-DD a h:mm:ss", "ko")
function koreanNow(offsetMinutes = 0) {
  const moment = require("moment-timezone");
  const t = moment().tz("Asia/Seoul");
  if (offsetMinutes) t.subtract(offsetMinutes, "minutes");
  return t.locale("ko").format("YYYY-MM-DD a h:mm:ss");
}

function createApiItem(stop_name, seq, get_date, line_no = "1", stop_no = "1") {
  return { stop_name, seq, get_date, line_no, stop_no };
}

function setupModule(mockData) {
  jest.useFakeTimers();
  jest.resetModules();

  jest.doMock("axios", () => ({
    get: jest.fn().mockResolvedValue(mockData),
  }));

  const fetchModule = require("../route/bus/hssc_v1/fetchhssc_new.js");
  const axios = require("axios");
  return { getHSSCBusList: fetchModule.getHSSCBusList, axios };
}

describe("HSSC fetchhssc_new.js", () => {
  it("initially returns empty array", () => {
    const { getHSSCBusList } = setupModule({ data: [] });
    expect(getHSSCBusList()).toEqual([]);
  });

  describe("stopNameMapping", () => {
    it("maps 농구장정류소 correctly", async () => {
      const now = koreanNow();
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("농구장정류소", "5", now)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result.length).toBe(1);
      expect(result[0].stationName).toBe("농구장 (셔틀버스정류소)");
    });

    it("maps 혜화동로터리 correctly", async () => {
      const now = koreanNow();
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("혜화동로터리", "6", now)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result.length).toBe(1);
      expect(result[0].stationName).toBe("혜화동로터리 [미정차]");
    });

    it("passes unmapped names through", async () => {
      const now = koreanNow();
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("새로운정류장", "3", now)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result[0].stationName).toBe("새로운정류장");
    });
  });

  describe("sequence calculation", () => {
    // realsequence = seq >= 5 ? (seq - 5 + 1) : (seq + 6 + 1)
    it.each([
      [5, "1"],
      [0, "7"],
      [8, "4"],
      [10, "6"],
    ])("seq=%i → realsequence=%s", async (seq, expected) => {
      const now = koreanNow();
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("성균관대입구사거리", seq.toString(), now)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result[0].sequence).toBe(expected);
    });
  });

  describe("time filtering", () => {
    it("keeps items within 10min for non-농구장 stations", async () => {
      const fiveMinAgo = koreanNow(5);
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("혜화동로터리", "6", fiveMinAgo)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result.length).toBe(1);
    });

    it("filters out items older than 10min for non-농구장 stations", async () => {
      const fifteenMinAgo = koreanNow(15);
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("혜화동로터리", "6", fifteenMinAgo)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result.length).toBe(0);
    });

    it("filters out 농구장 items older than 3min", async () => {
      const fourMinAgo = koreanNow(4);
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("농구장정류소", "5", fourMinAgo)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result.length).toBe(0);
    });

    it("keeps 농구장 items within 3min", async () => {
      const twoMinAgo = koreanNow(2);
      const { getHSSCBusList } = setupModule({
        data: [createApiItem("농구장정류소", "5", twoMinAgo)],
      });

      await jest.advanceTimersByTimeAsync(10000);

      const result = getHSSCBusList();
      expect(result.length).toBe(1);
    });
  });

  describe("empty/error responses", () => {
    it("handles empty API response", async () => {
      const { getHSSCBusList } = setupModule({ data: [] });

      await jest.advanceTimersByTimeAsync(10000);

      expect(getHSSCBusList()).toEqual([]);
    });

    it("handles API error without crash", async () => {
      jest.useFakeTimers();
      jest.resetModules();
      jest.doMock("axios", () => ({
        get: jest.fn().mockRejectedValue(new Error("Network error")),
      }));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const { getHSSCBusList } = require("../route/bus/hssc_v1/fetchhssc_new.js");

      await jest.advanceTimersByTimeAsync(10000);

      expect(getHSSCBusList()).toEqual([]);
      consoleSpy.mockRestore();
    });
  });
});

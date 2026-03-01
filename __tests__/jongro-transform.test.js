afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.resetModules();
  jest.useRealTimers();
});

const emptyListResponse = { data: { msgBody: { itemList: [] } } };

function setupModule(mockImpl) {
  jest.useFakeTimers();
  jest.resetModules();

  const mockGet = jest.fn();
  if (typeof mockImpl === "function") {
    mockGet.mockImplementation(mockImpl);
  } else {
    mockGet.mockResolvedValue(mockImpl || emptyListResponse);
  }

  jest.doMock("axios", () => ({ get: mockGet }));

  // Mock pollers so registerPoller immediately starts setInterval
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

  const fetchModule = require("../features/bus/jongro.fetcher");
  const axios = require("axios");
  return {
    getJongroBusList: fetchModule.getJongroBusList,
    getJongroBusLocation: fetchModule.getJongroBusLocation,
    axios,
    mockGet,
  };
}

describe("Jongro fetchjongro.js", () => {
  describe("getJongroBusList", () => {
    it("initially returns undefined for uninitialized bus numbers", () => {
      const { getJongroBusList } = setupModule();
      expect(getJongroBusList("07")).toBeUndefined();
      expect(getJongroBusList("02")).toBeUndefined();
    });

    it("maps bus list data correctly after update", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const consoleSpy2 = jest.spyOn(console, "log").mockImplementation();

      const busListData = {
        data: {
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
      };

      // All 4 intervals use the same mock — bus list calls get our data,
      // bus location calls will error (wrong shape) but that's caught
      const { getJongroBusList } = setupModule(busListData);

      await jest.advanceTimersByTimeAsync(15000);

      const result = getJongroBusList("07");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        stationId: "100900197",
        sequence: "1",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        stationNumber: "01504",
        eta: "3분후[1번째 전]",
      });
      consoleSpy.mockRestore();
      consoleSpy2.mockRestore();
    });

    it("extracts last 4 chars of plainNo1 as carNumber", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const consoleSpy2 = jest.spyOn(console, "log").mockImplementation();

      const { getJongroBusList } = setupModule({
        data: {
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

      await jest.advanceTimersByTimeAsync(15000);

      // Both 07 and 02 get the same data
      const result07 = getJongroBusList("07");
      const result02 = getJongroBusList("02");
      const result = result07 && result07.length > 0 ? result07 : result02;
      expect(result[0].carNumber).toBe("1234");

      consoleSpy.mockRestore();
      consoleSpy2.mockRestore();
    });
  });

  describe("getJongroBusLocation", () => {
    it("maps location data with station mapping", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const consoleSpy2 = jest.spyOn(console, "log").mockImplementation();

      // Use mockImplementation to differentiate list vs location calls by URL
      const { getJongroBusLocation } = setupModule(() => {
        // Location endpoints have LOC in URL, list have LIST
        // But in test process.env URLs are undefined, so all calls get undefined URL
        // Just return location-shaped data for all; list calls will error (caught)
        return Promise.resolve({
          data: {
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
      });

      await jest.advanceTimersByTimeAsync(15000);

      const result = getJongroBusLocation("07");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sequence: "1",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        latitude: "37.587",
        longitude: "126.998",
      });
      expect(result[0].estimatedTime).toBeDefined();

      consoleSpy.mockRestore();
      consoleSpy2.mockRestore();
    });
  });

  describe("error handling", () => {
    it("handles API error without crash", async () => {
      jest.useFakeTimers();
      jest.resetModules();
      jest.doMock("axios", () => ({
        get: jest.fn().mockRejectedValue(new Error("Network error")),
      }));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const { getJongroBusList } = require("../features/bus/jongro.fetcher");

      await jest.advanceTimersByTimeAsync(15000);

      expect(getJongroBusList("07")).toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("handles empty itemList", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const { getJongroBusList } = setupModule();

      await jest.advanceTimersByTimeAsync(15000);

      const result = getJongroBusList("07");
      expect(result).toHaveLength(0);
      consoleSpy.mockRestore();
    });
  });
});

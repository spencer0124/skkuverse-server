const { encodeQuery } = require("../features/search/search.helpers");

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("encodeQuery", () => {
  it("passes through alphanumeric strings", () => {
    expect(encodeQuery("hello123")).toBe("hello123");
  });

  it("encodes Korean text", () => {
    expect(encodeQuery("경영관")).toBe(encodeURIComponent("경영관"));
  });

  it("encodes strings with spaces", () => {
    expect(encodeQuery("hello world")).toBe(encodeURIComponent("hello world"));
  });
});

describe("option3 (space search)", () => {
  it("returns correctly mapped data on success", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          items: [
            {
              buildNm: "경영관",
              buildNmEng: "Business Hall",
              buildNo: "21201",
              latitude: 37.5,
              longtitude: 126.9,
              floorNm: "3층",
              floorNmEng: "3F",
              spcaeNm: "세미나실",
              spcaeNmEng: "Seminar Room",
              spaceCd: "S001",
            },
          ],
        },
      }),
    }));

    const { option3 } = require("../features/search/search.space");
    const result = await option3("경영", 1);

    expect(result).toHaveLength(1);
    expect(result[0].buildingInfo.buildNm_kr).toBe("경영관");
    expect(result[0].buildingInfo.longtitude).toBe(126.9);
    expect(result[0].spaceInfo.spaceNm_kr).toBe("세미나실");
    expect(result[0].spaceInfo.spaceCd).toBe("S001");
  });

  it("uses buildingInfo key (not bulidingInfo typo)", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          items: [
            {
              buildNm: "A",
              buildNmEng: "A",
              buildNo: "1",
              latitude: 0,
              longtitude: 0,
              floorNm: "1F",
              floorNmEng: "1F",
              spcaeNm: "Room",
              spcaeNmEng: "Room",
              spaceCd: "R1",
            },
          ],
        },
      }),
    }));

    const { option3 } = require("../features/search/search.space");
    const result = await option3("A", 1);

    expect(result[0]).toHaveProperty("buildingInfo");
    expect(result[0]).not.toHaveProperty("bulidingInfo");
  });

  it("returns empty array on API failure", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockRejectedValue(new Error("Network error")),
    }));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { option3 } = require("../features/search/search.space");
    const result = await option3("test", 1);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[search] Failed to fetch spaces:",
      "Network error"
    );
    consoleSpy.mockRestore();
  });
});

describe("option1 (building search)", () => {
  it("returns correctly mapped data on success", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          buildItems: [
            {
              buildNo: "21201",
              id: "100",
              filePath: "/img/",
              encodeNm: "building.jpg",
              createDt: "2024-01-01",
              updateDt: "2024-06-01",
              campusCd: "1",
              latitude: 37.5,
              longtitude: 126.9,
              buildNm: "경영관",
              buildNmEng: "Business Hall",
              krText: "경영학과 건물",
              enText: "Business building",
              handicappedElevatorYn: "Y",
              handicappedToiletYn: "N",
            },
          ],
        },
      }),
    }));

    const { option1 } = require("../features/search/search.building");
    const result = await option1("경영", 1);

    expect(result).toHaveLength(1);
    expect(result[0].metaData.buildNo).toBe("21201");
    expect(result[0].metaData.floorinfoAvail).toBe(true);
    expect(result[0].buildingInfo.buildName_kr).toBe("경영관");
    expect(result[0].buildingInfo.handicappedElevatorAvail).toBe(true);
    expect(result[0].buildingInfo.handicappedToiletAvail).toBe(false);
  });

  it("floorinfoAvail is false when buildNo is null", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          buildItems: [
            {
              buildNo: null,
              id: "100",
              filePath: "/img/",
              encodeNm: "x.jpg",
              createDt: "",
              updateDt: "",
              campusCd: "1",
              latitude: 0,
              longtitude: 0,
              buildNm: "A",
              buildNmEng: "A",
              krText: "",
              enText: "",
              handicappedElevatorYn: "N",
              handicappedToiletYn: "N",
            },
          ],
        },
      }),
    }));

    const { option1 } = require("../features/search/search.building");
    const result = await option1("A", 1);

    expect(result[0].metaData.floorinfoAvail).toBe(false);
  });

  it("returns empty array on API failure", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockRejectedValue(new Error("SKKU API down")),
    }));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { option1 } = require("../features/search/search.building");
    const result = await option1("test", 1);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[search] Failed to fetch buildings:",
      "SKKU API down"
    );
    consoleSpy.mockRestore();
  });
});

describe("option1_detail (building detail)", () => {
  it("returns floor-grouped data on success", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockResolvedValue({
        data: {
          item: { buildNm: "경영관", buildNo: "21201" },
          floorItem: [
            { floor_nm: "3층", space_nm: "세미나실A" },
            { floor_nm: "3층", space_nm: "세미나실B" },
            { floor_nm: "지하1층", space_nm: "주차장" },
          ],
        },
      }),
    }));

    const { option1_detail } = require("../features/search/search.building-detail");
    const result = await option1_detail("21201", "100");

    expect(result.item.buildNm).toBe("경영관");
    expect(result.availableFloor).toEqual(["지하1층", "3층"]);
    expect(result.floorItem["3층"]).toHaveLength(2);
    expect(result.floorItem["지하1층"]).toHaveLength(1);
  });

  it("returns empty structure on API failure", async () => {
    jest.doMock("axios", () => ({
      get: jest.fn().mockRejectedValue(new Error("timeout")),
    }));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { option1_detail } = require("../features/search/search.building-detail");
    const result = await option1_detail("999", "999");

    expect(result).toEqual({ item: null, availableFloor: [], floorItem: {} });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[search] Failed to fetch building detail:",
      "timeout"
    );
    consoleSpy.mockRestore();
  });
});

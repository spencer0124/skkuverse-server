const { computeEta, computeAllStationEtas } = require("../features/station/station.data");

// No mocks needed — these are pure functions with no external dependencies.

function makeBus(sequence, estimatedTime = 300) {
  return { sequence: String(sequence), estimatedTime };
}

function makeStation(sequence, stationName) {
  return {
    sequence,
    stationName: stationName || `Station ${sequence}`,
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: sequence === 1,
    isLastStation: sequence === 10,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  };
}

// --- computeEta ---

describe("computeEta", () => {
  describe("no buses", () => {
    it("returns '도착 정보 없음' when bus data is empty", () => {
      expect(computeEta(makeStation(6), [])).toBe("도착 정보 없음");
    });

    it("returns '도착 정보 없음' when busData is null", () => {
      expect(computeEta(makeStation(6), null)).toBe("도착 정보 없음");
    });

    it("returns '도착 정보 없음' when busData is undefined", () => {
      expect(computeEta(makeStation(6), undefined)).toBe("도착 정보 없음");
    });

    it("returns '도착 정보 없음' when all buses are past the station", () => {
      const buses = [makeBus(7), makeBus(8)];
      expect(computeEta(makeStation(6), buses)).toBe("도착 정보 없음");
    });
  });

  describe("bus approaching (not yet at station)", () => {
    it("returns stops away for a single approaching bus", () => {
      expect(computeEta(makeStation(6), [makeBus(3)])).toBe("3 정거장 전");
    });

    it("returns 1 stop away for bus one stop behind", () => {
      expect(computeEta(makeStation(6), [makeBus(5)])).toBe("1 정거장 전");
    });

    it("picks the closest bus when multiple are approaching", () => {
      const buses = [makeBus(2), makeBus(5), makeBus(4)];
      expect(computeEta(makeStation(6), buses)).toBe("1 정거장 전");
    });

    it("ignores buses that have already passed the station", () => {
      const buses = [makeBus(7), makeBus(8), makeBus(3)];
      expect(computeEta(makeStation(6), buses)).toBe("3 정거장 전");
    });
  });

  describe("bus at station (stopsAway === 0)", () => {
    it("returns '도착 또는 출발' when estimatedTime < 60 (seconds)", () => {
      expect(computeEta(makeStation(6), [makeBus(6, 30)])).toBe("도착 또는 출발");
    });

    it("returns '도착 또는 출발' at boundary: estimatedTime = 59", () => {
      expect(computeEta(makeStation(6), [makeBus(6, 59)])).toBe("도착 또는 출발");
    });

    it("treats estimatedTime = 60 as stale (>= threshold)", () => {
      expect(computeEta(makeStation(6), [makeBus(6, 60)])).toBe("도착 정보 없음");
    });

    it("returns '도착 정보 없음' when stale and no other bus exists", () => {
      expect(computeEta(makeStation(6), [makeBus(6, 120)])).toBe("도착 정보 없음");
    });

    it("falls back to second bus when first is stale", () => {
      const buses = [makeBus(6, 120), makeBus(3)];
      expect(computeEta(makeStation(6), buses)).toBe("3 정거장 전");
    });
  });

  describe("terminal station skip (sequence === 10)", () => {
    it("skips stale bus at terminal, uses third bus", () => {
      // At terminal (seq 10): closest bus is stale at 10, second also at 10, third at 7
      const buses = [makeBus(10, 120), makeBus(10, 200), makeBus(7)];
      expect(computeEta(makeStation(10), buses)).toBe("3 정거장 전");
    });

    it("returns '도착 정보 없음' when at terminal and no third bus", () => {
      const buses = [makeBus(10, 120), makeBus(10, 200)];
      expect(computeEta(makeStation(10), buses)).toBe("도착 정보 없음");
    });

    it("does not skip non-terminal second bus", () => {
      // Stale at station 6, second bus at 4 (not terminal) — should use it
      const buses = [makeBus(6, 120), makeBus(4)];
      expect(computeEta(makeStation(6), buses)).toBe("2 정거장 전");
    });
  });
});

// --- computeAllStationEtas ---

describe("computeAllStationEtas", () => {
  it("returns a new array without mutating the input", () => {
    const stations = [makeStation(1), makeStation(2)];
    const original = stations.map((s) => ({ ...s }));
    const result = computeAllStationEtas(stations, []);

    expect(stations).toEqual(original);
    expect(result).not.toBe(stations);
  });

  it("computes ETAs for each station independently", () => {
    const stations = [makeStation(3), makeStation(6)];
    const buses = [makeBus(4)];
    const result = computeAllStationEtas(stations, buses);

    // Bus at seq 4 is past station 3 → no info
    expect(result[0].eta).toBe("도착 정보 없음");
    // Bus at seq 4 is 2 stops from station 6
    expect(result[1].eta).toBe("2 정거장 전");
  });

  it("handles empty bus data for all stations", () => {
    const stations = [makeStation(1), makeStation(6), makeStation(10)];
    const result = computeAllStationEtas(stations, []);

    result.forEach((station) => {
      expect(station.eta).toBe("도착 정보 없음");
    });
  });
});

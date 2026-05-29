const { mapStations } = require("../features/bus/bus-config.data");

describe("mapStations", () => {
  it("uses subtitle when present (HSSC pattern)", () => {
    const stations = [
      { stationName: "농구장", subtitle: "Basketball Court", stationNumber: null, isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
    ];
    const result = mapStations(stations);
    expect(result[0]).toMatchObject({
      index: 0,
      name: "농구장",
      subtitle: "Basketball Court",
      stationNumber: null,
    });
  });

  it("falls back to stationNumber when subtitle is absent (Jongro pattern)", () => {
    const stations = [
      { stationName: "명륜새마을금고", stationNumber: "01504", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
    ];
    const result = mapStations(stations);
    expect(result[0]).toMatchObject({
      index: 0,
      name: "명륜새마을금고",
      subtitle: "01504",
      stationNumber: "01504",
    });
  });

  it("returns null when both subtitle and stationNumber are absent", () => {
    const stations = [
      { stationName: "테스트역", stationNumber: null, isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
    ];
    const result = mapStations(stations);
    expect(result[0].subtitle).toBeNull();
  });
});

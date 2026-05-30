import {
  buildJongroListUrl,
  buildJongroLocUrl,
  jongroRoutes,
  validateRoutes,
  validateServiceKey,
  getJongroRouteByCode,
  getJongroRouteById,
} from "../features/bus/jongro.registry";

const FIXED_KEY =
  "ORCkFmKr8bIoQOxjPIhZsu4xEumjEQFC9cFW%2Br6C026Yk2LMhxAsuEb%2BYVShmoMzD8HHW257I92FA8slrJUQMg%3D%3D";

describe("jongro.registry — URL builders match the legacy prod URLs", () => {
  // These literal strings are the URLs that lived in .env (PROD) before the
  // refactor. Any future change to the template MUST keep these byte-identical
  // or the prod Jongro pipeline silently diverges.

  it("builds the 종로02 list URL identically (busRouteId=100900008)", () => {
    expect(buildJongroListUrl("100900008", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${FIXED_KEY}&busRouteId=100900008&resultType=json`,
    );
  });

  it("builds the 종로02 loc URL identically (endOrd=26)", () => {
    expect(buildJongroLocUrl("100900008", 26, FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt?serviceKey=${FIXED_KEY}&busRouteId=100900008&startOrd=1&endOrd=26&resultType=json`,
    );
  });

  it("builds the 종로07 list URL identically (busRouteId=100900004)", () => {
    expect(buildJongroListUrl("100900004", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${FIXED_KEY}&busRouteId=100900004&resultType=json`,
    );
  });

  it("builds the 종로07 loc URL identically (endOrd=19)", () => {
    expect(buildJongroLocUrl("100900004", 19, FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt?serviceKey=${FIXED_KEY}&busRouteId=100900004&startOrd=1&endOrd=19&resultType=json`,
    );
  });
});

describe("jongro.registry — derived routes from jongro-routes.json", () => {
  it("loads both 02 and 07 in order", () => {
    expect(jongroRoutes).toHaveLength(2);
    expect(jongroRoutes[0]!.id).toBe("jongro02");
    expect(jongroRoutes[0]!.code).toBe("02");
    expect(jongroRoutes[1]!.id).toBe("jongro07");
    expect(jongroRoutes[1]!.code).toBe("07");
  });

  it("preserves station counts (02=26, 07=19) and first/last flags", () => {
    const r02 = getJongroRouteById("jongro02")!;
    const r07 = getJongroRouteByCode("07")!;
    expect(r02.stations).toHaveLength(26);
    expect(r07.stations).toHaveLength(19);

    expect(r02.stations[0]!.isFirstStation).toBe(true);
    expect(r02.stations[0]!.stationName).toBe("성균관대학교");
    expect(r02.stations[25]!.isLastStation).toBe(true);
    expect(r02.stations[25]!.stationName).toBe("성대후문.와룡공원");

    expect(r07.stations[0]!.isFirstStation).toBe(true);
    expect(r07.stations[0]!.stationName).toBe("명륜새마을금고");
    expect(r07.stations[18]!.isLastStation).toBe(true);
    expect(r07.stations[18]!.stationName).toBe("성균관대학교");

    // Rotation flag spot-check
    expect(r02.stations[12]!.isRotationStation).toBe(true); // seq 13 금강제화
    expect(r07.stations[7]!.isRotationStation).toBe(true); // seq 8 방송통신대앞
  });

  it("derives sequence (1-based string) and stationNumber from arsId", () => {
    const r02 = getJongroRouteByCode("02")!;
    expect(r02.stations[0]!.sequence).toBe("1");
    expect(r02.stations[0]!.stationNumber).toBe("01881");
    expect(r02.stations[25]!.sequence).toBe("26");
  });

  it("derives the topisId→{sequence,stationName} mapping correctly", () => {
    const r02 = getJongroRouteById("jongro02")!;
    const r07 = getJongroRouteById("jongro07")!;

    // 종로02: 헌법재판소.안국역 (seq 10, topisId 100900086)
    expect(r02.mapping["100900086"]).toEqual({
      sequence: 10,
      stationName: "헌법재판소.안국역",
    });
    // 종로02: 성균관대학교 (seq 1, topisId 100900204)
    expect(r02.mapping["100900204"]).toEqual({
      sequence: 1,
      stationName: "성균관대학교",
    });

    // 종로07: 명륜새마을금고 (seq 1, topisId 100900197)
    expect(r07.mapping["100900197"]).toEqual({
      sequence: 1,
      stationName: "명륜새마을금고",
    });
    // 종로07: 방송통신대앞 (seq 8, topisId 100900028, rotation)
    expect(r07.mapping["100900028"]).toEqual({
      sequence: 8,
      stationName: "방송통신대앞",
    });
  });

  it("preserves transferLines on metro-connected stops", () => {
    const r02 = getJongroRouteByCode("02")!;
    // 낙원상가 seq 12 → 1/3/5호선
    expect(r02.stations[11]!.transferLines).toEqual([
      { line: "1", color: "0052A4" },
      { line: "3", color: "EF7C1C" },
      { line: "5", color: "996CAC" },
    ]);
  });
});

describe("jongro.registry — validateServiceKey (URL-encoded form)", () => {
  it("rejects missing / empty key with 'is required'", () => {
    expect(validateServiceKey(undefined).some((e) => e.includes("is required"))).toBe(true);
    expect(validateServiceKey("").some((e) => e.includes("is required"))).toBe(true);
  });

  it("rejects raw special chars that indicate non-URL-encoded form", () => {
    expect(validateServiceKey("ABC+DEF=").some((e) => e.includes("URL-encoded"))).toBe(true);
    expect(validateServiceKey("ABC&DEF").some((e) => e.includes("URL-encoded"))).toBe(true);
    expect(validateServiceKey("ABC DEF").some((e) => e.includes("URL-encoded"))).toBe(true);
  });

  it("accepts a properly URL-encoded prod-shaped key", () => {
    expect(
      validateServiceKey(
        "ORCkFmKr8bIoQOxjPIhZsu4xEumjEQFC9cFW%2Br6C026Yk2LMhxAsuEb%2BYVShmoMzD8HHW257I92FA8slrJUQMg%3D%3D",
      ),
    ).toEqual([]);
    expect(validateServiceKey("test-seoul-bus-key")).toEqual([]); // jest.setup default
  });
});

describe("jongro.registry — deep freeze (mutations fail at runtime)", () => {
  it("freezes route-level fields", () => {
    const r = getJongroRouteByCode("02")!;
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => {
      (r as { id: string }).id = "X";
    }).toThrow();
  });

  it("freezes nested stations (array + each element)", () => {
    const r = getJongroRouteByCode("02")!;
    expect(Object.isFrozen(r.stations)).toBe(true);
    expect(Object.isFrozen(r.stations[0])).toBe(true);
    expect(() => {
      (r.stations as unknown[]).push({} as never);
    }).toThrow();
    expect(() => {
      (r.stations[0] as { isFirstStation: boolean }).isFirstStation = false;
    }).toThrow();
  });

  it("freezes nested transferLines arrays", () => {
    const r = getJongroRouteByCode("02")!;
    // 낙원상가 seq 12 — three transferLines
    expect(Object.isFrozen(r.stations[11]!.transferLines)).toBe(true);
    expect(() => {
      (r.stations[11]!.transferLines as unknown[]).push({} as never);
    }).toThrow();
  });

  it("freezes mapping records (no key add or value mutation)", () => {
    const r = getJongroRouteByCode("02")!;
    expect(Object.isFrozen(r.mapping)).toBe(true);
    expect(() => {
      (r.mapping as Record<string, unknown>).fake = "X";
    }).toThrow();
  });
});

describe("jongro.registry — validation (fail-loud surfaces)", () => {
  it("accepts the real shipped data with zero errors", () => {
    const raw = require("../features/bus/jongro-routes.json");
    expect(validateRoutes(raw).errors).toEqual([]);
  });

  it("rejects non-array top-level", () => {
    const { errors } = validateRoutes({ id: "jongro02" });
    expect(errors[0]).toMatch(/must be a JSON array/);
  });

  it("rejects route with bad id pattern", () => {
    const { errors } = validateRoutes([
      { id: "jongroX", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("id: must match"))).toBe(true);
  });

  it("rejects duplicate topisId within a route", () => {
    const { errors } = validateRoutes([
      { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "DUP", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "DUP", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes('duplicate "DUP"'))).toBe(true);
  });

  it("rejects routes without exactly one isFirstStation / isLastStation", () => {
    const { errors } = validateRoutes([
      { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("isFirstStation=true (got 0)"))).toBe(true);
    expect(errors.some((e) => e.includes("isLastStation=true (got 0)"))).toBe(true);
  });

  it("rejects id with leading-zero collision (jongro007 alongside jongro07)", () => {
    const { errors } = validateRoutes([
      { id: "jongro007", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("id: must match"))).toBe(true);
  });

  it("rejects id without zero-pad on single digit (jongro2 → must be jongro02)", () => {
    const { errors } = validateRoutes([
      { id: "jongro2", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("id: must match"))).toBe(true);
  });

  it("rejects isFirstStation marker not at index 0", () => {
    const { errors } = validateRoutes([
      { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: true,  isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "c", arsId: "3", topisId: "t3", isFirstStation: false, isLastStation: true,  isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("isFirstStation=true must be at index 0"))).toBe(true);
  });

  it("rejects isLastStation marker not at final index", () => {
    const { errors } = validateRoutes([
      { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true,  isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true,  isRotationStation: false, transferLines: [] },
        { stationName: "c", arsId: "3", topisId: "t3", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("isLastStation=true must be at index"))).toBe(true);
  });

  it("rejects malformed transferLines color", () => {
    const { errors } = validateRoutes([
      { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [{ line: "1", color: "blue" }] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("color: must be 6-char hex"))).toBe(true);
  });
});

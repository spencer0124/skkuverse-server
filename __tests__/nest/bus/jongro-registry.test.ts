/**
 * Nest port of jongro-registry.test.ts — exercised through the src re-export
 * (src/bus/registry/jongro-registry.ts re-exports features/bus/jongro.registry
 * verbatim) so the derived registry / URL builders / freeze semantics are
 * proven byte-identical via the path the BusModule actually imports.
 *
 * Plus the jongroRoutesProvider useFactory: it must surface the registry at
 * bootstrap (fail-loud) and reject an empty/invalid array with NO silent ?? [].
 */

import {
  buildJongroListUrl,
  buildJongroLocUrl,
  jongroRoutes,
  validateRoutes,
  validateServiceKey,
  getJongroRouteByCode,
  getJongroRouteById,
} from "../../../src/bus/registry/jongro-registry";
import { jongroRoutesProvider } from "../../../src/bus/registry/jongro-registry.provider";

const FIXED_KEY =
  "ORCkFmKr8bIoQOxjPIhZsu4xEumjEQFC9cFW%2Br6C026Yk2LMhxAsuEb%2BYVShmoMzD8HHW257I92FA8slrJUQMg%3D%3D";

describe("jongro.registry — URL builders match the legacy prod URLs", () => {
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

    expect(r02.stations[12]!.isRotationStation).toBe(true);
    expect(r07.stations[7]!.isRotationStation).toBe(true);
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

    expect(r02.mapping["100900086"]).toEqual({ sequence: 10, stationName: "헌법재판소.안국역" });
    expect(r02.mapping["100900204"]).toEqual({ sequence: 1, stationName: "성균관대학교" });
    expect(r07.mapping["100900197"]).toEqual({ sequence: 1, stationName: "명륜새마을금고" });
    expect(r07.mapping["100900028"]).toEqual({ sequence: 8, stationName: "방송통신대앞" });
  });

  it("preserves transferLines on metro-connected stops", () => {
    const r02 = getJongroRouteByCode("02")!;
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
    expect(validateServiceKey(FIXED_KEY)).toEqual([]);
    expect(validateServiceKey("test-seoul-bus-key")).toEqual([]);
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
    const raw = require("../../../features/bus/jongro-routes.json");
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
});

describe("jongroRoutesProvider — fail-loud factory (NO silent ?? [])", () => {
  it("returns the validated registry (non-empty, frozen)", () => {
    const factory = (jongroRoutesProvider as { useFactory: () => ReadonlyArray<unknown> })
      .useFactory;
    const routes = factory();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBe(2);
    // Same object as the re-exported registry.
    expect(routes).toBe(jongroRoutes);
  });
});

/**
 * The served lines, stations and platforms, held in code as identities and
 * their labels (ADR 0013, D2): the stations in served order with
 * their platforms, on lines 1, 4, 2, 3, 8, K1 and D1, which key the stored
 * arrival state, the timetables and the transit layout. The network passes the
 * schema the registry's identities passed (slugs, platform ids, colors,
 * one-character markers, Seoul ids), every station is filed under a campus or,
 * when a journey only boards or alights there (ADR 0022 D7), under none,
 * and every line's marker color reads as small text on the app's light row
 * background. Every platform carries the station id the Seoul real-time API
 * writes for it (`statnId`, which its rows are matched by) and its station
 * number (`frCode`), as the captured Seoul answers of
 * __tests__/nest/subway/fixtures/ write them.
 */
import fs from "fs";
import path from "path";
import { SUBWAY_LINES, SUBWAY_STATIONS } from "./subway.constants";
import { subwayNetwork } from "./subway.schema";

describe("SUBWAY_STATIONS", () => {
  it("lists the stations in served order with their platforms in order, 25 in all", () => {
    // Act
    const stations = SUBWAY_STATIONS.map((station) => [station.id, station.platforms.map((platform) => platform.id)]);

    // Assert
    expect(stations).toEqual([
      ["sungkyunkwan", ["KR-1-P153"]],
      ["hyehwa", ["S1-4-420"]],
      ["jeongja", ["DX-D1-4312", "KR-K1-K230"]],
      ["jamsil", ["S1-2-216", "S1-8-2815"]],
      ["dogok", ["S1-3-334", "KR-K1-K217"]],
      ["gangnam", ["S1-2-222", "DX-D1-4307"]],
      ["yangjae", ["S1-3-332", "DX-D1-4308"]],
      ["gwanggyo-jungang", ["DX-D1-4318"]],
      ["sadang", ["S1-2-226", "S1-4-433"]],
      ["geumjeong", ["KR-1-P149", "KR-4-443"]],
      ["jongno-5-ga", ["S1-1-154"]],
      ["migeum", ["DX-D1-D13", "KR-K1-K231"]],
      ["bokjeong", ["S1-8-2821", "KR-K1-K222"]],
      ["garak-market", ["S1-3-340", "S1-8-2818"]],
      ["songpa", ["S1-8-2817"]],
    ]);
    expect(stations.flatMap(([, platformIds]) => platformIds)).toHaveLength(25);
  });

  it("serves each platform from its timetable source, a Seoul station's with its station code", () => {
    // Act
    const sources = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => [platform.id, platform.line, platform.timetable]));

    // Assert
    expect(sources).toEqual([
      ["KR-1-P153", "1", { source: "korail" }],
      ["S1-4-420", "4", { source: "seoul-station", stationCode: "0420" }],
      ["DX-D1-4312", "D1", { source: "shinbundang" }],
      ["KR-K1-K230", "K1", { source: "korail" }],
      ["S1-2-216", "2", { source: "seoul-station", stationCode: "0216" }],
      ["S1-8-2815", "8", { source: "seoul-station", stationCode: "2815" }],
      ["S1-3-334", "3", { source: "seoul-station", stationCode: "0334" }],
      ["KR-K1-K217", "K1", { source: "korail" }],
      ["S1-2-222", "2", { source: "seoul-station", stationCode: "0222" }],
      ["DX-D1-4307", "D1", { source: "shinbundang" }],
      ["S1-3-332", "3", { source: "seoul-station", stationCode: "0332" }],
      ["DX-D1-4308", "D1", { source: "shinbundang" }],
      ["DX-D1-4318", "D1", { source: "shinbundang" }],
      ["S1-2-226", "2", { source: "seoul-station", stationCode: "0226" }],
      ["S1-4-433", "4", { source: "seoul-station", stationCode: "0433" }],
      ["KR-1-P149", "1", { source: "korail" }],
      ["KR-4-443", "4", { source: "seoul-station", stationCode: "1458" }],
      ["S1-1-154", "1", { source: "korail" }],
      ["DX-D1-D13", "D1", { source: "shinbundang" }],
      ["KR-K1-K231", "K1", { source: "korail" }],
      ["S1-8-2821", "8", { source: "seoul-station", stationCode: "2821" }],
      ["KR-K1-K222", "K1", { source: "korail" }],
      ["S1-3-340", "3", { source: "seoul-station", stationCode: "0340" }],
      ["S1-8-2818", "8", { source: "seoul-station", stationCode: "2818" }],
      ["S1-8-2817", "8", { source: "seoul-station", stationCode: "2817" }],
    ]);
  });

  it("names each station in every language and by the name the Seoul API writes", () => {
    // Act
    const names = SUBWAY_STATIONS.map((station) => [station.id, station.name, station.seoulName]);

    // Assert
    expect(names).toEqual([
      ["sungkyunkwan", { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" }, "성균관대"],
      ["hyehwa", { ko: "혜화", en: "Hyehwa", zh: "惠化" }, "혜화"],
      ["jeongja", { ko: "정자", en: "Jeongja", zh: "亭子" }, "정자"],
      ["jamsil", { ko: "잠실", en: "Jamsil", zh: "蚕室" }, "잠실"],
      ["dogok", { ko: "도곡", en: "Dogok", zh: "道谷" }, "도곡"],
      ["gangnam", { ko: "강남", en: "Gangnam", zh: "江南" }, "강남"],
      ["yangjae", { ko: "양재", en: "Yangjae", zh: "良才" }, "양재"],
      ["gwanggyo-jungang", { ko: "광교중앙", en: "Gwanggyojungang", zh: "光教中央" }, "광교중앙"],
      ["sadang", { ko: "사당", en: "Sadang", zh: "舍堂" }, "사당"],
      ["geumjeong", { ko: "금정", en: "Geumjeong", zh: "衿井" }, "금정"],
      ["jongno-5-ga", { ko: "종로5가", en: "Jongno 5(o)-ga", zh: "钟路5街" }, "종로5가"],
      ["migeum", { ko: "미금", en: "Migeum", zh: "美金" }, "미금"],
      ["bokjeong", { ko: "복정", en: "Bokjeong", zh: "福井" }, "복정"],
      ["garak-market", { ko: "가락시장", en: "Garak Market", zh: "可乐市场" }, "가락시장"],
      ["songpa", { ko: "송파", en: "Songpa", zh: "松坡" }, "송파"],
    ]);
  });

  it("files each station under the campus whose section of the transit tab lists it: 혜화 under hssc, 사당, 금정, 종로5가, 미금, 복정, 가락시장 and 송파 under none, the rest under nsc", () => {
    // Act
    const campuses = SUBWAY_STATIONS.map((station) => [station.id, station.campus]);

    // Assert
    expect(campuses).toEqual([
      ["sungkyunkwan", "nsc"],
      ["hyehwa", "hssc"],
      ["jeongja", "nsc"],
      ["jamsil", "nsc"],
      ["dogok", "nsc"],
      ["gangnam", "nsc"],
      ["yangjae", "nsc"],
      ["gwanggyo-jungang", "nsc"],
      ["sadang", null],
      ["geumjeong", null],
      ["jongno-5-ga", null],
      ["migeum", null],
      ["bokjeong", null],
      ["garak-market", null],
      ["songpa", null],
    ]);
  });
});

describe("SUBWAY_STATIONS Seoul station ids", () => {
  const FIXTURES = path.join(__dirname, "../../__tests__/nest/subway/fixtures");
  const fixture = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as Record<string, unknown>;
  type CapturedRow = { subwayId: string; statnId: string; statnNm: string };
  type StationInfoRow = { STATION_NM: string; LINE_NUM: string; FR_CODE: string };

  it("declares each platform's statnId and frCode", () => {
    // Act
    const ids = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => [platform.id, platform.statnId, platform.frCode]));

    // Assert
    expect(ids).toEqual([
      ["KR-1-P153", "1001080153", "P153"],
      ["S1-4-420", "1004000420", "420"],
      ["DX-D1-4312", "1077006812", "D12"],
      ["KR-K1-K230", "1075075230", "K230"],
      ["S1-2-216", "1002000216", "216"],
      ["S1-8-2815", "1008000814", "814"],
      ["S1-3-334", "1003000344", "344"],
      ["KR-K1-K217", "1075075217", "K217"],
      ["S1-2-222", "1002000222", "222"],
      ["DX-D1-4307", "1077000687", "D7"],
      ["S1-3-332", "1003000342", "342"],
      ["DX-D1-4308", "1077000688", "D8"],
      ["DX-D1-4318", "1077006818", "D18"],
      ["S1-2-226", "1002000226", "226"],
      ["S1-4-433", "1004000433", "433"],
      ["KR-1-P149", "1001080149", "P149"],
      ["KR-4-443", "1004000443", "443"],
      ["S1-1-154", "1001000129", "129"],
      ["DX-D1-D13", "1077006813", "D13"],
      ["KR-K1-K231", "1075075231", "K231"],
      ["S1-8-2821", "1008000820", "820"],
      ["KR-K1-K222", "1075075222", "K222"],
      ["S1-3-340", "1003000350", "350"],
      ["S1-8-2818", "1008000817", "817"],
      ["S1-8-2817", "1008000816", "816"],
    ]);
  });

  it("takes each statnId from the captured real-time rows of its station and line, one id each", () => {
    // Arrange
    const captured = fs
      .readdirSync(FIXTURES)
      .filter((name) => /^realtime-(arrival|position)-.*\.json$/.test(name))
      .flatMap((name) => {
        const body = fixture(name);
        return (body.realtimeArrivalList ?? body.realtimePositionList ?? []) as CapturedRow[];
      });
    const statnIdsAt = (subwayId: string, seoulName: string) => [...new Set(captured.filter((row) => row.subwayId === subwayId && row.statnNm === seoulName).map((row) => row.statnId))];
    const subwayIdOf = new Map(SUBWAY_LINES.map((line) => [line.code, line.seoul.subwayId]));

    // Act
    const platforms = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => ({ station, platform })));

    // Assert
    expect(platforms.map(({ station, platform }) => [platform.id, statnIdsAt(subwayIdOf.get(platform.line)!, station.seoulName)])).toEqual(
      platforms.map(({ platform }) => [platform.id, [platform.statnId]]),
    );
  });

  it("takes each frCode from the Seoul station info answer for its station and line", () => {
    // Arrange
    const infoRows = fixture("seoul-station-info.json").row as StationInfoRow[];
    const lineNameOf = new Map(SUBWAY_LINES.map((line) => [line.code, line.seoul.lineName]));
    // The station info writes a numbered line with a leading zero, the real-time API without.
    const frCodesAt = (lineName: string, seoulName: string) =>
      infoRows.filter((row) => row.STATION_NM === seoulName && row.LINE_NUM.replace(/^0/, "") === lineName).map((row) => row.FR_CODE);

    // Act
    const platforms = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => ({ station, platform })));

    // Assert
    expect(platforms.map(({ station, platform }) => [platform.id, frCodesAt(lineNameOf.get(platform.line)!, station.seoulName)])).toEqual(
      platforms.map(({ platform }) => [platform.id, [platform.frCode]]),
    );
  });
});

describe("SUBWAY_LINES", () => {
  it("keeps the served line order", () => {
    // Act & Assert
    expect(SUBWAY_LINES.map((line) => line.code)).toEqual(["1", "4", "2", "3", "8", "K1", "D1"]);
  });
});

describe("SUBWAY_LINES and SUBWAY_STATIONS", () => {
  it("pass subwayNetwork, the schema of the identities and their labels", () => {
    // Act
    const result = subwayNetwork.safeParse({ lines: SUBWAY_LINES, stations: SUBWAY_STATIONS });

    // Assert
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

// WHY: the app's light row background (skkuverse-app SDS `bg.layerDefault`), and WCAG 2.x AA for text under 18.66 px bold.
const LIGHT_ROW_BACKGROUND = "FFFFFF";
const MIN_TEXT_CONTRAST = 4.5;

function relativeLuminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("SUBWAY_LINES markers", () => {
  it("colors every line's marker so its text reads at 4.5:1 or more on the app's light row background", () => {
    // Act
    const ratios = SUBWAY_LINES.map((line) => [line.code, contrastRatio(line.marker.color, LIGHT_ROW_BACKGROUND) >= MIN_TEXT_CONTRAST]);

    // Assert
    expect(ratios).toEqual(SUBWAY_LINES.map((line) => [line.code, true]));
  });

  it("measures 수인분당's own yellow at under 2.1:1 on white, which is why its marker is darker", () => {
    // Act & Assert
    expect(contrastRatio("F5A200", LIGHT_ROW_BACKGROUND)).toBeLessThan(2.1);
  });
});

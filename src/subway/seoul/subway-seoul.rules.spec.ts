/**
 * The lines the `seoul` provider polls, derived from the registry: one per
 * line, with the Seoul API's ids, the train-map line and its numbering, and the tables from what the line's rows write
 * to a platform id: the Seoul API's statnId for a served platform and its name
 * for a neighbor, and the train map's name for both, where a neighbor's
 * differs. Each served station's arrival call maps a row's statnId to its
 * platform. And one upstream
 * tick's calls settled apart: what answered is kept beside what failed, and
 * only a tick whose every call failed has nothing to hand on.
 */
import { subwayRegistryFixture } from "../../../__tests__/helpers/subway/topology";
import type { CountdownRow, SubwayRegistry, TrainEvent } from "../subway.types";
import { toSeoulLines, toSeoulStations, toSettledObservations, toTrainMapLines } from "./subway-seoul.rules";

const REGISTRY = subwayRegistryFixture();
const copyOf = (): SubwayRegistry => JSON.parse(JSON.stringify(REGISTRY)) as SubwayRegistry;
const tables = ({ platformIdByStatnId, platformIdByApiName, platformIdByTrainMapName, ...line }: ReturnType<typeof toSeoulLines>[number]) => ({
  ...line,
  platformIdByStatnId: Object.fromEntries(platformIdByStatnId),
  platformIdByApiName: Object.fromEntries(platformIdByApiName),
  platformIdByTrainMapName: Object.fromEntries(platformIdByTrainMapName),
});

const LINE_1_NAMES = {
  성균관대: "KR-1-P153",
  금정: "KR-1-P149",
  군포: "KR-1-P150",
  당정: "KR-1-P151",
  의왕: "KR-1-P152",
  화서: "KR-1-P154",
  수원: "KR-1-P155",
  세류: "KR-1-1715",
  병점: "KR-1-P157",
  명학: "KR-1-P148",
  안양: "KR-1-P147",
  관악: "KR-1-P146",
  석수: "KR-1-P145",
  금천구청: "KR-1-P144",
  독산: "KR-1-P143",
  가산디지털단지: "KR-1-P142",
  구로: "KR-1-141",
  신도림: "KR-1-140",
  영등포: "KR-1-139",
  신길: "KR-1-138",
  대방: "KR-1-137",
  노량진: "KR-1-136",
  용산: "KR-1-135",
  남영: "KR-1-134",
  서울: "S1-1-150",
  시청: "S1-1-151",
  종각: "S1-1-152",
  종로3가: "S1-1-153",
  동대문: "S1-1-155",
  동묘앞: "S1-1-159",
  신설동: "S1-1-156",
  제기동: "S1-1-157",
  청량리: "S1-1-158",
  회기: "KR-1-123",
  종로5가: "S1-1-154",
};
const LINE_4_NAMES = {
  혜화: "S1-4-420",
  길음: "S1-4-417",
  성신여대입구: "S1-4-418",
  한성대입구: "S1-4-419",
  동대문: "S1-4-421",
  동대문역사문화공원: "S1-4-422",
  충무로: "S1-4-423",
  수유: "S1-4-414",
  미아: "S1-4-415",
  미아사거리: "S1-4-416",
  명동: "S1-4-424",
  회현: "S1-4-425",
  서울: "S1-4-426",
  상록수: "KR-4-448",
  반월: "KR-4-447",
  대야미: "KR-4-446",
  수리산: "KR-4-445",
  산본: "KR-4-444",
  범계: "KR-4-442",
  평촌: "KR-4-441",
  인덕원: "KR-4-440",
  정부과천청사: "KR-4-439",
  과천: "KR-4-438",
  대공원: "KR-4-437",
  경마공원: "KR-4-436",
  선바위: "KR-4-435",
  남태령: "S1-4-434",
  "총신대입구(이수)": "S1-4-432",
  동작: "S1-4-431",
  이촌: "S1-4-430",
  신용산: "S1-4-429",
  삼각지: "S1-4-428",
  숙대입구: "S1-4-427",
  사당: "S1-4-433",
  금정: "KR-4-443",
};
// WHY: every name checked against the 2026-10-17 21:05–21:21 position rows and the train map pages, and the
// ones tracked for coverage (ADR 0017, D6) against the 2026-10-18 11:16–11:35 position rows and train map pages (line 4 writes Seoul
// Station as `서울`), and those Sadang, Geumjeong and Jongno 5-ga add against the 2026-10-25 12:23–12:27 ones (both write
// Chongshin Univ. with its suffix), and those Migeum, Bokjeong, Garak Market, Songpa and line 8's stretch to Moran add against the 2026-11-10
// ones (the API writes Namhansanseong Entrance with its suffix).
const LINE_2_NAMES = {
  잠실: "S1-2-216",
  강남: "S1-2-222",
  구의: "S1-2-213",
  강변: "S1-2-214",
  잠실나루: "S1-2-215",
  잠실새내: "S1-2-217",
  종합운동장: "S1-2-218",
  삼성: "S1-2-219",
  선릉: "S1-2-220",
  역삼: "S1-2-221",
  교대: "S1-2-223",
  서초: "S1-2-224",
  방배: "S1-2-225",
  건대입구: "S1-2-212",
  사당: "S1-2-226",
  낙성대: "S1-2-227",
  서울대입구: "S1-2-228",
  봉천: "S1-2-229",
  신림: "S1-2-230",
  신대방: "S1-2-231",
  구로디지털단지: "S1-2-232",
};
const LINE_3_NAMES = {
  도곡: "S1-3-334",
  양재: "S1-3-332",
  고속터미널: "S1-3-329",
  교대: "S1-3-330",
  남부터미널: "S1-3-331",
  매봉: "S1-3-333",
  대치: "S1-3-335",
  학여울: "S1-3-336",
  대청: "S1-3-337",
  압구정: "S1-3-326",
  신사: "S1-3-327",
  잠원: "S1-3-328",
  일원: "S1-3-338",
  수서: "S1-3-339",
  가락시장: "S1-3-340",
  경찰병원: "S1-3-341",
  오금: "S1-3-342",
};
// WHY: the API writes three line 8 stations with a bracketed suffix the train map leaves out.
const LINE_8_STATIONS = {
  잠실: "S1-8-2815",
  강동구청: "S1-8-2813",
  석촌: "S1-8-2816",
  송파: "S1-8-2817",
  가락시장: "S1-8-2818",
  장자호수공원: "GU-8-2808",
  암사역사공원: "S1-8-2809",
  암사: "S1-8-2811",
  문정: "S1-8-2819",
  장지: "S1-8-2820",
  복정: "S1-8-2821",
  남위례: "S1-8-2828",
  산성: "S1-8-2822",
  단대오거리: "S1-8-2824",
  신흥: "S1-8-2825",
  수진: "S1-8-2826",
  모란: "S1-8-2827",
};
const LINE_8_API_NAMES = { ...LINE_8_STATIONS, "천호(풍납토성)": "S1-8-2812", "몽촌토성(평화의문)": "S1-8-2814", "남한산성입구(성남법원,검찰청)": "S1-8-2823" };
const LINE_8_MAP_NAMES = { ...LINE_8_STATIONS, 천호: "S1-8-2812", 몽촌토성: "S1-8-2814", 남한산성입구: "S1-8-2823" };
const SHINBUNDANG_NAMES = {
  정자: "DX-D1-4312",
  강남: "DX-D1-4307",
  양재: "DX-D1-4308",
  광교중앙: "DX-D1-4318",
  신사: "DX-D1-D04",
  논현: "DX-D1-4305",
  신논현: "DX-D1-4306",
  양재시민의숲: "DX-D1-4309",
  청계산입구: "DX-D1-4310",
  판교: "DX-D1-4311",
  미금: "DX-D1-D13",
  동천: "DX-D1-D14",
  수지구청: "DX-D1-D15",
  성복: "DX-D1-4316",
  상현: "DX-D1-4317",
  광교: "DX-D1-4319",
};
const SUIN_BUNDANG_NAMES = {
  정자: "KR-K1-K230",
  도곡: "KR-K1-K217",
  선정릉: "KR-K1-K214",
  선릉: "KR-K1-K215",
  한티: "KR-K1-K216",
  구룡: "KR-K1-K218",
  개포동: "KR-K1-K219",
  대모산입구: "KR-K1-K220",
  이매: "KR-K1-K227",
  서현: "KR-K1-K228",
  수내: "KR-K1-K229",
  미금: "KR-K1-K231",
  오리: "KR-K1-K232",
  죽전: "KR-K1-K233",
  왕십리: "KR-K1-K210",
  서울숲: "KR-K1-K211",
  압구정로데오: "KR-K1-K212",
  강남구청: "KR-K1-K213",
  수서: "KR-K1-K221",
  복정: "KR-K1-K222",
  가천대: "KR-K1-K223",
  태평: "KR-K1-K224",
  모란: "KR-K1-K225",
  야탑: "KR-K1-K226",
  보정: "KR-K1-K234",
  구성: "KR-K1-K235",
  신갈: "KR-K1-K236",
  기흥: "KR-K1-K237",
};

const LINE_1_STATN_IDS = { "1001080153": "KR-1-P153", "1001080149": "KR-1-P149", "1001000129": "S1-1-154" };
const LINE_4_STATN_IDS = { "1004000420": "S1-4-420", "1004000433": "S1-4-433", "1004000443": "KR-4-443" };
const LINE_2_STATN_IDS = { "1002000216": "S1-2-216", "1002000222": "S1-2-222", "1002000226": "S1-2-226" };
const LINE_3_STATN_IDS = { "1003000344": "S1-3-334", "1003000342": "S1-3-332", "1003000350": "S1-3-340" };
const LINE_8_STATN_IDS = { "1008000814": "S1-8-2815", "1008000816": "S1-8-2817", "1008000817": "S1-8-2818", "1008000820": "S1-8-2821" };
const SUIN_BUNDANG_STATN_IDS = { "1075075230": "KR-K1-K230", "1075075217": "KR-K1-K217", "1075075231": "KR-K1-K231", "1075075222": "KR-K1-K222" };
const SHINBUNDANG_STATN_IDS = { "1077006812": "DX-D1-4312", "1077000687": "DX-D1-4307", "1077000688": "DX-D1-4308", "1077006818": "DX-D1-4318", "1077006813": "DX-D1-D13" };
const neighborNames = (names: Record<string, string>, statnIds: Record<string, string>) =>
  Object.fromEntries(Object.entries(names).filter(([, platformId]) => !Object.values(statnIds).includes(platformId)));

describe("toSeoulLines", () => {
  it("gives each line with its served stations and the Seoul names of its platforms, 금정 watched beyond 1호선's", () => {
    // Act
    const lines = toSeoulLines(REGISTRY);

    // Assert
    expect(lines.map(tables)).toEqual([
      {
        subwayId: "1001",
        lineName: "1호선",
        trainMapLine: "1",
        trainNumbers: "timetable",
        platformIdByStatnId: LINE_1_STATN_IDS,
        platformIdByApiName: neighborNames(LINE_1_NAMES, LINE_1_STATN_IDS),
        platformIdByTrainMapName: LINE_1_NAMES,
      },
      {
        subwayId: "1004",
        lineName: "4호선",
        trainMapLine: "4",
        trainNumbers: "timetable",
        platformIdByStatnId: LINE_4_STATN_IDS,
        platformIdByApiName: neighborNames(LINE_4_NAMES, LINE_4_STATN_IDS),
        platformIdByTrainMapName: LINE_4_NAMES,
      },
      {
        subwayId: "1002",
        lineName: "2호선",
        trainMapLine: "2",
        trainNumbers: "circle",
        platformIdByStatnId: LINE_2_STATN_IDS,
        platformIdByApiName: neighborNames(LINE_2_NAMES, LINE_2_STATN_IDS),
        platformIdByTrainMapName: LINE_2_NAMES,
      },
      {
        subwayId: "1003",
        lineName: "3호선",
        trainMapLine: "3",
        trainNumbers: "timetable",
        platformIdByStatnId: LINE_3_STATN_IDS,
        platformIdByApiName: neighborNames(LINE_3_NAMES, LINE_3_STATN_IDS),
        platformIdByTrainMapName: LINE_3_NAMES,
      },
      {
        subwayId: "1008",
        lineName: "8호선",
        trainMapLine: "8",
        trainNumbers: "timetable",
        platformIdByStatnId: LINE_8_STATN_IDS,
        platformIdByApiName: neighborNames(LINE_8_API_NAMES, LINE_8_STATN_IDS),
        platformIdByTrainMapName: LINE_8_MAP_NAMES,
      },
      {
        subwayId: "1075",
        lineName: "수인분당선",
        trainMapLine: undefined,
        trainNumbers: "timetable",
        platformIdByStatnId: SUIN_BUNDANG_STATN_IDS,
        platformIdByApiName: neighborNames(SUIN_BUNDANG_NAMES, SUIN_BUNDANG_STATN_IDS),
        platformIdByTrainMapName: SUIN_BUNDANG_NAMES,
      },
      {
        subwayId: "1077",
        lineName: "신분당선",
        trainMapLine: undefined,
        trainNumbers: "trainset",
        platformIdByStatnId: SHINBUNDANG_STATN_IDS,
        platformIdByApiName: neighborNames(SHINBUNDANG_NAMES, SHINBUNDANG_STATN_IDS),
        platformIdByTrainMapName: SHINBUNDANG_NAMES,
      },
    ]);
  });

  it("maps a neighbor by its train-map name on the map and by its Seoul name in the API", () => {
    // Arrange
    const registry = copyOf();
    registry.neighbors["S1-4-417"] = { line: "4", seoulName: "길음(동덕여대)", trainMapName: "길음" };

    // Act
    const line4 = toSeoulLines(registry)[1];

    // Assert
    expect(line4?.platformIdByApiName.get("길음(동덕여대)")).toBe("S1-4-417");
    expect(line4?.platformIdByApiName.has("길음")).toBe(false);
    expect(line4?.platformIdByTrainMapName.get("길음")).toBe("S1-4-417");
  });

  it("puts two served stations of one line on that one line", () => {
    // Arrange
    const registry = copyOf();
    const sungkyunkwan = registry.stations[0]!;
    registry.stations.push({ ...sungkyunkwan, id: "uijeongbu", seoulName: "의정부", platforms: [{ ...sungkyunkwan.platforms[0]!, id: "KR-1-X100", statnId: "1001000110" }] });

    // Act
    const lines = toSeoulLines(registry);

    // Assert
    expect(lines).toHaveLength(REGISTRY.lines.length);
    expect(lines[0]?.platformIdByStatnId.get("1001080153")).toBe("KR-1-P153");
    expect(lines[0]?.platformIdByStatnId.get("1001000110")).toBe("KR-1-X100");
  });

  it("leaves out the train-map line of a line with no map", () => {
    // Arrange
    const registry = copyOf();
    delete registry.lines[1]!.seoul.trainMapLine;

    // Act
    const lines = toSeoulLines(registry);

    // Assert
    expect(lines.map((line) => line.trainMapLine)).toEqual(["1", undefined, "2", "3", "8", undefined, undefined]);
  });
});

describe("toSeoulStations", () => {
  it("gives each served station its one arrival call by Seoul name, its rows' statnId mapped to its platform", () => {
    // Act
    const stations = toSeoulStations(REGISTRY);

    // Assert
    expect(stations.map(({ seoulName, platformByStatnId }) => [seoulName, Object.fromEntries(platformByStatnId)])).toEqual([
      ["성균관대", { "1001080153": { platformId: "KR-1-P153", trainNumbers: "timetable" } }],
      ["혜화", { "1004000420": { platformId: "S1-4-420", trainNumbers: "timetable" } }],
      [
        "정자",
        {
          "1077006812": { platformId: "DX-D1-4312", trainNumbers: "trainset" },
          "1075075230": { platformId: "KR-K1-K230", trainNumbers: "timetable" },
        },
      ],
      [
        "잠실",
        {
          "1002000216": { platformId: "S1-2-216", trainNumbers: "circle" },
          "1008000814": { platformId: "S1-8-2815", trainNumbers: "timetable" },
        },
      ],
      [
        "도곡",
        {
          "1003000344": { platformId: "S1-3-334", trainNumbers: "timetable" },
          "1075075217": { platformId: "KR-K1-K217", trainNumbers: "timetable" },
        },
      ],
      [
        "강남",
        {
          "1002000222": { platformId: "S1-2-222", trainNumbers: "circle" },
          "1077000687": { platformId: "DX-D1-4307", trainNumbers: "trainset" },
        },
      ],
      [
        "양재",
        {
          "1003000342": { platformId: "S1-3-332", trainNumbers: "timetable" },
          "1077000688": { platformId: "DX-D1-4308", trainNumbers: "trainset" },
        },
      ],
      ["광교중앙", { "1077006818": { platformId: "DX-D1-4318", trainNumbers: "trainset" } }],
      [
        "사당",
        {
          "1002000226": { platformId: "S1-2-226", trainNumbers: "circle" },
          "1004000433": { platformId: "S1-4-433", trainNumbers: "timetable" },
        },
      ],
      [
        "금정",
        {
          "1001080149": { platformId: "KR-1-P149", trainNumbers: "timetable" },
          "1004000443": { platformId: "KR-4-443", trainNumbers: "timetable" },
        },
      ],
      ["종로5가", { "1001000129": { platformId: "S1-1-154", trainNumbers: "timetable" } }],
      [
        "미금",
        {
          "1077006813": { platformId: "DX-D1-D13", trainNumbers: "trainset" },
          "1075075231": { platformId: "KR-K1-K231", trainNumbers: "timetable" },
        },
      ],
      [
        "복정",
        {
          "1008000820": { platformId: "S1-8-2821", trainNumbers: "timetable" },
          "1075075222": { platformId: "KR-K1-K222", trainNumbers: "timetable" },
        },
      ],
      [
        "가락시장",
        {
          "1003000350": { platformId: "S1-3-340", trainNumbers: "timetable" },
          "1008000817": { platformId: "S1-8-2818", trainNumbers: "timetable" },
        },
      ],
      ["송파", { "1008000816": { platformId: "S1-8-2817", trainNumbers: "timetable" } }],
    ]);
  });

  it("maps both lines of a transfer station in its one call", () => {
    // Arrange
    const registry = copyOf();
    const [sungkyunkwan, hyehwa] = registry.stations as [SubwayRegistry["stations"][number], SubwayRegistry["stations"][number]];
    registry.stations = [{ ...hyehwa, platforms: [...hyehwa.platforms, ...sungkyunkwan.platforms] }];

    // Act
    const [station] = toSeoulStations(registry);

    // Assert
    expect(station?.seoulName).toBe("혜화");
    expect([...(station?.platformByStatnId.entries() ?? [])].map(([statnId, platform]) => [statnId, platform.platformId])).toEqual([
      ["1004000420", "S1-4-420"],
      ["1001080153", "KR-1-P153"],
    ]);
  });
});

describe("toTrainMapLines", () => {
  it("crawls each line with a train map, through its train-map names, and leaves out a line with none", () => {
    // Arrange
    const registry = copyOf();
    delete registry.lines[0]!.seoul.trainMapLine;

    // Act
    const lines = toTrainMapLines(toSeoulLines(registry));

    // Assert
    expect(lines.map(({ trainMapLine, platformIdByName }) => [trainMapLine, platformIdByName.get("혜화")])).toEqual([
      ["4", "S1-4-420"],
      ["2", undefined],
      ["3", undefined],
      ["8", undefined],
    ]);
  });
});

describe("toSettledObservations", () => {
  const event = (trainNo: string): TrainEvent => ({
    trainNo,
    platformId: "KR-1-P153",
    state: "arrived",
    stateChangedAt: new Date("2026-10-16T20:16:00Z"),
    destination: "광운대",
  });
  const row: CountdownRow = { trainNo: "4674", platformId: "S1-4-420", generatedAt: new Date("2026-10-16T20:16:00Z"), remainingSec: 150 };
  const answered = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
  const failed = <T>(reason: Error): PromiseSettledResult<T> => ({ status: "rejected", reason });
  const line4Down = new Error("seoul-trainmap: line 4: no train");
  const hyehwaDown = new Error("realtimeStationArrival: HTTP 500");

  it.each([
    ["no call failed", [answered([event("0493")]), answered([event("4204")])], [answered([row])], ["0493", "4204"], 1, []],
    ["one line's call failed", [answered([event("0493")]), failed<TrainEvent[]>(line4Down)], [answered([row])], ["0493"], 1, [line4Down]],
    ["every call but one failed", [answered([event("0493")]), failed<TrainEvent[]>(line4Down)], [failed<CountdownRow[]>(hyehwaDown)], ["0493"], 0, [line4Down, hyehwaDown]],
  ])("keeps what answered beside what failed when %s", (_label, eventResults, countdownResults, trainNos, rowCount, failures) => {
    // Act
    const settled = toSettledObservations("seoul-subway-api", eventResults, countdownResults);

    // Assert
    expect(settled.source).toBe("seoul-subway-api");
    expect(settled.events.map((e) => e.trainNo)).toEqual(trainNos);
    expect(settled.countdownRows).toHaveLength(rowCount);
    expect(settled.failures).toEqual(failures);
  });

  it("throws the first failure when every call failed, so nothing replaces the last good tick", () => {
    // Arrange
    const results = [failed<TrainEvent[]>(line4Down), failed<TrainEvent[]>(new Error("line 1 down"))];

    // Act & Assert
    expect(() => toSettledObservations("seoul-trainmap", results, [])).toThrow(line4Down);
  });
});

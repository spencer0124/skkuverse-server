import type { LocalizedName, NetworkStation, SubwayLine, SubwayNetwork } from "./subway.types";

// WHY: an approaching train is taken to arrive this long after its approach was shown.
export const APPROACH_LEAD_MS = 30_000;

export const MAX_UPSTREAM_PLATFORMS = 3;

const named = (ko: string, en: string, zh: string): LocalizedName => ({ ko, en, zh });
const marked = (ko: string, zh: string, color: string): SubwayLine["marker"] => ({ text: { ko, en: ko, zh }, color });

// WHY: identities and their labels, branched on or sent upstream (ADR 0013, D2); each platform's
// directions and the neighbor stops are the subway-topology dataset's. Order is the served order.
export const SUBWAY_LINES: readonly SubwayLine[] = [
  { code: "1", name: named("1호선", "Line 1", "1号线"), color: "0052A4", marker: marked("1", "1", "0052A4"), seoul: { subwayId: "1001", lineName: "1호선", trainMapLine: "1", trainNumbers: "timetable" } },
  { code: "4", name: named("4호선", "Line 4", "4号线"), color: "00A5DE", marker: marked("4", "4", "007FAB"), seoul: { subwayId: "1004", lineName: "4호선", trainMapLine: "4", trainNumbers: "timetable" } },
  { code: "2", name: named("2호선", "Line 2", "2号线"), color: "00A84D", marker: marked("2", "2", "00893F"), seoul: { subwayId: "1002", lineName: "2호선", trainMapLine: "2", trainNumbers: "circle" } },
  { code: "3", name: named("3호선", "Line 3", "3号线"), color: "EF7C1C", marker: marked("3", "3", "BB5C0D"), seoul: { subwayId: "1003", lineName: "3호선", trainMapLine: "3", trainNumbers: "timetable" } },
  { code: "8", name: named("8호선", "Line 8", "8号线"), color: "E6186C", marker: marked("8", "8", "E4186B"), seoul: { subwayId: "1008", lineName: "8호선", trainMapLine: "8", trainNumbers: "timetable" } },
  { code: "K1", name: named("수인분당선", "Suin–Bundang Line", "水仁·盆唐线"), color: "F5A200", marker: marked("수", "水", "A26B00"), seoul: { subwayId: "1075", lineName: "수인분당선", trainNumbers: "timetable" } },
  { code: "D1", name: named("신분당선", "Shinbundang Line", "新盆唐线"), color: "D4003B", marker: marked("신", "新", "D4003B"), seoul: { subwayId: "1077", lineName: "신분당선", trainNumbers: "trainset" } },
];

const KORAIL = { source: "korail" } as const;
const SHINBUNDANG = { source: "shinbundang" } as const;
const seoulStation = (stationCode: string) => ({ source: "seoul-station", stationCode }) as const;

// EVIDENCE: each platform's statnId as the Seoul real-time rows write it and its frCode as SearchInfoBySubwayNameService
// does, captured 2026-10-25 and 2026-11-10 (__tests__/nest/subway/fixtures/; subway.constants.spec.ts checks both against them).
export const SUBWAY_STATIONS: readonly NetworkStation[] = [
  { id: "sungkyunkwan", name: named("성균관대", "Sungkyunkwan Univ.", "成均馆大学"), seoulName: "성균관대", campus: "nsc", platforms: [{ id: "KR-1-P153", line: "1", statnId: "1001080153", frCode: "P153", timetable: KORAIL }] },
  { id: "hyehwa", name: named("혜화", "Hyehwa", "惠化"), seoulName: "혜화", campus: "hssc", platforms: [{ id: "S1-4-420", line: "4", statnId: "1004000420", frCode: "420", timetable: seoulStation("0420") }] },
  { id: "jeongja", name: named("정자", "Jeongja", "亭子"), seoulName: "정자", campus: "nsc", platforms: [{ id: "DX-D1-4312", line: "D1", statnId: "1077006812", frCode: "D12", timetable: SHINBUNDANG }, { id: "KR-K1-K230", line: "K1", statnId: "1075075230", frCode: "K230", timetable: KORAIL }] },
  { id: "jamsil", name: named("잠실", "Jamsil", "蚕室"), seoulName: "잠실", campus: "nsc", platforms: [{ id: "S1-2-216", line: "2", statnId: "1002000216", frCode: "216", timetable: seoulStation("0216") }, { id: "S1-8-2815", line: "8", statnId: "1008000814", frCode: "814", timetable: seoulStation("2815") }] },
  { id: "dogok", name: named("도곡", "Dogok", "道谷"), seoulName: "도곡", campus: "nsc", platforms: [{ id: "S1-3-334", line: "3", statnId: "1003000344", frCode: "344", timetable: seoulStation("0334") }, { id: "KR-K1-K217", line: "K1", statnId: "1075075217", frCode: "K217", timetable: KORAIL }] },
  { id: "gangnam", name: named("강남", "Gangnam", "江南"), seoulName: "강남", campus: "nsc", platforms: [{ id: "S1-2-222", line: "2", statnId: "1002000222", frCode: "222", timetable: seoulStation("0222") }, { id: "DX-D1-4307", line: "D1", statnId: "1077000687", frCode: "D7", timetable: SHINBUNDANG }] },
  { id: "yangjae", name: named("양재", "Yangjae", "良才"), seoulName: "양재", campus: "nsc", platforms: [{ id: "S1-3-332", line: "3", statnId: "1003000342", frCode: "342", timetable: seoulStation("0332") }, { id: "DX-D1-4308", line: "D1", statnId: "1077000688", frCode: "D8", timetable: SHINBUNDANG }] },
  { id: "gwanggyo-jungang", name: named("광교중앙", "Gwanggyojungang", "光教中央"), seoulName: "광교중앙", campus: "nsc", platforms: [{ id: "DX-D1-4318", line: "D1", statnId: "1077006818", frCode: "D18", timetable: SHINBUNDANG }] },
  { id: "sadang", name: named("사당", "Sadang", "舍堂"), seoulName: "사당", campus: null, platforms: [{ id: "S1-2-226", line: "2", statnId: "1002000226", frCode: "226", timetable: seoulStation("0226") }, { id: "S1-4-433", line: "4", statnId: "1004000433", frCode: "433", timetable: seoulStation("0433") }] },
  { id: "geumjeong", name: named("금정", "Geumjeong", "衿井"), seoulName: "금정", campus: null, platforms: [{ id: "KR-1-P149", line: "1", statnId: "1001080149", frCode: "P149", timetable: KORAIL }, { id: "KR-4-443", line: "4", statnId: "1004000443", frCode: "443", timetable: seoulStation("1458") }] },
  { id: "jongno-5-ga", name: named("종로5가", "Jongno 5(o)-ga", "钟路5街"), seoulName: "종로5가", campus: null, platforms: [{ id: "S1-1-154", line: "1", statnId: "1001000129", frCode: "129", timetable: KORAIL }] },
  { id: "migeum", name: named("미금", "Migeum", "美金"), seoulName: "미금", campus: null, platforms: [{ id: "DX-D1-D13", line: "D1", statnId: "1077006813", frCode: "D13", timetable: SHINBUNDANG }, { id: "KR-K1-K231", line: "K1", statnId: "1075075231", frCode: "K231", timetable: KORAIL }] },
  { id: "bokjeong", name: named("복정", "Bokjeong", "福井"), seoulName: "복정", campus: null, platforms: [{ id: "S1-8-2821", line: "8", statnId: "1008000820", frCode: "820", timetable: seoulStation("2821") }, { id: "KR-K1-K222", line: "K1", statnId: "1075075222", frCode: "K222", timetable: KORAIL }] },
  { id: "garak-market", name: named("가락시장", "Garak Market", "可乐市场"), seoulName: "가락시장", campus: null, platforms: [{ id: "S1-3-340", line: "3", statnId: "1003000350", frCode: "350", timetable: seoulStation("0340") }, { id: "S1-8-2818", line: "8", statnId: "1008000817", frCode: "817", timetable: seoulStation("2818") }] },
  { id: "songpa", name: named("송파", "Songpa", "松坡"), seoulName: "송파", campus: null, platforms: [{ id: "S1-8-2817", line: "8", statnId: "1008000816", frCode: "816", timetable: seoulStation("2817") }] },
];

export const SUBWAY_NETWORK: SubwayNetwork = { lines: SUBWAY_LINES, stations: SUBWAY_STATIONS };

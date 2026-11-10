/**
 * toTopologyIssues, the checks a `subway-topology` push runs against the
 * checked-out code's network: revision 1 against
 * SUBWAY_NETWORK has none. Every issue the committed registry failed the boot
 * on for its directions and neighbors is one issue with its path: a named
 * stop that is neither a served platform nor a neighbor, or is on another
 * line than its platform; a previous or next stop with no name; a neighbor on
 * a line the code does not hold; a train-map name on a line with no train
 * map. A served platform with no entry is unplaced and an entry for a
 * platform the code does not serve is unknown, each named at its path.
 * toMissingPlatformIds and toUnknownPlatformIds list those two, which the
 * read logs. toUnnamedStopIds lists the previous and next stops a registry
 * has no name for, as the arrivals mapper names them: a neighbor's own name,
 * else the station of a platform the code serves. A topology pushed ahead of
 * a deploy can promote a neighbor to a served platform the running code does
 * not know yet, dropping the neighbor entry that named it.
 *
 * toRouteIssues checks a topology against each served platform's timetable
 * routes, as the tracker follows them: a direction's upstream platforms are
 * the three stops before it on the route, nearest first, its next platform
 * the stop after it, and its watched platforms the rest of the route before
 * the upstream ones, nearest first; and every stop on the route before the
 * platform is a served platform or a neighbor, so the pollers can name it.
 * Revision 1 holds against the stored timetables (the fixture) of every day type.
 */
import { storedSubwayTimetableService } from "../../../__tests__/helpers/subway/timetables";
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import type { LineRoutes } from "../timetable/subway-timetable.types";
import { SUBWAY_LINES, SUBWAY_NETWORK, SUBWAY_STATIONS } from "../subway.constants";
import type { SubwayNetwork } from "../subway.types";
import { toSubwayRegistry } from "./subway-topology.mapper";
import { toMissingPlatformIds, toRouteIssues, toTopologyIssues, toUnknownPlatformIds, toUnnamedStopIds } from "./subway-topology.rules";
import type { SubwayTopologyData } from "./subway-topology.types";

const NETWORK: SubwayNetwork = { lines: SUBWAY_LINES, stations: SUBWAY_STATIONS };
const PLATFORM_IDS = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => platform.id));

// The fixture as untyped JSON, so a test can break it.
const fixture = (): Record<string, any> => subwayTopologyFixture();

const issueLinesOf = (topology: Record<string, any>, network: SubwayNetwork = NETWORK): string[] =>
  toTopologyIssues(topology as SubwayTopologyData, network).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

describe("toTopologyIssues", () => {
  it("finds no issue in revision 1 against the code's network", () => {
    // Act & Assert
    expect(issueLinesOf(fixture())).toEqual([]);
  });

  it.each([
    [
      "Next stop without a name: a next platform whose neighbor has no name",
      (data: Record<string, any>) => delete data.neighbors["KR-1-P152"].name,
      'platforms.KR-1-P153.up.nextPlatformId: neighbor "KR-1-P152" is a previous or next station and has no name',
    ],
    [
      "a previous stop whose neighbor has no name",
      (data: Record<string, any>) => delete data.neighbors["KR-1-P154"].name,
      'platforms.KR-1-P153.up.upstreamPlatformIds.0: neighbor "KR-1-P154" is a previous or next station and has no name',
    ],
    [
      "Watched stop on another line: S1-3-330 watched by S1-4-420",
      (data: Record<string, any>) => data.platforms["S1-4-420"].up.watchedPlatformIds.push("S1-3-330"),
      'platforms.S1-4-420.up.watchedPlatformIds.25: "S1-3-330" is on line "3", not "4"',
    ],
    [
      "an upstream platform on another line",
      (data: Record<string, any>) => (data.platforms["S1-4-420"].down.upstreamPlatformIds[1] = "KR-1-P151"),
      'platforms.S1-4-420.down.upstreamPlatformIds.1: "KR-1-P151" is on line "1", not "4"',
    ],
    [
      "a watched platform neither served nor a neighbor",
      (data: Record<string, any>) => (data.platforms["KR-1-P153"].down.watchedPlatformIds = ["KR-1-P158"]),
      'platforms.KR-1-P153.down.watchedPlatformIds.0: "KR-1-P158" is neither a served platform nor a neighbor',
    ],
    [
      "a neighbor on a line the code does not hold",
      (data: Record<string, any>) => (data.neighbors["S1-9-901"] = { line: "9", seoulName: "어딘가" }),
      'neighbors.S1-9-901.line: "9" is not a listed line',
    ],
    [
      "a train-map name on a line with no train map",
      (data: Record<string, any>) => (data.neighbors["KR-K1-K232"].trainMapName = "오리역"),
      'neighbors.KR-K1-K232.trainMapName: line "K1" has no train map',
    ],
    [
      "Platform added in code: no entry for a served platform",
      (data: Record<string, any>) => delete data.platforms["S1-2-222"],
      'platforms.S1-2-222: platform "S1-2-222" is unplaced: the checked-out code serves it, so it needs directions',
    ],
    [
      "Unknown platform: an entry for a platform the code does not serve",
      (data: Record<string, any>) => (data.platforms["S1-9-999"] = data.platforms["S1-4-420"]),
      'platforms.S1-9-999: "S1-9-999" is not a platform the checked-out code serves',
    ],
  ])("reports %s, with its path", (_case, arrange, issue) => {
    // Arrange
    const data = fixture();
    arrange(data);

    // Act & Assert
    expect(issueLinesOf(data)).toContain(issue);
  });

  it("Served station id: reports a neighbor taking the id of a station the code serves, with its path", () => {
    // Arrange
    const data = fixture();
    data.neighbors["S1-4-421"].stationId = "hyehwa";

    // Act & Assert
    expect(issueLinesOf(data)).toEqual(['neighbors.S1-4-421.stationId: "hyehwa" is the id of a station the checked-out code serves']);
  });

  it("accepts a served platform named as a neighbor stop, which takes its station's name", () => {
    // Arrange
    const data = fixture();
    data.platforms["S1-3-334"].up.nextPlatformId = "S1-3-332";

    // Act & Assert
    expect(issueLinesOf(data)).toEqual([]);
  });

  it("checks no direction of an unknown entry beyond naming it", () => {
    // Arrange
    const data = fixture();
    data.platforms["S1-9-999"] = { ...data.platforms["S1-4-420"], up: { ...data.platforms["S1-4-420"].up, nextPlatformId: "S1-9-998" } };

    // Act & Assert
    expect(issueLinesOf(data)).toEqual(['platforms.S1-9-999: "S1-9-999" is not a platform the checked-out code serves']);
  });
});

describe("toMissingPlatformIds", () => {
  it("lists the served platforms the topology has no entry for, in the code's order", () => {
    // Arrange
    const data = fixture();
    delete data.platforms["S1-2-222"];
    delete data.platforms["KR-1-P153"];

    // Act & Assert
    expect(toMissingPlatformIds(data as SubwayTopologyData, PLATFORM_IDS)).toEqual(["KR-1-P153", "S1-2-222"]);
  });
});

describe("toUnknownPlatformIds", () => {
  it("lists the entries for platforms the code does not serve", () => {
    // Arrange
    const data = fixture();
    data.platforms["S1-9-999"] = data.platforms["S1-4-420"];

    // Act & Assert
    expect(toUnknownPlatformIds(data as SubwayTopologyData, PLATFORM_IDS)).toEqual(["S1-9-999"]);
  });
});

describe("toUnnamedStopIds", () => {
  const unnamedIn = (data: Record<string, any>): string[] => toUnnamedStopIds(toSubwayRegistry(SUBWAY_NETWORK, data as SubwayTopologyData));

  it("lists none for revision 1, whose upstream stops past the first carry no name", () => {
    // Act & Assert
    expect(unnamedIn(fixture())).toEqual([]);
  });

  it("Topology pushed ahead of a deploy: lists KR-1-P154 once when a push serves it and drops its neighbor entry, though 성균관대 names it both ways", () => {
    // Arrange
    const data = fixture();
    data.platforms["KR-1-P154"] = data.platforms["KR-1-P153"];
    delete data.neighbors["KR-1-P154"];

    // Act & Assert
    expect(unnamedIn(data)).toEqual(["KR-1-P154"]);
  });

  it("lists a next stop whose neighbor has no name, and not an upstream stop past the first", () => {
    // Arrange
    const data = fixture();
    delete data.neighbors["KR-1-P152"].name;
    data.platforms["S1-4-420"].up.upstreamPlatformIds[1] = "S1-4-498";

    // Act & Assert
    expect(unnamedIn(data)).toEqual(["KR-1-P152"]);
  });

  it("names a served platform by its station, even one the topology leaves out", () => {
    // Arrange
    const data = fixture();
    data.platforms["S1-3-334"].up.nextPlatformId = "S1-3-332";
    delete data.platforms["DX-D1-4308"];

    // Act & Assert
    expect(unnamedIn(data)).toEqual([]);
  });
});

describe("toRouteIssues", () => {
  // WHY: a Friday, a Saturday and a Sunday, so every day type's table gives its routes.
  const DAYS = ["2026-10-16T03:00:00Z", "2026-10-17T03:00:00Z", "2026-10-18T03:00:00Z"];

  async function storedRoutes(): Promise<Record<string, LineRoutes[]>> {
    const service = storedSubwayTimetableService();
    const schedules = (await Promise.all(DAYS.map((day) => service.listPlatformSchedules(new Date(day))))).flatMap((listed) => listed.schedules);
    const routesByPlatformId: Record<string, LineRoutes[]> = {};
    for (const { platform, lineRoutes } of schedules) (routesByPlatformId[platform.id] ??= []).push(lineRoutes);
    return routesByPlatformId;
  }

  const routeIssueLinesOf = async (topology: Record<string, any>): Promise<string[]> =>
    toRouteIssues(topology as SubwayTopologyData, await storedRoutes()).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  it("finds no issue in revision 1 against the stored timetables of every day type", async () => {
    // Act
    const lines = await routeIssueLinesOf(fixture());

    // Assert
    expect(lines).toEqual([]);
  });

  it.each([
    [
      "Upstream reordered: 혜화 down's second and third upstream platforms swapped",
      (data: Record<string, any>) => {
        const ids = data.platforms["S1-4-420"].down.upstreamPlatformIds;
        [ids[1], ids[2]] = [ids[2], ids[1]];
      },
      /^platforms\.S1-4-420\.down\.upstreamPlatformIds: .*"S1-4-419","S1-4-418","S1-4-417"/,
    ],
    [
      "a next platform that is not the stop after the platform",
      (data: Record<string, any>) => (data.platforms["KR-1-P153"].up.nextPlatformId = "KR-1-P151"),
      /^platforms\.KR-1-P153\.up\.nextPlatformId: .*"KR-1-P152"/,
    ],
    [
      "watched platforms out of route order",
      (data: Record<string, any>) => data.platforms["KR-1-P153"].down.watchedPlatformIds.reverse(),
      /^platforms\.KR-1-P153\.down\.watchedPlatformIds: .*"KR-1-P149","KR-1-P148","KR-1-P147"/,
    ],
    [
      "Watched platform dropped with its neighbor: 성균관대 down without 안양 (KR-1-P147)",
      (data: Record<string, any>) => {
        data.platforms["KR-1-P153"].down.watchedPlatformIds.pop();
        delete data.neighbors["KR-1-P147"];
      },
      /^platforms\.KR-1-P153\.down: "KR-1-P147" .*neither a served platform nor a neighbor/,
    ],
  ])("reports %s, with its path", async (_case, arrange, issue) => {
    // Arrange
    const data = fixture();
    arrange(data);

    // Act
    const lines = await routeIssueLinesOf(data);

    // Assert
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(issue)]));
  });

  it("checks only the platforms that have both an entry and routes, leaving the unplaced and unknown ones to toTopologyIssues", async () => {
    // Arrange
    const data = fixture();
    delete data.platforms["S1-2-222"];
    data.platforms["S1-9-999"] = data.platforms["S1-4-420"];

    // Act
    const lines = await routeIssueLinesOf(data);

    // Assert
    expect(lines).toEqual([]);
  });
});

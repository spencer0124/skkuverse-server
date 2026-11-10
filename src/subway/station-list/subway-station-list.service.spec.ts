/**
 * SubwayStationListService over the served stations in code and
 * SubwayStationCoordsService on FakeSubwayStationCoordsRepository: every
 * served station in SUBWAY_STATIONS order, in the request language, each
 * joined to its own coords by slug; a station the stored revision lacks, or
 * every station while the coords cannot be read, is listed with null coords,
 * never dropped and never an error.
 */
import { stationCoordsFixture, storedStationCoordsRepository, storedStationCoordsService } from "../../../__tests__/helpers/subway/station-coords";
import { SubwayStationsService } from "../stations/subway-stations.service";
import { SubwayStationListService } from "./subway-station-list.service";

const SERVED_ORDER = ["sungkyunkwan", "hyehwa", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang", "sadang", "geumjeong", "jongno-5-ga", "migeum", "bokjeong", "garak-market", "songpa"];

const serviceOver = (coordsRepository = storedStationCoordsRepository()) => new SubwayStationListService(new SubwayStationsService(), storedStationCoordsService(coordsRepository));

describe("SubwayStationListService.listStations", () => {
  it("lists every served station in order, each with its own coords, in the request language", async () => {
    // Arrange
    const service = serviceOver();

    // Act
    const { stations } = await service.listStations("en");

    // Assert
    expect(stations.map(({ id, coords }) => [id, coords])).toEqual(SERVED_ORDER.map((id) => [id, stationCoordsFixture().stations[id]]));
    expect(stations[1]?.title).toBe("Hyehwa Station");
  });

  it("lists a station the stored revision lacks with null coords, keeping the others'", async () => {
    // Arrange
    const lacking = stationCoordsFixture();
    delete lacking.stations.gangnam;
    const service = serviceOver(storedStationCoordsRepository(lacking));

    // Act
    const { stations } = await service.listStations("ko");

    // Assert
    expect(stations.map(({ id }) => id)).toEqual(SERVED_ORDER);
    expect(stations.find(({ id }) => id === "gangnam")?.coords).toBeNull();
    expect(stations.find(({ id }) => id === "yangjae")?.coords).toEqual({ lat: 37.484143, lng: 127.034278 });
  });

  it("lists every station with null coords while the stored coords cannot be read", async () => {
    // Arrange
    const unreadable = storedStationCoordsRepository();
    unreadable.failWith = new Error("connection reset");
    const service = serviceOver(unreadable);

    // Act
    const { stations } = await service.listStations("ko");

    // Assert
    expect(stations.map(({ id, coords }) => [id, coords])).toEqual(SERVED_ORDER.map((id) => [id, null]));
  });
});

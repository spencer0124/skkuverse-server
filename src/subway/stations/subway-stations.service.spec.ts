/**
 * SubwayStationsService, subway's door for the modules that list the served
 * stations (the transit tab): every station of the registry, in its order,
 * by slug, with its title and its lines' codes, names, colors and markers.
 */
import { SubwayStationsService } from "./subway-stations.service";

describe("SubwayStationsService.listStations", () => {
  it("lists every served station in order, by slug, with their lines' codes and colors", () => {
    // Arrange
    const service = new SubwayStationsService();

    // Act
    const stations = service.listStations();

    // Assert
    expect(stations.map(({ id, lines }) => ({ id, lines: lines.map(({ code, color }) => ({ code, color })) }))).toEqual([
      { id: "sungkyunkwan", lines: [{ code: "1", color: "0052A4" }] },
      { id: "hyehwa", lines: [{ code: "4", color: "00A5DE" }] },
      {
        id: "jeongja",
        lines: [
          { code: "D1", color: "D4003B" },
          { code: "K1", color: "F5A200" },
        ],
      },
      {
        id: "jamsil",
        lines: [
          { code: "2", color: "00A84D" },
          { code: "8", color: "E6186C" },
        ],
      },
      {
        id: "dogok",
        lines: [
          { code: "3", color: "EF7C1C" },
          { code: "K1", color: "F5A200" },
        ],
      },
      {
        id: "gangnam",
        lines: [
          { code: "2", color: "00A84D" },
          { code: "D1", color: "D4003B" },
        ],
      },
      {
        id: "yangjae",
        lines: [
          { code: "3", color: "EF7C1C" },
          { code: "D1", color: "D4003B" },
        ],
      },
      { id: "gwanggyo-jungang", lines: [{ code: "D1", color: "D4003B" }] },
      {
        id: "sadang",
        lines: [
          { code: "2", color: "00A84D" },
          { code: "4", color: "00A5DE" },
        ],
      },
      {
        id: "geumjeong",
        lines: [
          { code: "1", color: "0052A4" },
          { code: "4", color: "00A5DE" },
        ],
      },
      { id: "jongno-5-ga", lines: [{ code: "1", color: "0052A4" }] },
      {
        id: "migeum",
        lines: [
          { code: "D1", color: "D4003B" },
          { code: "K1", color: "F5A200" },
        ],
      },
      {
        id: "bokjeong",
        lines: [
          { code: "8", color: "E6186C" },
          { code: "K1", color: "F5A200" },
        ],
      },
      {
        id: "garak-market",
        lines: [
          { code: "3", color: "EF7C1C" },
          { code: "8", color: "E6186C" },
        ],
      },
      { id: "songpa", lines: [{ code: "8", color: "E6186C" }] },
    ]);
    expect(stations[1]?.title.ko).toBe("혜화역");
  });
});

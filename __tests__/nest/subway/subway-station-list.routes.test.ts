/**
 * GET /subway/stations through the real controller, the station list service,
 * SubwayStationsService and SubwayStationCoordsService, with the stored
 * `subway-station-coords` revision 1 in FakeSubwayStationCoordsRepository,
 * FakeSubwayRepository and a fixed Clock. What it guards: one request lists
 * every served station in SUBWAY_STATIONS order, each with its slug, its title
 * and its lines' display data in the request language, its campus and its
 * camera point, as the wire publishes it; the body follows Accept-Language, so it is
 * `private, max-age=300` with `meta.lang`; the general rate-limit class counts it, once; and
 * coords the server lacks, for one station or for all because the dataset was
 * never read, are served as null in a 200, never a 503 (ADR 0013 D6).
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { SubwayStationCoordsModule } from "../../../src/subway/station-coords/subway-station-coords.module";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { SubwayStationListModule } from "../../../src/subway/station-list/subway-station-list.module";
import { subwayStationList } from "../../../src/subway/station-list/subway-station-list.wire";
import { SubwayStationsModule } from "../../../src/subway/stations/subway-stations.module";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { expectWire } from "../../helpers/contracts/expect-wire";
import type { FakeSubwayStationCoordsRepository } from "../../helpers/fakes/subway/subway-station-coords.repository.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { stationCoordsFixture, storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

const CLOCK: Clock = { now: () => new Date("2026-10-24T03:00:00.000Z") };

const SERVED_ORDER = ["sungkyunkwan", "hyehwa", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang", "sadang", "geumjeong", "jongno-5-ga", "migeum", "bokjeong", "garak-market", "songpa"];

function bootWith(coordsRepository: FakeSubwayStationCoordsRepository, rateLimitPolicy = new FakeRateLimitPolicy()): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: [SubwayModule, SubwayStationsModule, SubwayStationCoordsModule, SubwayStationListModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: rateLimitPolicy },
      { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
      { provide: SubwayStationCoordsRepository, useValue: coordsRepository },
      { provide: Clock, useValue: CLOCK },
    ],
  });
}

interface ListedStationBody {
  id: string;
  title: string;
  campus: string;
  lines: Array<{ code: string; name: string; marker: { text: string } }>;
  coords: { lat: number; lng: number } | null;
}

const stationOf = (body: { data: { stations: ListedStationBody[] } }, id: string) => body.data.stations.find((station) => station.id === id);

describe("GET /subway/stations", () => {
  let app: NestExpressApplication;
  const rateLimitPolicy = new FakeRateLimitPolicy();

  beforeAll(async () => {
    app = await bootWith(storedStationCoordsRepository(), rateLimitPolicy);
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists every served station in order with its title, lines and coords, as the wire publishes it", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.stations.map((station: ListedStationBody) => station.id)).toEqual(SERVED_ORDER);
    expect(stationOf(res.body, "hyehwa")).toEqual({
      id: "hyehwa",
      title: "혜화역",
      campus: "hssc",
      lines: [{ code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } }],
      coords: { lat: 37.582336, lng: 127.001844 },
    });
    expect(stationOf(res.body, "jeongja")?.lines.map((line) => [line.code, line.name, line.marker.text])).toEqual([
      ["D1", "신분당선", "신"],
      ["K1", "수인분당선", "수"],
    ]);
    expect(stationOf(res.body, "gwanggyo-jungang")?.coords).toEqual({ lat: 37.288617, lng: 127.051478 });
    expectWire(subwayStationList, res.body.data);
  });

  it("files every station under its campus, as the bus stop list does: 혜화 under hssc, 사당, 금정, 종로5가, 미금, 복정, 가락시장 and 송파 under none, the rest under nsc, as the wire publishes it", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stations.map((station: ListedStationBody) => [station.id, station.campus])).toEqual([
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
    expectWire(subwayStationList, res.body.data);
  });

  it("lists 미금, 복정, 가락시장 and 송파, where the commute shuttle calls between its ends, with every line that stops there and no campus, as the wire publishes it", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(stationOf(res.body, "migeum")).toEqual({
      id: "migeum",
      title: "미금역",
      campus: null,
      lines: [
        { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
        { code: "K1", name: "수인분당선", color: "F5A200", marker: { text: "수", color: "A26B00" } },
      ],
      coords: { lat: 37.35003, lng: 127.108914 },
    });
    expect(stationOf(res.body, "bokjeong")?.lines.map((line) => line.code)).toEqual(["8", "K1"]);
    expect(stationOf(res.body, "garak-market")?.lines.map((line) => line.code)).toEqual(["3", "8"]);
    expect(stationOf(res.body, "songpa")).toMatchObject({ title: "송파역", campus: null, lines: [{ code: "8" }], coords: { lat: 37.499703, lng: 127.112183 } });
    expectWire(subwayStationList, res.body.data);
  });

  it("lists 사당, 금정 and 종로5가, which a journey boards or alights at, with every line that stops there and no campus, as the wire publishes it", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(stationOf(res.body, "sadang")).toEqual({
      id: "sadang",
      title: "사당역",
      campus: null,
      lines: [
        { code: "2", name: "2호선", color: "00A84D", marker: { text: "2", color: "00893F" } },
        { code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } },
      ],
      coords: { lat: 37.476746, lng: 126.981597 },
    });
    expect(stationOf(res.body, "geumjeong")?.lines.map((line) => line.code)).toEqual(["1", "4"]);
    expect(stationOf(res.body, "jongno-5-ga")).toMatchObject({ title: "종로5가역", campus: null, lines: [{ code: "1" }], coords: { lat: 37.570926, lng: 127.001849 } });
    expectWire(subwayStationList, res.body.data);
  });

  it("is private for 300 s, since the titles and line names follow Accept-Language", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toContain("Accept-Language");
  });

  it("serves the titles, line names and markers in the request language", async () => {
    // Act
    const en = await request(app.getHttpServer()).get("/subway/stations").set("Accept-Language", "en");
    const zh = await request(app.getHttpServer()).get("/subway/stations").set("Accept-Language", "zh");

    // Assert
    expect(en.body.meta).toEqual({ lang: "en" });
    expect(stationOf(en.body, "sungkyunkwan")?.title).toBe("Sungkyunkwan Univ. Station");
    expect(stationOf(en.body, "jeongja")?.lines.map((line) => [line.name, line.marker.text])).toEqual([
      ["Shinbundang Line", "신"],
      ["Suin–Bundang Line", "수"],
    ]);
    expect(zh.body.meta).toEqual({ lang: "zh" });
    expect(stationOf(zh.body, "hyehwa")?.title).toBe("惠化站");
    expect(stationOf(zh.body, "jeongja")?.lines.map((line) => line.marker.text)).toEqual(["新", "水"]);
  });

  it("is counted by the general rate-limit class bound to subway, once", async () => {
    // Arrange
    const before = rateLimitPolicy.counts.get("general")!;

    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(res.status).toBe(200);
    expect(rateLimitPolicy.counts.get("general")! - before).toBe(1);
  });
});

describe("GET /subway/stations with stored coords that lack a station", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const lacking = stationCoordsFixture();
    delete lacking.stations.dogok;
    app = await bootWith(storedStationCoordsRepository(lacking));
  });

  afterAll(async () => {
    await app.close();
  });

  it("Deploy adds a station before its coords: lists it with null coords in a 200 and keeps the others' coords, as the wire publishes it", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.body.data.stations.map((station: ListedStationBody) => station.id)).toEqual(SERVED_ORDER);
    expect(stationOf(res.body, "dogok")).toMatchObject({ id: "dogok", title: "도곡역", coords: null });
    expect(stationOf(res.body, "yangjae")?.coords).toEqual({ lat: 37.484143, lng: 127.034278 });
    expectWire(subwayStationList, res.body.data);
  });
});

describe("GET /subway/stations while the stored coords cannot be read", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const unreadable = storedStationCoordsRepository();
    unreadable.failWith = new Error("connection reset");
    app = await bootWith(unreadable);
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists every station with null coords in a 200, never a 503, as the wire publishes it", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/subway/stations");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stations.map((station: ListedStationBody) => [station.id, station.coords])).toEqual(SERVED_ORDER.map((id) => [id, null]));
    expect(stationOf(res.body, "hyehwa")?.lines.map((line) => line.code)).toEqual(["4"]);
    expectWire(subwayStationList, res.body.data);
  });
});

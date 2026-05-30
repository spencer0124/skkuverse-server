/**
 * Nest port of bus-config.test.ts — BusConfigService delegates to the pure
 * features/bus/bus-config.data functions, so the ETag bytes + group ordering
 * are byte-identical. Asserting through the service confirms the delegation
 * preserves every contract the Express test pins (5 groups, ordering, per-lang
 * ETag difference, md5 hex format, unknown→null).
 */

import { BusConfigService } from "../../../src/bus/bus-config/bus-config.service";

let service: BusConfigService;

beforeEach(() => {
  service = new BusConfigService();
});

describe("getBusGroups", () => {
  it("returns groups array with 5 items", () => {
    const groups = service.getBusGroups("ko");
    expect(Array.isArray(groups)).toBe(true);
    expect(groups).toHaveLength(5);
  });

  it("each group has id, screenType, label, visibility, card, screen", () => {
    for (const g of service.getBusGroups("ko")) {
      expect(g).toHaveProperty("id");
      expect(g).toHaveProperty("screenType");
      expect(g).toHaveProperty("label");
      expect(g).toHaveProperty("visibility");
      expect(g).toHaveProperty("card");
      expect(g).toHaveProperty("screen");
    }
  });

  it("realtime groups have screen.dataEndpoint, stations, refreshInterval", () => {
    const realtime = service
      .getBusGroups("ko")
      .filter((g: any) => g.screenType === "realtime");
    expect(realtime.length).toBeGreaterThan(0);
    for (const g of realtime as any[]) {
      expect(g.screen).toHaveProperty("dataEndpoint");
      expect(g.screen.dataEndpoint).toMatch(/^\/bus\/realtime\/data\//);
      expect(g.screen).toHaveProperty("refreshInterval");
      expect(typeof g.screen.refreshInterval).toBe("number");
      expect(Array.isArray(g.screen.stations)).toBe(true);
      expect(g.screen.stations.length).toBeGreaterThan(0);
      expect(g.screen.stations[0]).toHaveProperty("index", 0);
      expect(g.screen.stations[0]).toHaveProperty("name");
    }
  });

  it("schedule groups have services with endpoint, defaultServiceId, routeBadges", () => {
    const schedule = service
      .getBusGroups("ko")
      .filter((g: any) => g.screenType === "schedule");
    expect(schedule.length).toBeGreaterThan(0);
    for (const g of schedule as any[]) {
      expect(g.screen).toHaveProperty("defaultServiceId");
      expect(g.screen).toHaveProperty("services");
      expect(g.screen).toHaveProperty("routeBadges");
      expect(Array.isArray(g.screen.services)).toBe(true);
      for (const svc of g.screen.services) {
        expect(svc).toHaveProperty("serviceId");
        expect(svc).toHaveProperty("label");
        expect(svc).toHaveProperty("endpoint");
        expect(svc.endpoint).toMatch(/^\/bus\/schedule\/data\//);
      }
    }
  });

  it("campus has heroCard with etaEndpoint and showUntilMinutesBefore", () => {
    const campus: any = service
      .getBusGroups("ko")
      .find((g: any) => g.id === "campus");
    expect(campus.screen.heroCard).toBeDefined();
    expect(campus.screen.heroCard).toMatchObject({
      etaEndpoint: "/bus/campus/eta",
      showUntilMinutesBefore: 0,
    });
  });

  it("fasttrack has dateRange visibility with valid ISO dates", () => {
    const fasttrack: any = service
      .getBusGroups("ko")
      .find((g: any) => g.id === "fasttrack");
    expect(fasttrack.visibility.type).toBe("dateRange");
    expect(fasttrack.visibility.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fasttrack.visibility.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("non-fasttrack groups have visibility.type always", () => {
    const nonFt = service.getBusGroups("ko").filter((g: any) => g.id !== "fasttrack");
    for (const g of nonFt as any[]) {
      expect(g.visibility).toEqual({ type: "always" });
    }
  });

  it("group order is hssc, campus, fasttrack, jongro02, jongro07", () => {
    const ids = service.getBusGroups("ko").map((g: any) => g.id);
    expect(ids).toEqual(["hssc", "campus", "fasttrack", "jongro02", "jongro07"]);
  });

  it("English translations differ from Korean", () => {
    const ko = service.getBusGroups("ko");
    const en = service.getBusGroups("en");
    expect((en[0] as any).label).not.toBe((ko[0] as any).label);
  });

  it("default lang (omitted) equals 'ko'", () => {
    expect((service.getBusGroups()[0] as any).label).toBe(
      (service.getBusGroups("ko")[0] as any).label,
    );
  });
});

describe("computeEtag", () => {
  it("ETag matches md5 hex format", () => {
    expect(service.computeEtag("ko")).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("same language returns same ETag", () => {
    expect(service.computeEtag("ko")).toBe(service.computeEtag("ko"));
  });

  it("different ETag per language", () => {
    expect(service.computeEtag("ko")).not.toBe(service.computeEtag("en"));
  });
});

describe("getGroupById", () => {
  it("returns group for known id", () => {
    const group: any = service.getGroupById("campus", "ko");
    expect(group).not.toBeNull();
    expect(group.id).toBe("campus");
    expect(group).toHaveProperty("screenType");
    expect(group).toHaveProperty("screen");
  });

  it("returns null for unknown id", () => {
    expect(service.getGroupById("nonexistent", "ko")).toBeNull();
  });
});

describe("computeGroupEtag", () => {
  it("returns md5 hex format for known id", () => {
    expect(service.computeGroupEtag("campus", "ko")).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("returns null for unknown id", () => {
    expect(service.computeGroupEtag("nonexistent", "ko")).toBeNull();
  });

  it("same id+lang returns same etag", () => {
    expect(service.computeGroupEtag("hssc", "ko")).toBe(
      service.computeGroupEtag("hssc", "ko"),
    );
  });

  it("different lang returns different etag", () => {
    expect(service.computeGroupEtag("hssc", "ko")).not.toBe(
      service.computeGroupEtag("hssc", "en"),
    );
  });
});

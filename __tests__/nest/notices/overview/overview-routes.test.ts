/**
 * GET /notices/overview through the assembled notices modules: the stub the released app still calls. Every
 * valid request answers 200 with a null overview and reason `unavailable`, uncached, and the route reaches no
 * repository, no cache and no other service: the app hides its card on that body. A bad query is still a 400
 * before the answer, the route is not taken for the detail route, and the overview-only rate limit still binds.
 *
 * The list and detail repositories are typed fakes, and so are the rate-limit policy and the authenticator;
 * everything between them (auth and limiter middleware, controller, the response interceptor) is real.
 * Every request carries its own X-Forwarded-For so the overview limiter only trips in the test that means to trip it.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../../src/infra/clock";
import logger from "../../../../src/infra/logger";
import { NoticesDetailModule } from "../../../../src/notices/detail/notices-detail.module";
import { NoticesDetailRepository } from "../../../../src/notices/detail/notices-detail.repository";
import { NoticesListModule } from "../../../../src/notices/list/notices-list.module";
import { NoticesListRepository } from "../../../../src/notices/list/notices-list.repository";
import { NoticesModule } from "../../../../src/notices/notices.module";
import { NoticesOverviewModule } from "../../../../src/notices/overview/notices-overview.module";
import { overviewData, overviewMeta } from "../../../../src/notices/overview/notices-overview.wire";
import { RateLimitPolicy, RequestAuthenticator } from "../../../../src/perimeter/perimeter.ports";
import { FakeRequestAuthenticator } from "../../../helpers/fakes/perimeter/request-authenticator.fake";
import { expectWire } from "../../../helpers/contracts/expect-wire";
import { FakeNoticesDetailRepository } from "../../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeNoticesListRepository } from "../../../helpers/fakes/notices/notices-list.repository.fake";
import { buildTestApp } from "../../../helpers/nest/build-test-app";
import { FakeRateLimitPolicy } from "../../../helpers/fakes/perimeter/rate-limit-policy.fake";

let app: NestExpressApplication;
let http: import("http").Server;
const listRepository = new FakeNoticesListRepository();
const detailRepository = new FakeNoticesDetailRepository();
const rateLimitPolicy = new FakeRateLimitPolicy();
const fakeClock: Clock = { now: () => new Date("2026-10-06T08:00:00.000Z") };
let findNotice: jest.SpyInstance;
let listNotices: jest.SpyInstance;
let fetchSpy: jest.SpyInstance;
let logCalls: jest.SpyInstance[];

let ipSeq = 0;
function get(path: string, ip = `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`) {
  return request(http).get(path).set("X-Forwarded-For", ip);
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesListModule, NoticesOverviewModule, NoticesDetailModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: rateLimitPolicy },
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: NoticesListRepository, useValue: listRepository },
      { provide: NoticesDetailRepository, useValue: detailRepository },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.restoreAllMocks();
  findNotice = jest.spyOn(detailRepository, "findNotice");
  listNotices = jest.spyOn(listRepository, "listNotices");
  fetchSpy = jest.spyOn(global, "fetch");
  logCalls = (["info", "warn", "error"] as const).map((level) => jest.spyOn(logger, level));
});

describe("GET /notices/overview", () => {
  it("answers 200 with a null overview, reason unavailable, uncached and no-store, for any valid query", async () => {
    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=%EC%9E%A5%ED%95%99%EA%B8%88");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ meta: { lang: "ko", cached: false, reason: "unavailable" }, data: { overview: null } });
  });

  it("answers the same in every language and for several sources", async () => {
    // Act
    const [ko, en, many] = await Promise.all([
      get("/notices/overview?sourceIds=skku-main&q=scholarship").set("Accept-Language", "ko"),
      get("/notices/overview?sourceIds=skku-main&q=scholarship").set("Accept-Language", "en"),
      get("/notices/overview?sourceIds=skku-main,skku-notice02&q=scholarship"),
    ]);

    // Assert
    expect([ko, en, many].map((res) => res.body.data)).toEqual([{ overview: null }, { overview: null }, { overview: null }]);
    expect([ko, en, many].map((res) => res.body.meta.reason)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(en.body.meta.lang).toBe("en");
  });

  it("reaches no repository, no database, no cache and no outbound call", async () => {
    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=scholarship");

    // Assert
    const overviewLogs = logCalls.flatMap((spy) => spy.mock.calls).filter(([fields]) => String((fields as { event?: string } | undefined)?.event).startsWith("notices.overview"));
    expect(res.status).toBe(200);
    expect(listNotices).not.toHaveBeenCalled();
    expect(findNotice).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(overviewLogs).toEqual([]);
  });

  it.each([
    ["missing q", "/notices/overview?sourceIds=skku-main", "INVALID_PARAMS"],
    ["21 sources", `/notices/overview?q=x&sourceIds=${Array(21).fill("skku-main").join(",")}`, "INVALID_PARAMS"],
    ["unknown source", "/notices/overview?q=x&sourceIds=nope", "INVALID_SOURCE_ID"],
    ["repeated sourceIds", "/notices/overview?q=x&sourceIds=skku-main&sourceIds=skku-main", "INVALID_PARAMS"],
    ["missing sourceIds", "/notices/overview?q=x", "INVALID_PARAMS"],
    ["blank q", "/notices/overview?sourceIds=skku-main&q=%20%20", "INVALID_PARAMS"],
    ["a q of 101 characters", `/notices/overview?sourceIds=skku-main&q=${"a".repeat(101)}`, "INVALID_PARAMS"],
    ["a q with a control character", "/notices/overview?sourceIds=skku-main&q=a%00b", "INVALID_PARAMS"],
  ])("returns 400 for %s", async (_label, path, code) => {
    // Act
    const res = await get(path);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it("is not routed to the notice detail handler", async () => {
    // Act
    await get("/notices/overview?sourceIds=skku-main&q=x");

    // Assert
    expect(findNotice).not.toHaveBeenCalled();
  });
});

describe("GET /notices/overview bodies", () => {
  it("the stub's body parses with the published overviewData and overviewMeta wires", async () => {
    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=wire-stub");

    // Assert
    const { lang, ...meta } = res.body.meta;
    expect(res.status).toBe(200);
    expect(lang).toBe("ko");
    expectWire(overviewData, res.body.data);
    expectWire(overviewMeta, meta);
  });
});

describe("overview rate limit", () => {
  // WHY: the limit itself is RATE_LIMIT_POLICY's, tested beside each implementation (ADR 0023, D7); the
  // route keeps what the binding decides: each request spends the notices class and the overview's own, once.
  it("spends the notices class and the overview class once per request", async () => {
    // Arrange
    const before = new Map(rateLimitPolicy.counts);

    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=counted");

    // Assert
    expect(res.status).toBe(200);
    expect(rateLimitPolicy.counts.get("notices")! - before.get("notices")!).toBe(1);
    expect(rateLimitPolicy.counts.get("notices-overview")! - before.get("notices-overview")!).toBe(1);
    expect(rateLimitPolicy.counts.get("general")).toBe(0);
  });

  it("answers 429 when the overview class refuses", async () => {
    // Arrange
    rateLimitPolicy.refused.add("notices-overview");

    try {
      // Act
      const limited = await get("/notices/overview?sourceIds=skku-main&q=one-more", "198.51.100.7");

      // Assert
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe("RATE_LIMIT");
    } finally {
      rateLimitPolicy.refused.clear();
    }
  });

  it("leaves the list endpoint on its own, larger limit", async () => {
    // Act
    const res = await get("/notices?sourceIds=skku-main", "198.51.100.7");

    // Assert
    expect(res.status).toBe(200);
  });
});

// WHY: the route stays for the released app until the forced update (umbrella ADR 0012, D8); the released app reads no header.
describe("GET /notices/overview deprecation", () => {
  it("answers Deprecation (RFC 9745) with no successor, its body unchanged", async () => {
    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=deprecated");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe("@1795791600");
    expect(res.headers.link).toBeUndefined();
    expect(res.headers.sunset).toBeUndefined();
    expect(res.body).toEqual({ meta: { lang: "ko", cached: false, reason: "unavailable" }, data: { overview: null } });
  });
});

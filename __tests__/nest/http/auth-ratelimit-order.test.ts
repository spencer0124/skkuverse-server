/**
 * Authentication runs before the notices rate limit, on the assembled app.
 *
 * A review found that binding the principal-keyed limiters as route MIDDLEWARE while auth was a controller GUARD ran
 * auth after the limiter (Nest lifecycle: middleware → guards → handler), so the limiter keyed every request by its IP
 * and answered a bad token over the limit with 429, not 401. Auth is middleware (RequestAuthenticationMiddleware),
 * bound in NoticesModule before NoticesRateLimitMiddleware.
 *
 * Proved here on fakes: REQUEST_AUTHENTICATOR scripted per Bearer token, and RATE_LIMIT_POLICY counting each class's
 * requests and the principal each carried when its handler ran. A signed-in request reaches the limiter with its
 * user already set; a rejected credential answers 401 and the limiter never counts it; a signed-out request reaches
 * it as anonymous. GET /notices/tabs and /notices/overview are the subjects: the tabs route reads no notice, and the
 * overview binds its own class after the notices one.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { NoticesModule } from "../../../src/notices/notices.module";
import { NoticesOverviewModule } from "../../../src/notices/overview/notices-overview.module";
import { NoticesTabsModule } from "../../../src/notices/tabs/notices-tabs.module";
import { RateLimitPolicy, RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { answerByBearer, FakeRequestAuthenticator } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let rateLimitPolicy: FakeRateLimitPolicy;
const authenticator = new FakeRequestAuthenticator();
authenticator.answer = answerByBearer(["bad"]);

beforeEach(async () => {
  rateLimitPolicy = new FakeRateLimitPolicy();
  // ROLE=api keeps the dispatch sweep poller from starting.
  app = await buildTestApp({
    imports: [SchedulingModule, NoticesModule, NoticesTabsModule, NoticesOverviewModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: rateLimitPolicy },
      { provide: RequestAuthenticator, useValue: authenticator },
      { provide: Clock, useValue: { now: () => new Date("2026-10-26T03:00:00.000Z") } },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterEach(async () => {
  await app.close();
});

describe("auth runs before the principal-keyed rate limit", () => {
  it("hands the notices limiter a signed-in request with its user already set", async () => {
    // Act
    const res = await request(httpServer).get("/notices/tabs").set("Authorization", "Bearer valid-token");

    // Assert
    expect(res.status).toBe(200);
    expect(rateLimitPolicy.principals).toEqual([{ limitClass: "notices", principal: { kind: "user", uid: "uid-valid-token", signInProvider: "anonymous" } }]);
  });

  it("hands both overview limiters the signed-in user, the notices class first", async () => {
    // Act
    const res = await request(httpServer).get("/notices/overview?sourceIds=skku-main&q=scholarship").set("Authorization", "Bearer valid-token");

    // Assert
    expect(res.status).toBe(200);
    expect(rateLimitPolicy.principals.map(({ limitClass, principal }) => [limitClass, principal?.kind === "user" ? principal.uid : principal?.kind])).toEqual([
      ["notices", "uid-valid-token"],
      ["notices-overview", "uid-valid-token"],
    ]);
  });

  it("answers a rejected credential 401 AUTH_INVALID with every limit count at zero, even with every class refusing", async () => {
    // Arrange
    for (const limitClass of ["notices", "notices-overview"] as const) rateLimitPolicy.refused.add(limitClass);

    // Act
    const tabs = await request(httpServer).get("/notices/tabs").set("Authorization", "Bearer bad");
    const overview = await request(httpServer).get("/notices/overview?sourceIds=skku-main&q=scholarship").set("Authorization", "Bearer bad");

    // Assert
    expect([tabs.status, overview.status]).toEqual([401, 401]);
    expect(tabs.body).toEqual({ error: { code: "AUTH_INVALID", message: "Invalid auth token" } });
    expect(Object.fromEntries(rateLimitPolicy.counts)).toEqual({ general: 0, notices: 0, "notices-overview": 0 });
  });

  it("hands the notices limiter a signed-out request as anonymous, which it keys by IP", async () => {
    // Act
    const res = await request(httpServer).get("/notices/tabs");

    // Assert
    expect(res.status).toBe(200);
    expect(rateLimitPolicy.principals).toEqual([{ limitClass: "notices", principal: { kind: "anonymous" } }]);
  });

  it("answers 429 RATE_LIMIT when the notices class refuses a signed-in request", async () => {
    // Arrange
    rateLimitPolicy.refused.add("notices");

    // Act
    const res = await request(httpServer).get("/notices/tabs").set("Authorization", "Bearer valid-token");

    // Assert
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: { code: "RATE_LIMIT", message: "Too many requests" } });
  });
});

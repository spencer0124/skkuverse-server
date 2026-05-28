const request = require("supertest");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { byUidOrIp, byIp } = require("../lib/rateLimitKeys");

// wiring 회귀 그물: helper가 limiter에 실제 적용됐을 때 IP/uid별 bucket
// 분리가 동작하는지 supertest로 검증. helper 단위 테스트가 못 잡는
// "wiring 실수"(bare reference, 함수 호출 형태로 전달 등)를 잡음.

function makeApp(keyGen, max = 2) {
  const app = express();
  app.set("trust proxy", 1);
  // verifyToken 흉내 — X-Test-Uid 헤더가 있으면 req.uid 주입
  app.use((req, res, next) => {
    if (req.headers["x-test-uid"]) req.uid = req.headers["x-test-uid"];
    next();
  });
  app.use(rateLimit({
    windowMs: 60_000,
    max,
    keyGenerator: keyGen,
    standardHeaders: false,
    legacyHeaders: false,
    validate: false, // startup keyGenerator source-scan validator off (test noise)
  }));
  app.get("/", (req, res) => res.send("ok"));
  return app;
}

describe("byIp wiring (integration)", () => {
  it("caps per IP and separates buckets by IP", async () => {
    const app = makeApp(byIp);
    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(429);
    // 다른 IP는 별도 bucket
    await request(app).get("/").set("X-Forwarded-For", "2.2.2.2").expect(200);
  });
});

describe("byUidOrIp wiring (integration)", () => {
  it("separates buckets by uid even when IP is identical", async () => {
    const app = makeApp(byUidOrIp);
    const ip = "1.1.1.1";
    await request(app).get("/").set("X-Forwarded-For", ip).set("X-Test-Uid", "alice").expect(200);
    await request(app).get("/").set("X-Forwarded-For", ip).set("X-Test-Uid", "alice").expect(200);
    await request(app).get("/").set("X-Forwarded-For", ip).set("X-Test-Uid", "alice").expect(429);
    // bob은 다른 bucket (같은 IP라도)
    await request(app).get("/").set("X-Forwarded-For", ip).set("X-Test-Uid", "bob").expect(200);
  });

  it("falls back to per-IP bucket when uid absent", async () => {
    const app = makeApp(byUidOrIp);
    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(429);
    await request(app).get("/").set("X-Forwarded-For", "2.2.2.2").expect(200);
  });
});

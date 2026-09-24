/**
 * The general limiter counts per client address, and the address is what
 * Express derives from X-Forwarded-For under `trust proxy 1`: the RIGHTMOST
 * entry. nginx overwrites X-Forwarded-For with the real client (see
 * nginx-site.test.ts), so in production that entry is the client; here the
 * header is set by hand to stand in for it.
 *
 * The limiter's store is module-level and shared by every test in this file,
 * so each test uses its own addresses.
 */
import express from "express";
import http from "http";
import request from "supertest";
import {
  BusRateLimitMiddleware,
  RATE_LIMIT_MAX_PER_MINUTE,
} from "../../../src/common/rate-limit/rate-limit.middleware";

const limiter = new BusRateLimitMiddleware();
const app = express();
app.set("trust proxy", 1);
app.use((req, res, next) => limiter.use(req, res, next));
app.get("/probe", (_req, res) => {
  res.json({ ok: true });
});

// One listener for the whole file. Handing supertest the bare app would open a
// fresh ephemeral port per request — hundreds of them here — and under a
// parallel run that churn can cross wires with other suites' listeners.
let server: http.Server;
beforeAll((done) => {
  server = app.listen(0, "127.0.0.1", done);
});
afterAll((done) => {
  server.close(done);
});

async function hit(xff: string) {
  return request(server).get("/probe").set("X-Forwarded-For", xff);
}

describe("general rate limit", () => {
  it("allows the limit per client, then answers 429 with the error envelope", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_PER_MINUTE; i++) {
      const res = await hit("198.51.100.1");
      expect(res.status).toBe(200);
    }
    const over = await hit("198.51.100.1");
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: { code: "RATE_LIMIT", message: "Too many requests" } });
  });

  it("counts each client separately", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_PER_MINUTE; i++) await hit("198.51.100.2");
    expect((await hit("198.51.100.2")).status).toBe(429);
    expect((await hit("198.51.100.3")).status).toBe(200);
  });

  it("keys on the rightmost X-Forwarded-For entry, the one nginx sets", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_PER_MINUTE; i++) await hit("198.51.100.4");
    // A client-supplied address ahead of nginx's does not open a new bucket.
    expect((await hit("203.0.113.9, 198.51.100.4")).status).toBe(429);
  });

  it("is sized for many users behind one address, not one device", () => {
    // One busy device stays under ~50/min; a shared address must hold a crowd.
    expect(RATE_LIMIT_MAX_PER_MINUTE).toBeGreaterThanOrEqual(10 * 50);
  });
});

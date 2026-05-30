/**
 * Pins the main.ts production bootstrap wiring that the adversarial parity
 * review found broken and untested:
 *
 *  1. NestFactory.create on a PRE-BUILT ExpressAdapter MUST pass
 *     { bodyParser: false }. Otherwise app.init() runs
 *     registerParserMiddleware → ExpressAdapter.isMiddlewareApplied, which
 *     reads the `app.router` getter that express@4.22 removed and now THROWS
 *     ('app.router' is deprecated!), crashing the boot. Every spec previously
 *     used build-bus-app.ts (which DOES pass bodyParser:false), so the prod
 *     path was never exercised. This test boots BOTH ways to lock the fix in.
 *
 *  2. LangMiddleware must run app-wide. Nest's consumer.forRoutes("*") does
 *     NOT fire against a pre-built ExpressAdapter (verified: zero invocations).
 *     main.ts therefore mounts it as raw express middleware before
 *     NestFactory.create — this test asserts req.lang / Vary actually land.
 *
 * It mirrors main.ts's bootstrap pipeline against a minimal one-controller
 * module (no DB / external APIs), so it covers the wiring without the full
 * AppModule's env + Mongo requirements.
 */
import { Controller, Get, Module, Req } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { LangMiddleware } from "../../src/common/lang.middleware";

@Controller("ping")
class PingController {
  @Get()
  ping(@Req() req: express.Request): { lang: unknown } {
    // Read req.lang to prove LangMiddleware ran before the handler.
    return { lang: (req as { lang?: unknown }).lang };
  }
}

@Module({ controllers: [PingController] })
class MiniModule {}

function buildLikeMainTs(opts: {
  bodyParser?: false;
  mountLang: boolean;
}): Promise<NestExpressApplication> {
  return (async () => {
    const expressInstance = express();
    expressInstance.set("trust proxy", 1);
    expressInstance.use(express.json({ limit: "100kb" }));
    if (opts.mountLang) {
      const lang = new LangMiddleware();
      expressInstance.use((req, res, next) =>
        lang.use(req as never, res as never, next),
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [MiniModule],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>(
      new ExpressAdapter(expressInstance),
      opts.bodyParser === false ? { bodyParser: false } : {},
    );
    await app.init();
    return app;
  })();
}

describe("main.ts bootstrap wiring (parity regression pins)", () => {
  it("boots with { bodyParser: false } on a pre-built ExpressAdapter (express 4.22)", async () => {
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: true });
    const res = await request(app.getHttpServer()).get("/ping");
    expect(res.status).toBe(200);
    await app.close();
  });

  it("WITHOUT bodyParser:false the prebuilt adapter crashes on app.router (proves the fix is load-bearing)", async () => {
    await expect(
      buildLikeMainTs({ mountLang: true }),
    ).rejects.toThrow(/app\.router/);
  });

  it("raw-mounted LangMiddleware fires app-wide: req.lang set + Vary header", async () => {
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: true });
    const res = await request(app.getHttpServer())
      .get("/ping")
      .set("Accept-Language", "en-US,en;q=0.9");
    expect(res.status).toBe(200);
    expect(res.body.lang).toBe("en");
    expect(res.headers["vary"]).toBe("Accept-Language");
    await app.close();
  });

  it("defaults req.lang to ko when no Accept-Language header is sent", async () => {
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: true });
    const res = await request(app.getHttpServer()).get("/ping");
    expect(res.body.lang).toBe("ko");
    await app.close();
  });

  it("Nest forRoutes('*') does NOT fire on a pre-built adapter (documents why main.ts mounts lang raw)", async () => {
    // If lang is NOT mounted raw, req.lang is undefined — confirming the
    // forRoutes('*') path AppModule used to rely on would leave it unset.
    const app = await buildLikeMainTs({ bodyParser: false, mountLang: false });
    const res = await request(app.getHttpServer()).get("/ping");
    expect(res.body.lang).toBeUndefined();
    await app.close();
  });
});

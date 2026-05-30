/**
 * Shared builder for the ad route integration tests — mirrors build-bus-app.ts.
 *
 * Constructs a NestExpressApplication reproducing the request pipeline main.ts
 * wires for /ad WITHOUT touching the real DB:
 *
 *   pino-http → express.json → LangMiddleware (req.lang + req.__startNs + Vary)
 *     → FirebaseAuthGuard (route-level @UseGuards on AdController)
 *     → AdEventRateLimitMiddleware (POST /ad/events only, via AdModule.configure)
 *     → controller (@Res() + sendSuccess)
 *     → HttpExceptionFilter (global)
 *
 * AdDataService + AdStatsService are overridden by the caller (DB-touching
 * providers) so neither onModuleInit nor request handling hits Mongo. trust
 * proxy is set so byUidOrIp's req.ip fallback works.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../src/infra/logger";
import { AdModule } from "../../../src/ad/ad.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [AdModule],
})
class TestAdAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildAdApp(
  overrides: OverrideSpec[] = [],
): Promise<NestExpressApplication> {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  expressInstance.use(
    pinoHttp({
      logger,
      autoLogging: false,
    }),
  );
  expressInstance.use(express.json({ limit: "100kb" }));
  const lang = new LangMiddleware();
  expressInstance.use((req, res, next) =>
    lang.use(req as never, res as never, next),
  );

  const builder = Test.createTestingModule({ imports: [TestAdAppModule] });
  for (const o of overrides) {
    builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(expressInstance),
    { bodyParser: false },
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();
  return app;
}

export type { Provider };

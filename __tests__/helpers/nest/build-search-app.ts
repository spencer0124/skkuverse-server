/**
 * Shared builder for the search route integration tests.
 *
 * Mirrors build-bus-app but for SearchModule. Reproduces the real main.ts
 * pipeline for /search WITHOUT touching external APIs (axios is mocked by the
 * caller before this module is required) or any DB (search has none):
 *
 *   pino-http (req.log) → express.json → LangMiddleware (req.lang/__startNs/Vary)
 *     → SearchRateLimitMiddleware (SearchModule.configure)
 *     → FirebaseAuthGuard (@UseGuards, pass-through when no Bearer token)
 *     → controller (@Res() + sendSuccess) OR ResponseInterceptor envelope
 *     → HttpExceptionFilter (global)
 *
 * trust proxy is set so byUidOrIp can read req.ip. No SchedulingModule /
 * DatabaseModule imported — search has no pollers and no DB.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../lib/logger";
import { SearchModule } from "../../../src/search/search.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [SearchModule],
})
class TestSearchAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildSearchApp(
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

  const builder = Test.createTestingModule({ imports: [TestSearchAppModule] });
  for (const o of overrides) {
    builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(expressInstance),
    { bodyParser: false },
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

export type { Provider };

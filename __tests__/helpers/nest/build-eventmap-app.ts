/**
 * Shared builder for the /eventmap route integration tests — sibling of
 * build-map-app.ts.
 *
 * Reproduces the request pipeline main.ts wires, WITHOUT touching the real DB:
 *
 *   pino-http → express.json → LangMiddleware (req.lang + req.__startNs + Vary)
 *     → BusRateLimitMiddleware (applied by EventMapModule.configure() to the
 *       "eventmap" prefix ONLY — /internal/eventmap must stay unthrottled)
 *     → EventMapController / EventMapInternalController (@Res() + sendSuccess
 *       for ETag/304 control)
 *     → HttpExceptionFilter (global)
 *
 * Callers override EventMapService and EventMapMaterializerService with stubs, so
 * nothing here reaches lib/db. ROLE=api during init() keeps the materializer
 * poller from firing (PollerRegistryService.onApplicationBootstrap gates
 * startAll() on ROLE !== "api"), which matters because the real service registers
 * one in onModuleInit.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../src/infra/logger";
import { EventMapModule } from "../../../src/eventmap/eventmap.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";

@Module({
  imports: [SchedulingModule, EventMapModule],
})
class TestEventMapAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildEventMapApp(
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

  const builder = Test.createTestingModule({ imports: [TestEventMapAppModule] });
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

  const prevRole = process.env.ROLE;
  process.env.ROLE = "api";
  try {
    await app.init();
  } finally {
    if (prevRole === undefined) delete process.env.ROLE;
    else process.env.ROLE = prevRole;
  }
  return app;
}

export type { Provider };

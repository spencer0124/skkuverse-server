/**
 * Shared builder for the notices route integration tests — sibling of
 * build-building-app.ts / build-ad-app.ts.
 *
 * Reproduces the request pipeline main.ts wires for /notices + /internal/notices
 * WITHOUT touching the real DB or external APIs:
 *
 *   pino-http → express.json → LangMiddleware (req.lang + req.__startNs + Vary)
 *     → [/notices only] FirebaseAuthMiddleware → NoticesRateLimitMiddleware
 *     → NoticesController (@Res() + sendSuccess) / NoticesInternalController
 *       (returns value → ResponseInterceptor envelopes it)
 *     → ResponseInterceptor (global) + HttpExceptionFilter (global)
 *
 * Imports NoticesModule + SchedulingModule (PollerRegistryService — the @Global
 * dep NoticesDispatchPollerService injects) but NOT DatabaseModule. The real
 * NoticesDataService.onModuleInit calls ensureNoticeIndexes() → lib/db, and the
 * dispatcher hits lib/db, so callers override those services with stubs to keep
 * init DB-free. ROLE=api during init prevents the dispatch-sweep poller from
 * firing. SourcesService + TabConfigService load the real (committed) JSON.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../src/infra/logger";
import { NoticesModule } from "../../../src/notices/notices.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [SchedulingModule, NoticesModule],
})
class TestNoticesAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildNoticesApp(
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

  const builder = Test.createTestingModule({ imports: [TestNoticesAppModule] });
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

/**
 * Shared builder for the map route integration tests — sibling of
 * build-building-app.ts / build-bus-app.ts.
 *
 * Reproduces the same request pipeline main.ts wires for /map WITHOUT touching
 * the real DB or external APIs:
 *
 *   pino-http → express.json → LangMiddleware (req.lang + req.__startNs + Vary)
 *     → BusRateLimitMiddleware (applied by MapModule.configure — the shared
 *       generalLimiter) → Map controllers (config/markers raw return through the
 *       global ResponseInterceptor; overlays @Res() + sendSuccess for ETag/304)
 *     → HttpExceptionFilter (global)
 *
 * Imports MapModule + SchedulingModule. MapModule imports BuildingModule, whose
 * BuildingService.onModuleInit calls ensureIndexes() → lib/db.getClient(); so
 * callers override BuildingService with a stub to keep init DB-free, and
 * override MapService to control the data path. ROLE=api during init prevents
 * BuildingSyncService's poller from firing. The global ResponseInterceptor is
 * registered (matching main.ts) so plain-return controllers get the envelope.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../lib/logger";
import { MapModule } from "../../../src/map/map.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";

@Module({
  imports: [SchedulingModule, MapModule],
})
class TestMapAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildMapApp(
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

  const builder = Test.createTestingModule({ imports: [TestMapAppModule] });
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

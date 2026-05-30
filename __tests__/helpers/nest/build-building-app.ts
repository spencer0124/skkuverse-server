/**
 * Shared builder for the building route integration tests — sibling of
 * build-bus-app.ts.
 *
 * Reproduces the same request pipeline main.ts wires for /building WITHOUT
 * touching the real DB or external APIs:
 *
 *   pino-http → express.json → LangMiddleware (req.lang + req.__startNs + Vary)
 *     → BusRateLimitMiddleware (applied by BuildingModule.configure — the shared
 *       generalLimiter) → BuildingController (@Res() + sendSuccess)
 *     → HttpExceptionFilter (global)
 *
 * Imports BuildingModule + a SchedulingModule (PollerRegistryService — the
 * @Global dep BuildingSyncService injects) but NOT DatabaseModule. The real
 * BuildingService.onModuleInit calls ensureIndexes() → lib/db.getClient(), so
 * callers override BuildingService with a stub to keep init DB-free. ROLE=api
 * during init prevents the building-sync poller from firing.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../lib/logger";
import { BuildingModule } from "../../../src/building/building.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [SchedulingModule, BuildingModule],
})
class TestBuildingAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildBuildingApp(
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

  const builder = Test.createTestingModule({ imports: [TestBuildingAppModule] });
  for (const o of overrides) {
    builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(expressInstance),
    { bodyParser: false },
  );
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

/**
 * Shared builder for the bus route integration tests.
 *
 * Constructs a NestExpressApplication that faithfully reproduces the request
 * pipeline the real main.ts wires for bus endpoints — WITHOUT touching the real
 * DB or external APIs:
 *
 *   pino-http (installs req.log — needed by /week's req.log.warn)
 *     → express.json
 *     → LangMiddleware (req.lang + req.__startNs + Vary)
 *     → BusRateLimitMiddleware (applied by BusModule.configure)
 *     → controller (@Res() + sendSuccess)
 *     → HttpExceptionFilter (global)
 *
 * It imports BusModule + a SchedulingModule providing PollerRegistryService
 * (the @Global dep the poller services inject), but deliberately does NOT import
 * DatabaseModule (no Mongoose connection). DB/axios-touching providers are
 * replaced via the `overrides` map. trust proxy is set so byIp can read req.ip.
 *
 * The poller services' onModuleInit will register against the (real) registry,
 * but onApplicationBootstrap is gated ROLE=api in the tests' env (see each spec)
 * OR the pollers are overridden, so no real setInterval/axios fires.
 */
import { Module, type Provider } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../src/infra/logger";
import { BusModule } from "../../../src/bus/bus.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";
import { ScheduleService } from "../../../src/bus/schedule/schedule.service";

@Module({
  imports: [SchedulingModule, BusModule],
})
class TestBusAppModule {}

export interface OverrideSpec {
  provide: unknown;
  useValue: unknown;
}

export async function buildBusApp(
  overrides: OverrideSpec[] = [],
): Promise<NestExpressApplication> {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  expressInstance.use(
    pinoHttp({
      logger,
      // Silence per-request logging noise in tests; req.log still attached.
      autoLogging: false,
    }),
  );
  expressInstance.use(express.json({ limit: "100kb" }));
  // Apply LangMiddleware as a raw app-level middleware (mirrors Express's
  // app.use(langMiddleware) at index.ts) so req.lang + req.__startNs + the Vary
  // header are set for every request before the controllers run. (Nest's
  // forRoutes("*") binding proved flaky against the pre-built express instance.)
  const lang = new LangMiddleware();
  expressInstance.use((req, res, next) => lang.use(req as never, res as never, next));

  // Default no-op stub for ScheduleService so its real onModuleInit (which calls
  // ensureScheduleIndexes → lib/db.getClient(), hanging without a real Mongo)
  // never fires during app init. Callers that exercise the schedule routes pass
  // their own ScheduleService override, which replaces this (last write wins).
  const hasOverride = (token: unknown): boolean =>
    overrides.some((o) => o.provide === token);
  const effective: OverrideSpec[] = [...overrides];
  if (!hasOverride(ScheduleService)) {
    effective.push({
      provide: ScheduleService,
      useValue: {
        onModuleInit: jest.fn(),
        resolveWeek: jest.fn().mockResolvedValue(null),
        resolveSmartSchedule: jest.fn().mockResolvedValue(null),
        clearCache: jest.fn(),
        clearCacheForService: jest.fn(),
      },
    });
  }

  const builder = Test.createTestingModule({ imports: [TestBusAppModule] });
  for (const o of effective) {
    builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(expressInstance),
    // Body parsing is pre-attached (express.json above); skip Nest's parser
    // registration to avoid ExpressAdapter.isMiddlewareApplied touching the
    // deprecated app.router on the pre-built instance.
    { bodyParser: false },
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // Force ROLE=api during init so PollerRegistryService.onApplicationBootstrap
  // does NOT startAll() — no real setInterval/axios/DB ticks fire in tests.
  // (Poller onModuleInit still registers harmlessly into the registry array.)
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

/** A stub PollerRegistryService is not needed (real one is harmless), but the
 *  Provider type is re-exported for convenience if a test wants to override. */
export type { Provider };

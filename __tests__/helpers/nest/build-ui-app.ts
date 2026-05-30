/**
 * Shared builder for the UI route integration tests.
 *
 * Constructs a NestExpressApplication reproducing the request pipeline main.ts
 * wires for /ui endpoints, WITHOUT any DB / external API:
 *
 *   pino-http (req.log) → express.json → LangMiddleware (req.lang + req.__startNs
 *     + Vary) → BusRateLimitMiddleware (applied by UiModule.configure) →
 *     UiController (@Res() + sendSuccess) → HttpExceptionFilter (global)
 *
 * UiModule has no pollers and no DB providers (UiService delegates to the pure
 * features/ui/* functions, which read static config/i18n), so no SchedulingModule
 * or DatabaseModule import is needed — nothing async touches a real resource.
 * trust proxy is set so byIp can read req.ip.
 */
import { Module } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import logger from "../../../lib/logger";
import { UiModule } from "../../../src/ui/ui.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [UiModule],
})
class TestUiAppModule {}

export async function buildUiApp(): Promise<NestExpressApplication> {
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

  const moduleRef = await Test.createTestingModule({
    imports: [TestUiAppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(expressInstance),
    { bodyParser: false },
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

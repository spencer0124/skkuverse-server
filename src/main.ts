import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { randomUUID } from "crypto";
import helmet from "helmet";
import pinoHttp from "pino-http";
import logger from "./infra/logger";
import config from "./infra/config";
import { closeClient, ping as pingDb } from "./infra/db";
import { AppModule } from "./app.module";
import { ResponseInterceptor } from "./common/response.interceptor";
import {
  EXPOSED_RESPONSE_HEADERS,
  exposeResponseHeaders,
} from "./common/expose-headers";
import { CORS_METHODS, CORS_ORIGINS } from "./infra/origins";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { LangMiddleware } from "./common/lang.middleware";
import { BusCacheService } from "./bus/cache/bus-cache.service";

/**
 * NestJS entrypoint — parallel to index.ts (the Express app keeps running
 * unchanged). Reproduces the index.ts bootstrap faithfully:
 *  - helmet, pino-http (same genReqId / customProps → installs req.log),
 *    express.json(100kb), trust proxy 1
 *  - global ResponseInterceptor + HttpExceptionFilter (LangMiddleware is wired
 *    in AppModule.configure)
 *  - ROLE branch (poller: init only, no listen; api/combined: listen)
 *  - graceful shutdown (enableShutdownHooks + 5s force-exit + closeClient)
 */
async function bootstrap(): Promise<void> {
  // Use a pre-built Express instance so we can attach the raw middleware
  // (pino-http, helmet, json) BEFORE Nest's middleware system runs — matching
  // the Express order in index.ts (pino-http at :39 → langMiddleware at :54).
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  expressInstance.use(helmet());
  expressInstance.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers["x-request-id"];
        if (existing) return existing as string;
        const id = randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customProps: (req) => ({
        appVersion: req.headers["x-app-version"] || null,
        platform: req.headers["x-platform"] || null,
      }),
    }),
  );
  expressInstance.use(express.json({ limit: "100kb" }));

  // LangMiddleware MUST run app-wide before any handler (sets req.lang +
  // req.__startNs + Vary: Accept-Language). Nest's AppModule.configure
  // forRoutes("*") does NOT fire against a pre-built ExpressAdapter instance
  // (verified: zero middleware invocations for "*", "(.*)", "{*path}",
  // "*path"), so we mount it as raw express middleware here — exactly mirroring
  // Express index.ts `app.use(langMiddleware)` and the test helper
  // build-bus-app.ts. Placed after express.json so the order matches Express.
  const langMiddleware = new LangMiddleware();
  expressInstance.use((req, res, next) =>
    langMiddleware.use(req as never, res as never, next),
  );

  // Must run before any handler — see the docblock. The eventmap 304 branches
  // return before setting headers of their own, which is the case this exists for.
  expressInstance.use(exposeResponseHeaders);

  // bodyParser:false is REQUIRED: with a pre-built ExpressAdapter, Nest's
  // registerParserMiddleware → ExpressAdapter.isMiddlewareApplied reads the
  // `app.router` getter, which express@4.22 removed and now THROWS
  // ('app.router' is deprecated!) — crashing app.init(). Body parsing is
  // already attached above (express.json), so skipping Nest's parser is safe
  // and matches build-bus-app.ts.
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressInstance),
    { bufferLogs: false, bodyParser: false },
  );

  // CORS, scoped to the first-party web origins in infra/origins.ts.
  //
  // Added when apps/webview gained its first fetch (the mini-app notification
  // feed, skkuverse#17). Until then the API sent no Access-Control-Allow-Origin
  // and answered OPTIONS with 404, which common/expose-headers.ts documents —
  // and which meant a cross-origin fetch failed before it could read anything.
  //
  // Read-only methods, no credentials. Everything reachable this way is already
  // public to anyone with curl; what the narrow scope buys is that a browser at
  // an allowed origin cannot preflight a POST to /internal/*, so the token check
  // there is never the only thing standing between a page and a send.
  app.enableCors({
    origin: [...CORS_ORIGINS],
    methods: [...CORS_METHODS],
    // The same header exposeResponseHeaders already sets. Nest would
    // overwrite that header on CORS-handled responses, and the 304 branches it
    // exists for do not go through this path at all, so both are needed.
    exposedHeaders: EXPOSED_RESPONSE_HEADERS,
    credentials: false,
    maxAge: 86400,
  });

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // Verify MongoDB connectivity (non-fatal — bus/station read from cache).
  // Mirrors index.ts:164-171.
  try {
    await pingDb();
    logger.info("[db] MongoDB connected");
  } catch (err) {
    logger.warn(
      { err: (err as { message?: string }).message },
      "[db] MongoDB connection failed",
    );
  }

  // Ensure bus_cache TTL index exists (non-fatal) — mirrors index.ts:181-187.
  // Express runs this unconditionally (NOT ROLE-gated), so the port does too.
  // ensureScheduleIndexes() parity is handled by ScheduleService.onModuleInit
  // (runs during app.init() above), matching the Express boot path.
  try {
    await app.get(BusCacheService).ensureIndex();
    logger.info("[bus_cache] TTL index ensured");
  } catch (err) {
    logger.warn(
      { err: (err as { message?: string }).message },
      "[bus_cache] Index setup failed",
    );
  }

  const role = process.env.ROLE || "combined";

  if (role === "poller") {
    // Poller-only: run lifecycle hooks (onApplicationBootstrap starts pollers)
    // but do NOT bind an HTTP listener. Mirrors index.ts:236-248.
    logger.info({ role }, "Running in poller-only mode");
    await app.init();
    let shuttingDownPoller = false;
    const shutdownPoller = async (): Promise<void> => {
      if (shuttingDownPoller) return;
      shuttingDownPoller = true;
      logger.info("Shutting down poller...");
      const forceExit = setTimeout(() => {
        logger.error("Shutdown timed out, forcing exit");
        process.exit(1);
      }, 5000);
      forceExit.unref();
      await app.close(); // triggers onApplicationShutdown → stopAll()
      await closeClient();
      process.exit(0);
    };
    process.on("SIGTERM", shutdownPoller);
    process.on("SIGINT", shutdownPoller);
    return;
  }

  // api / combined: bind HTTP. Pollers (combined) are started by
  // PollerRegistryService.onApplicationBootstrap (ROLE !== "api").
  await app.listen(config.port);
  logger.info(
    {
      mode: config.getModeLabel(),
      port: config.port,
      db: config.mongo.dbName,
      api: config.useProdApi ? "PROD" : "DEV",
      role,
    },
    "Server started (NestJS)",
  );

  // Graceful shutdown — mirrors index.ts:267-285.
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down...");
    const forceExit = setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, 5000);
    forceExit.unref();
    await app.close(); // runs onApplicationShutdown → stopAll()
    await closeClient();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((err) => {
  logger.error({ err }, "Nest bootstrap failed");
  process.exit(1);
});

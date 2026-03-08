const express = require("express");
const { randomUUID } = require("crypto");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");
const pollers = require("./lib/pollers");
const { closeClient, ping: pingDb } = require("./lib/db");
const verifyToken = require("./lib/authMiddleware");
const langMiddleware = require("./lib/langMiddleware");
const responseHelper = require("./lib/responseHelper");
const { ensureIndexes, seedIfEmpty } = require("./features/ad/ad.data");
const { ensureScheduleIndexes } = require("./features/bus/schedule-db");
const busCache = require("./lib/busCache");

let swaggerFile;
try {
  swaggerFile = require("./swagger/swagger-output.json");
} catch {
  logger.warn("swagger-output.json not found. Run 'npm run swagger' to generate it.");
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    if (existing) return existing;
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (req) => ({
    appVersion: req.headers["x-app-version"] || null,
    platform: req.headers["x-platform"] || null,
  }),
}));
app.use(express.json({ limit: "100kb" }));
app.use(langMiddleware);
app.use(responseHelper);
const config = require("./lib/config");

// Swagger API docs (non-production only)
if (swaggerFile && !config.isProduction) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile, { explorer: true }));
}

// Health check (unprotected, before auth/rate-limiting)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// Readiness probe: DB connectivity + (pollers running OR api-only role)
app.get("/health/ready", async (req, res) => {
  try {
    await pingDb();
    const role = process.env.ROLE || "combined";
    const pollersReady = role === "api" ? true : pollers.isReady();
    if (!pollersReady) {
      return res.status(503).json({ status: "unavailable", reason: "pollers not started" });
    }
    res.status(200).json({ status: "ready", uptime: process.uptime() });
  } catch (_err) {
    res.status(503).json({ status: "unavailable", reason: "db unreachable" });
  }
});

// Rate limiters (uid-based to handle shared campus WiFi)
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.uid || ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: ipKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
});

// Feature routes
const searchRoute = require("./features/search/search.routes");
const realtimeRoutes = require("./features/bus/realtime.routes");
const campusEtaRoutes = require("./features/bus/campus-eta.routes");
const scheduleRoutes = require("./features/bus/schedule.routes");
const busConfigRoutes = require("./features/bus/bus-config.routes");
const routeOverlayRoutes = require("./features/bus/route-overlay.routes");
const stationRoute = require("./features/station/station.routes");
const uiRoute = require("./features/ui/ui.routes");
const adRoute = require("./features/ad/ad.routes");
const appRoute = require("./features/app/app.routes");
const mapConfigRoutes = require("./features/map/map-config.routes");
const mapMarkersRoutes = require("./features/map/map-markers.routes");
const mapOverlaysRoutes = require("./features/map/map-overlays.routes");

app.use("/search", verifyToken, searchLimiter, searchRoute);
app.use("/bus/realtime", generalLimiter, realtimeRoutes);
app.use("/bus/station", generalLimiter, stationRoute);
app.use("/bus/campus", generalLimiter, campusEtaRoutes);
app.use("/bus/schedule", generalLimiter, scheduleRoutes);
app.use("/bus/config", generalLimiter, busConfigRoutes);
app.use("/bus/route", generalLimiter, routeOverlayRoutes);
app.use("/ui", generalLimiter, uiRoute);
app.use("/ad", verifyToken, adRoute);
app.use("/app", generalLimiter, appRoute);
app.use("/map/config", generalLimiter, mapConfigRoutes);
app.use("/map/markers", generalLimiter, mapMarkersRoutes);
app.use("/map/overlays", generalLimiter, mapOverlaysRoutes);

// 404 handler (after all routes, before error handler)
app.use((req, res) => {
  res.error(404, "NOT_FOUND", `${req.method} ${req.path} not found`);
});

// Shared error handler
app.use((err, req, res, next) => {
  logger.error({ err }, "Unhandled request error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
});

// Start server
if (require.main === module) {
  (async () => {
    // Verify MongoDB connectivity (non-fatal: bus/station/search work without DB)
    try {
      await pingDb();
      logger.info("[db] MongoDB connected");
    } catch (err) {
      logger.warn({ err: err.message }, "[db] MongoDB connection failed");
    }

    // Initialize ad system (non-fatal: warn and continue on failure)
    try {
      await ensureIndexes();
      await seedIfEmpty();
    } catch (err) {
      logger.warn({ err: err.message }, "[ad] Startup initialization failed");
    }

    // Ensure bus_cache TTL index exists (non-fatal)
    try {
      await busCache.ensureIndex();
      logger.info("[bus_cache] TTL index ensured");
    } catch (err) {
      logger.warn({ err: err.message }, "[bus_cache] Index setup failed");
    }

    // Ensure schedule indexes (non-fatal)
    try {
      await ensureScheduleIndexes();
      logger.info("[schedule] Indexes ensured");
    } catch (err) {
      logger.warn({ err: err.message }, "[schedule] Index setup failed");
    }

    // ROLE=poller: run pollers only, no HTTP server
    // ROLE=api: run HTTP server only, no pollers (reads from bus_cache written by poller service)
    // ROLE=combined (default): run both — single-container backward-compatible mode
    const role = process.env.ROLE || "combined";

    if (role === "poller") {
      logger.info({ role }, "Running in poller-only mode");
      pollers.startAll();
      const shutdown = async () => {
        logger.info("Shutting down poller...");
        pollers.stopAll();
        await closeClient();
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
      return;
    }

    if (role === "combined") {
      pollers.startAll();
    }

    const server = app.listen(config.port, () => {
      logger.info({
        mode: config.getModeLabel(),
        port: config.port,
        db: config.mongo.dbName,
        adDb: config.ad.dbName,
        api: config.useProdApi ? "PROD" : "DEV",
        role,
      }, "Server started");
    });

    // Graceful shutdown (5s timeout to avoid hanging before Docker SIGKILL)
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("Shutting down...");
      const forceExit = setTimeout(() => {
        logger.error("Shutdown timed out, forcing exit");
        process.exit(1);
      }, 5000);
      forceExit.unref();
      server.close();
      pollers.stopAll();
      await closeClient();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  })();
}

module.exports = app;

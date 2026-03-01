const express = require("express");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");
const pollers = require("./lib/pollers");
const { closeClient, ping: pingDb } = require("./lib/db");
const verifyToken = require("./lib/authMiddleware");
const { ensureIndexes, seedIfEmpty } = require("./features/ad/ad.data");

let swaggerFile;
try {
  swaggerFile = require("./swagger/swagger-output.json");
} catch {
  logger.warn("swagger-output.json not found. Run 'npm run swagger' to generate it.");
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: "100kb" }));
const config = require("./lib/config");

// Swagger API docs (non-production only)
if (swaggerFile && !config.isProduction) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile, { explorer: true }));
}

// Health check (unprotected, before auth/rate-limiting)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// Readiness probe: DB connectivity + pollers running
app.get("/health/ready", async (req, res) => {
  try {
    await pingDb();
    const pollersReady = pollers.isReady();
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
  message: { error: "Too many requests" },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: ipKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// Feature routes
const searchRoute = require("./features/search/search.routes");
const { hsscRoutes, jongroRoutes, campusRoutes } = require("./features/bus/bus.routes");
const stationRoute = require("./features/station/station.routes");
const mobileRoute = require("./features/mobile/mobile.routes");
const adRoute = require("./features/ad/ad.routes");

app.use("/search", verifyToken, searchLimiter, searchRoute);
app.use("/bus/hssc", generalLimiter, hsscRoutes);
app.use("/bus/hssc_new", generalLimiter, hsscRoutes);
app.use("/bus/jongro", generalLimiter, jongroRoutes);
app.use("/station", generalLimiter, stationRoute);
app.use("/mobile/", generalLimiter, mobileRoute);
app.use("/ad/", verifyToken, adRoute);
app.use("/campus/", generalLimiter, campusRoutes);

// Shared error handler
app.use((err, req, res, next) => {
  logger.error({ err }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
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

    pollers.startAll();
    const server = app.listen(config.port, () => {
      logger.info({
        mode: config.getModeLabel(),
        port: config.port,
        db: config.mongo.dbName,
        adDb: config.ad.dbName,
        api: config.useProdApi ? "PROD" : "DEV",
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

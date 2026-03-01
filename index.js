const express = require("express");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const pollers = require("./lib/pollers");
const { closeClient, ping: pingDb } = require("./lib/db");
const verifyToken = require("./lib/authMiddleware");
const { ensureIndexes, seedIfEmpty } = require("./features/ad/ad.data");

let swaggerFile;
try {
  swaggerFile = require("./swagger/swagger-output.json");
} catch (e) {
  console.warn("swagger-output.json not found. Run 'npm run swagger' to generate it.");
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
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

// Rate limiters (uid-based to handle shared campus WiFi)
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.uid || ipKeyGenerator(req.ip),
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
app.use("/bus/hssc", hsscRoutes);
app.use("/bus/hssc_new", hsscRoutes);
app.use("/bus/jongro", jongroRoutes);
app.use("/station", stationRoute);
app.use("/mobile/", mobileRoute);
app.use("/ad/", verifyToken, adRoute);
app.use("/campus/", campusRoutes);

// Shared error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
if (require.main === module) {
  (async () => {
    // Verify MongoDB connectivity (non-fatal: bus/station/search work without DB)
    try {
      await pingDb();
      console.log("[db] MongoDB connected");
    } catch (err) {
      console.warn("[db] MongoDB connection failed:", err.message);
    }

    // Initialize ad system (non-fatal: warn and continue on failure)
    try {
      await ensureIndexes();
      await seedIfEmpty();
    } catch (err) {
      console.warn("[ad] Startup initialization failed:", err.message);
    }

    pollers.startAll();
    const server = app.listen(config.port, () => {
      console.log(`\n========================================`);
      console.log(` Mode:  ${config.getModeLabel()}`);
      console.log(` Port:  ${config.port}`);
      console.log(` DB:    ${config.mongo.dbName}`);
      console.log(` Ad DB: ${config.ad.dbName}`);
      console.log(` API:   ${config.useProdApi ? "PROD" : "DEV"}`);
      console.log(`========================================\n`);
    });

    // Graceful shutdown (5s timeout to avoid hanging before Docker SIGKILL)
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("Shutting down...");
      const forceExit = setTimeout(() => {
        console.error("Shutdown timed out, forcing exit");
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

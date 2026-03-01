const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getPlacements } = require("./ad.data");
const { recordEvent } = require("./ad.stats");

const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.uid || ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

router.get(
  "/v1/placements",
  asyncHandler(async (req, res) => {
    const placements = await getPlacements();
    const enabledPlacements = {};
    for (const [key, value] of Object.entries(placements)) {
      if (value.enabled) {
        enabledPlacements[key] = value;
      }
    }
    const count = Object.keys(enabledPlacements).length;
    res.json({
      metaData: { count },
      placements: enabledPlacements,
    });
  })
);

router.post(
  "/v1/events",
  eventLimiter,
  asyncHandler(async (req, res) => {
    const { placement, event, adId } = req.body;

    if (!placement || !event || typeof placement !== "string" || typeof event !== "string") {
      return res
        .status(400)
        .json({ error: "placement and event are required and must be strings" });
    }

    const validEvents = ["view", "click"];
    if (!validEvents.includes(event)) {
      return res
        .status(400)
        .json({ error: `event must be one of: ${validEvents.join(", ")}` });
    }

    // Validate adId format if provided (must be valid MongoDB ObjectId)
    if (adId && !/^[0-9a-fA-F]{24}$/.test(adId)) {
      return res.status(400).json({ error: "adId must be a valid 24-character hex string" });
    }

    // Validate placement exists using cached data
    const placements = await getPlacements();
    if (!placements[placement]) {
      return res.status(400).json({ error: `unknown placement: ${placement}` });
    }

    // Auto-match adId if not provided: use the cached placement's adId
    const resolvedAdId = adId || placements[placement].adId || null;

    await recordEvent(placement, event, resolvedAdId);
    res.json({ placement, event, adId: resolvedAdId });
  })
);

module.exports = router;

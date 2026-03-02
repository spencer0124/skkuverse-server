const express = require("express");
const router = express.Router();
const config = require("../../lib/config");

router.get("/config", (req, res) => {
  const { ios, android } = config.app;
  const forceUpdate =
    ios.minVersion !== ios.latestVersion ||
    android.minVersion !== android.latestVersion;
  res.success({ ios, android, forceUpdate });
});

module.exports = router;

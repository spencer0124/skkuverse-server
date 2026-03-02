const express = require("express");
const router = express.Router();
const config = require("../../lib/config");

router.get("/config", (req, res) => {
  const { minVersion, latestVersion, updateUrl } = config.app;
  const forceUpdate = minVersion !== latestVersion;
  res.success({ minVersion, latestVersion, forceUpdate, updateUrl });
});

module.exports = router;

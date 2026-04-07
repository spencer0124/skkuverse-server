const express = require("express");
const router = express.Router();
const config = require("../../lib/config");

router.get("/config", (req, res) => {
  const { ios, android } = config.app;
  res.success({ ios, android });
});

module.exports = router;

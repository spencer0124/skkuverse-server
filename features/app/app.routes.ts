import { Router } from "express";
import config from "../../lib/config";

const router = Router();

router.get("/config", (_req, res) => {
  const { ios, android } = config.app;
  res.success({ ios, android });
});

export = router;

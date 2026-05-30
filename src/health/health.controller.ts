import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { ping as pingDb } from "../infra/db";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

/**
 * Health endpoints — parity with index.ts:63-80. Uses @Res() raw JSON (NOT the
 * standard envelope). These are unprotected and outside /bus (no rate limit, no
 * auth).
 */
@Controller("health")
export class HealthController {
  constructor(private readonly pollers: PollerRegistryService) {}

  @Get()
  health(@Res() res: Response): void {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  }

  @Get("ready")
  async ready(@Res() res: Response): Promise<void> {
    try {
      await pingDb();
      const role = process.env.ROLE || "combined";
      const pollersReady = role === "api" ? true : this.pollers.isReady();
      if (!pollersReady) {
        res
          .status(503)
          .json({ status: "unavailable", reason: "pollers not started" });
        return;
      }
      res.status(200).json({ status: "ready", uptime: process.uptime() });
    } catch (_err) {
      res.status(503).json({ status: "unavailable", reason: "db unreachable" });
    }
  }
}

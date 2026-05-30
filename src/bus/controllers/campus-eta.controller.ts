import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { CampusEtaService } from "../campus-eta/campus-eta.service";
import { sendSuccess } from "../../common/send-success";

/**
 * GET /bus/campus/eta — port of features/bus/campus-eta.routes.ts.
 *
 * Returns driving ETA between campuses. No Cache-Control header (matches
 * Express). Errors (both legs fail + no stale cache) propagate as a thrown
 * Error → HttpExceptionFilter → 500 INTERNAL_ERROR. Uses @Res() + sendSuccess
 * for byte-identical envelope (per spec §f: every bus controller uses @Res()).
 */
@Controller("bus/campus")
export class CampusEtaController {
  constructor(private readonly campusEta: CampusEtaService) {}

  @Get("eta")
  async getEta(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.campusEta.getEtaData();
    sendSuccess(req, res, data);
  }
}

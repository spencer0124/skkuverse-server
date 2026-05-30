import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RouteOverlayService } from "../route-overlay/route-overlay.service";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";

/**
 * GET /bus/route/:routeId — port of features/bus/route-overlay.routes.ts.
 *
 * Unknown routeId → 404 NOT_FOUND `Route '<id>' not found` (exact message). No
 * Cache-Control. Known route → { color, coords } enveloped.
 */
@Controller("bus/route")
export class RouteOverlayController {
  constructor(private readonly routeOverlay: RouteOverlayService) {}

  @Get(":routeId")
  getRoute(
    @Param("routeId") routeId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const route = this.routeOverlay.getRoute(routeId);
    if (!route) {
      throw new AppError("NOT_FOUND", `Route '${routeId}' not found`, 404);
    }
    sendSuccess(req, res, route);
  }
}

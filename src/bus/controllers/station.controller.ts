import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { StationService } from "../station/station.service";
import { sendSuccess } from "../../common/send-success";

/**
 * GET /bus/station/:stationId — port of features/station/station.routes.ts
 * mounted at /bus/station.
 *
 * Non-"01592" → empty array, no totalCount meta. "01592" → exact 2-element body
 * + { totalCount: 2 } meta. The service composes the body (reusing the original
 * computeAllStationEtas) so ETA strings + literals are byte-identical.
 */
@Controller("bus/station")
export class StationController {
  constructor(private readonly station: StationService) {}

  @Get(":stationId")
  async getStation(
    @Param("stationId") stationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.station.getStationArrivals(stationId);
    if (result.meta) {
      sendSuccess(req, res, result.data, result.meta);
    } else {
      sendSuccess(req, res, result.data);
    }
  }
}

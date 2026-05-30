import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { SupportedLang } from "../../../lib/types";
import { BusConfigService } from "../bus-config/bus-config.service";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";

/**
 * Port of features/bus/bus-config.routes.ts (mounted at /bus/config). Both
 * endpoints use @Res() for ETag/304. Per-language ETag (ko ≠ en). The
 * :groupId 404 GROUP_NOT_FOUND check precedes the 304 check (order matters —
 * unknown group is 404 even with If-None-Match). 304 → res.status(304).end()
 * only. Root + :groupId coexist on one controller; :groupId won't capture root.
 */
@Controller("bus/config")
export class BusConfigController {
  constructor(private readonly busConfig: BusConfigService) {}

  /**
   * GET /bus/config — ordered groups array with ETag caching. Sync in Express.
   */
  @Get()
  getConfig(@Req() req: Request, @Res() res: Response): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    const etag = this.busConfig.computeEtag(lang);

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    const groups = this.busConfig.getBusGroups(lang);
    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, { groups });
  }

  /**
   * GET /bus/config/:groupId — single group with ETag caching.
   */
  @Get(":groupId")
  getGroup(
    @Param("groupId") groupId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    const etag = this.busConfig.computeGroupEtag(groupId, lang);

    if (!etag) {
      throw new AppError(
        "GROUP_NOT_FOUND",
        `Unknown groupId: ${groupId}`,
        404,
      );
    }

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    const group = this.busConfig.getGroupById(groupId, lang);
    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, group);
  }
}

import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { SupportedLang } from "../../../lib/types";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";
import { MapService } from "../map.service";

/**
 * Port of features/map/map-overlays.routes.ts (mounted at /map/overlays, no auth,
 * generalLimiter). Both endpoints live on one controller; the root @Get() won't
 * be captured by @Get(":overlayId") (Nest, like the Express router, matches the
 * empty path first). The root endpoint uses @Res() for ETag/304 — reproducing
 * the exact src/bus mechanism (per-(category:lang) ETag, If-None-Match → 304,
 * Cache-Control public, max-age=300). Validation order is preserved verbatim:
 *   1. missing category  → 400 MISSING_PARAM
 *   2. unknown category  → 404 NOT_FOUND (getOverlaysByCategory null)
 *   3. If-None-Match hit → 304
 * so an unknown category is 404 even with a stale If-None-Match.
 */
@Controller("map/overlays")
export class MapOverlaysController {
  constructor(private readonly map: MapService) {}

  // GET /map/overlays?category=hssc|nsc
  @Get()
  byCategory(@Req() req: Request, @Res() res: Response): void {
    const category = req.query.category as string | undefined;
    if (!category) {
      throw new AppError(
        "MISSING_PARAM",
        "category query parameter is required",
        400,
      );
    }

    const lang = req.lang as SupportedLang;
    const data = this.map.getOverlaysByCategory(category, lang);
    if (!data) {
      throw new AppError(
        "NOT_FOUND",
        `Category '${category}' not found`,
        404,
      );
    }

    const etag = this.map.computeEtag(category, lang);
    if (etag && req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    // computeEtag returns null only when getOverlaysByCategory is null, which was
    // already handled as 404 above — so etag is always truthy here. Preserve the
    // route file's unconditional res.set("ETag", etag) (no defensive null-skip).
    res.set("ETag", etag!);
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, data);
  }

  // GET /map/overlays/:overlayId
  @Get(":overlayId")
  byId(
    @Param("overlayId") overlayId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const overlay = this.map.getOverlayById(overlayId);
    if (!overlay) {
      throw new AppError(
        "NOT_FOUND",
        `Overlay '${overlayId}' not found`,
        404,
      );
    }
    sendSuccess(req, res, overlay);
  }
}

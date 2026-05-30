import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { SearchService } from "./search.service";
import { AppError } from "../common/app-error";
import { sendSuccess } from "../common/send-success";

/**
 * Port of features/search/search.routes.ts (mounted at /search behind
 * verifyToken + searchLimiter). Auth + rate limit are BOTH bound as middleware
 * in SearchModule.configure() in the order FirebaseAuthMiddleware (verifyToken
 * port, sets req.uid) → SearchRateLimitMiddleware (byUidOrIp, 60/60s), which
 * reproduces index.ts:129 (verifyToken, searchLimiter, searchRoute) exactly.
 * No @UseGuards here: a controller guard would run AFTER the limiter (Nest
 * lifecycle: middleware → guards), breaking the uid-keyed bucket.
 *
 * The buildings/facilities endpoints carry rich meta counts, so they use @Res()
 * + sendSuccess() to inject extra meta exactly like the bus controllers (the
 * global ResponseInterceptor would only emit { lang }). detail/:buildNo/:id
 * also uses @Res() for symmetry and to keep the INVALID_PARAMS check.
 *
 * Dual-campus: campus 1 = HSSC, 2 = NSC, awaited sequentially exactly as the
 * Express router did (output order/shape is identical regardless).
 */
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * GET /search/buildings/:query — dual-campus building + facility search with
   * full meta counts (keyword, total/hssc/nsc breakdowns).
   */
  @Get("buildings/:query")
  async buildings(
    @Param("query") rawQuery: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const query = rawQuery.trim();
    if (!query || query.length > 100) {
      throw new AppError(
        "INVALID_QUERY",
        "Query must be 1-100 characters",
        400,
      );
    }

    const option1Hssc = await this.search.searchBuildings(query, 1);
    const option1Nsc = await this.search.searchBuildings(query, 2);

    const buildingsHsscCount = option1Hssc.length;
    const buildingsNscCount = option1Nsc.length;
    const buildingsTotalCount = option1Hssc.length + option1Nsc.length;

    const option3Hssc = await this.search.searchFacilities(query, 1);
    const option3Nsc = await this.search.searchFacilities(query, 2);

    const facilitiesHsscCount = option3Hssc.length;
    const facilitiesNscCount = option3Nsc.length;
    const facilitiesTotalCount = option3Hssc.length + option3Nsc.length;

    const totalHsscCount = buildingsHsscCount + facilitiesHsscCount;
    const totalNscCount = buildingsNscCount + facilitiesNscCount;
    const totalCount = totalHsscCount + totalNscCount;

    sendSuccess(
      req,
      res,
      {
        buildings: { hssc: option1Hssc, nsc: option1Nsc },
        facilities: { hssc: option3Hssc, nsc: option3Nsc },
      },
      {
        keyword: query,
        totalCount,
        totalHsscCount,
        totalNscCount,
        buildingsTotalCount,
        buildingsHsscCount,
        buildingsNscCount,
        facilitiesTotalCount,
        facilitiesHsscCount,
        facilitiesNscCount,
      },
    );
  }

  /**
   * GET /search/facilities/:query — dual-campus facility-only search.
   */
  @Get("facilities/:query")
  async facilities(
    @Param("query") rawQuery: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const query = rawQuery.trim();
    if (!query || query.length > 100) {
      throw new AppError(
        "INVALID_QUERY",
        "Query must be 1-100 characters",
        400,
      );
    }

    const facilitiesHssc = await this.search.searchFacilities(query, 1);
    const facilitiesNsc = await this.search.searchFacilities(query, 2);
    const facilitiesHsscCount = facilitiesHssc.length;
    const facilitiesNscCount = facilitiesNsc.length;
    const facilitiesTotalCount = facilitiesHssc.length + facilitiesNsc.length;

    sendSuccess(
      req,
      res,
      { hssc: facilitiesHssc, nsc: facilitiesNsc },
      {
        keyword: query,
        facilitiesTotalCount,
        facilitiesHsscCount,
        facilitiesNscCount,
      },
    );
  }

  /**
   * GET /search/detail/:buildNo/:id — floor-grouped building detail.
   */
  @Get("detail/:buildNo/:id")
  async detail(
    @Param("buildNo") buildNo: string,
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!buildNo || !id) {
      throw new AppError(
        "INVALID_PARAMS",
        "buildNo and id are required",
        400,
      );
    }

    const mergedResults = await this.search.buildingDetail(buildNo, id);
    sendSuccess(req, res, mergedResults);
  }
}

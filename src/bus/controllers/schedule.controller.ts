import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import crypto from "crypto";
import type { Request, Response } from "express";
import { t } from "../../../lib/i18n";
import type { SupportedLang } from "../../../lib/types";
import { ScheduleService } from "../schedule/schedule.service";
import serviceConfig from "../schedule/service-config";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Port of features/bus/schedule.routes.ts. Both endpoints use @Res() for
 * ETag/304 control. The 304 path is `res.status(304).end()` — NO body, NO
 * envelope, NO X-Response-Time, NO ETag/Cache-Control re-set (exact Express
 * behavior). ETag strings + Cache-Control (public, max-age=300) byte-identical.
 */
@Controller("bus/schedule")
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  /**
   * GET /bus/schedule/data/:serviceId/week?from=YYYY-MM-DD
   */
  @Get("data/:serviceId/week")
  async getWeek(
    @Param("serviceId") serviceId: string,
    // Preserve original .js coercion: `?from=A&from=B` arrives as string[],
    // passed to DATE_RE.test() which coerces to "A,B" → fails → 400. Read as
    // `any` and pass through unchanged — NO type guard / narrowing.
    @Query("from") from: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // pino-http attaches `log` to req. Preserve fail-loud: if req.log is
    // undefined this throws → 500 (matches pre-TS Express behavior).
    req.log.warn(
      { serviceId },
      "deprecated: /week endpoint called, use /smart",
    );

    if (from !== undefined && !DATE_RE.test(from)) {
      throw new AppError(
        "INVALID_DATE_FORMAT",
        "from must be YYYY-MM-DD",
        400,
      );
    }

    if (!serviceConfig[serviceId]) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const data = await this.schedule.resolveWeek(serviceId, from);
    if (!data) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const bodyJson = JSON.stringify(data);
    const hash = crypto.createHash("md5").update(bodyJson).digest("hex");
    const etag = `"week-${serviceId}-${data.from}-${hash}"`;

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, data);
  }

  /**
   * GET /bus/schedule/data/:serviceId/smart
   */
  @Get("data/:serviceId/smart")
  async getSmart(
    @Param("serviceId") serviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!serviceConfig[serviceId]) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const result = await this.schedule.resolveSmartSchedule(serviceId);
    if (!result) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const lang: SupportedLang = (req.lang ?? "ko") as SupportedLang;

    // Spread for immutability; inject i18n message for non-active statuses.
    const data =
      result.status === "active"
        ? { ...result }
        : { ...result, message: t(`schedule.${result.status}`, lang) };

    const bodyJson = JSON.stringify(data);
    const hash = crypto.createHash("md5").update(bodyJson).digest("hex");
    const etag = `"smart-${serviceId}-${data.from || data.status}-${hash}"`;

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, data);
  }
}

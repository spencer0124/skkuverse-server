import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";
import { AdDataService } from "../ad-data.service";
import { AdStatsService } from "../ad-stats.service";
import type {
  AdEventType,
  AdItem,
  Placement,
} from "../types";

/**
 * Port of the /ad routes (mounted at /ad behind verifyToken in
 * index.ts:137). Auth runs as FirebaseAuthMiddleware on all /ad routes via
 * AdModule.configure() (NOT @UseGuards), so req.uid is set BEFORE the
 * eventLimiter's byUidOrIp key on POST /events — Nest lifecycle puts middleware
 * before guards, so a controller guard would key the limiter by IP instead.
 *
 * Both handlers use @Res() + sendSuccess to reproduce the exact envelope:
 *   - GET /placements carries extra meta { count }
 *   - POST /events returns the plain { placement, event, adId } body
 * Throwing AppError(code, message, status) reproduces res.error(...) verbatim
 * (VALIDATION_ERROR @ 400) via the global HttpExceptionFilter.
 *
 * The eventLimiter (120/60s byUidOrIp) is bound to POST /ad/events ONLY, via
 * AdModule.configure() — matching the per-route middleware in ad.routes.ts.
 */
@Controller("ad")
export class AdController {
  constructor(
    private readonly adData: AdDataService,
    private readonly adStats: AdStatsService,
  ) {}

  @Get("placements")
  async getPlacements(@Req() req: Request, @Res() res: Response): Promise<void> {
    const placements = await this.adData.getPlacements();
    const enabledPlacements: Partial<Record<Placement, AdItem>> = {};
    for (const [key, value] of Object.entries(placements) as Array<
      [Placement, AdItem]
    >) {
      if (value.enabled) {
        enabledPlacements[key] = value;
      }
    }
    const count = Object.keys(enabledPlacements).length;
    sendSuccess(req, res, enabledPlacements, { count });
  }

  // Express res.success() responds 200 (no status set); Nest defaults POST to
  // 201, so @HttpCode(200) restores byte-parity with ad.routes.ts.
  @Post("events")
  @HttpCode(200)
  async recordEvent(
    @Body()
    body: {
      placement?: unknown;
      event?: unknown;
      adId?: unknown;
    },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { placement, event, adId } = body;

    if (
      !placement ||
      !event ||
      typeof placement !== "string" ||
      typeof event !== "string"
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "placement and event are required and must be strings",
        400,
      );
    }

    const validEvents = ["view", "click"];
    if (!validEvents.includes(event)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `event must be one of: ${validEvents.join(", ")}`,
        400,
      );
    }

    // Validate adId format if provided (must be valid MongoDB ObjectId).
    // 원본은 `regex.test(adId)`에 JS 자동 coercion을 그대로 사용 — non-string도
    // 문자열로 변환 후 regex로 reject됨. as string cast로 같은 coercion 의미 유지.
    if (adId && !/^[0-9a-fA-F]{24}$/.test(adId as string)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "adId must be a valid 24-character hex string",
        400,
      );
    }

    // Validate placement exists using cached data. 원본 .js와 동일하게 "현재
    // 활성 placement map에 키가 없으면 unknown" 정책 — Placement union의 4개
    // 멤버 중 enabled ad가 한 건도 없는 placement는 같은 400을 받게 됨.
    const placements = await this.adData.getPlacements();
    const placementKey = placement as Placement;
    const item = placements[placementKey];
    if (!item) {
      throw new AppError(
        "VALIDATION_ERROR",
        `unknown placement: ${placement}`,
        400,
      );
    }

    // Auto-match adId if not provided: use the cached placement's adId.
    // `adId`가 위에서 24-hex 검증 통과했거나 falsy. falsy면 item.adId(string|null)
    // 또는 null로 폴백 — 원본 ad.routes.ts:97-98과 동일한 의미.
    const resolvedAdId: string | null =
      (adId as string | undefined) || item.adId || null;

    // event와 placement는 위에서 string 확정 + 검증 완료. AdEventType /
    // Placement 캐스트는 그 검증의 type-level 대응 — 새 narrowing 추가 아님.
    await this.adStats.recordEvent(
      placementKey,
      event as AdEventType,
      resolvedAdId,
    );
    sendSuccess(req, res, { placement, event, adId: resolvedAdId });
  }
}

import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { SupportedLang } from "../../infra/types";
import { UiService } from "../ui/ui.service";
import { sendSuccess } from "../../common/send-success";

/**
 * Port of the /ui routes (mounted at /ui, generalLimiter, no auth —
 * index.ts:136). Three SDUI home endpoints. Each uses @Res() + sendSuccess so
 * the dynamic extra-meta (busListCount / itemCount) lands in meta exactly like
 * the Express res.success(data, { busListCount }) / res.success(data, { itemCount })
 * calls. /home/campus carries no extra meta — res.success(data) — but still
 * goes through sendSuccess for an identical { meta: { lang }, data } envelope +
 * X-Response-Time header.
 *
 * lang = req.lang ?? "ko" (LangMiddleware sets req.lang at runtime; the ?? is a
 * type-system guard mirroring the Express `as SupportedLang` cast, not new
 * defensive narrowing).
 */
@Controller("ui")
export class UiController {
  constructor(private readonly ui: UiService) {}

  @Get("home/transitlist")
  getTransitList(@Req() req: Request, @Res() res: Response): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    const busList = this.ui.getBusList(lang);
    sendSuccess(req, res, busList, { busListCount: busList.length });
  }

  @Get("home/scroll")
  getScroll(@Req() req: Request, @Res() res: Response): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    const items = this.ui.getScrollComponent(lang);
    sendSuccess(req, res, items, { itemCount: items.length });
  }

  @Get("home/campus")
  getCampus(@Req() req: Request, @Res() res: Response): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    const data = this.ui.getCampusSections(lang);
    sendSuccess(req, res, data);
  }
}

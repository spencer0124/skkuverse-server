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

  /**
   * GET /ui/home — the home screen's server-driven sections.
   *
   * Static config resolved per request, so it may be cached like the mini-app
   * registry it references. Five minutes also bounds how late a banner's
   * `endAt` takes effect. LangMiddleware already sets `Vary: Accept-Language`,
   * which the localized titles need.
   */
  @Get("home")
  getHome(@Req() req: Request, @Res() res: Response): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, this.ui.getHomeLayout(lang));
  }

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

  /**
   * GET /ui/home/campus — the campus sheet's sections. Cached like /ui/home, for
   * the same reason: static config resolved per request, whose banner windows
   * take effect at most five minutes late.
   */
  @Get("home/campus")
  getCampus(@Req() req: Request, @Res() res: Response): void {
    const lang = (req.lang ?? "ko") as SupportedLang;
    res.set("Cache-Control", "public, max-age=300");
    const data = this.ui.getCampusSections(lang);
    sendSuccess(req, res, data);
  }
}

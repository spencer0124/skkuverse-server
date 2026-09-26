import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { getBusList } from "./ui.buslist";
import { getScrollComponent } from "./ui.scroll";
import { getCampusSections } from "./ui.campus";
import { resolveHomeLayout } from "../home/home-layout";
import type { HomeLayout } from "../home/home-layout.types";

/**
 * SDUI home payloads — DELEGATES to the validated ui/* pure functions
 * (read-only shared import) for byte-parity. No reimplementation.
 *
 * getBusList → ui.buslist, which itself imports getBusGroups from
 * bus/bus-config.data at module level (the SAME singleton + etagCache
 * that BusModule's BusConfigService delegates to). Because that dependency is a
 * direct module import rather than DI, UiModule needs NO BusModule import to get
 * identical bus-group bytes — the date-range visibility filter (moment
 * Asia/Seoul) and screenRoute mapping live entirely inside ui.buslist.
 *
 * getScrollComponent is a pure i18n-templated literal via lib/i18n.
 * getCampusSections adds the banner carousel from campus-banners.json, resolved
 * per request like the home layout. All three default lang to "ko", matching the Express routes which
 * forward req.lang (req.lang is always set by LangMiddleware at runtime; the
 * default mirrors the original .js fallback).
 */
@Injectable()
export class UiService {
  getBusList(lang: SupportedLang = "ko"): ReturnType<typeof getBusList> {
    return getBusList(lang);
  }

  getScrollComponent(
    lang: SupportedLang = "ko",
  ): ReturnType<typeof getScrollComponent> {
    return getScrollComponent(lang);
  }

  getCampusSections(
    lang: SupportedLang = "ko",
  ): ReturnType<typeof getCampusSections> {
    return getCampusSections(lang);
  }

  /** The home screen's banner carousel and mini-app sections, as of `now`. */
  getHomeLayout(lang: SupportedLang = "ko", now: Date = new Date()): HomeLayout {
    return resolveHomeLayout(lang, now);
  }
}

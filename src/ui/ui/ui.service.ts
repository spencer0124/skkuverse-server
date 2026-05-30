import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../../lib/types";
import { getBusList } from "../../../features/ui/ui.buslist";
import { getScrollComponent } from "../../../features/ui/ui.scroll";
import { getCampusSections } from "../../../features/ui/ui.campus";

/**
 * SDUI home payloads — DELEGATES to the validated features/ui/* pure functions
 * (read-only shared import) for byte-parity. No reimplementation.
 *
 * getBusList → features/ui/ui.buslist, which itself imports getBusGroups from
 * features/bus/bus-config.data at module level (the SAME singleton + etagCache
 * that BusModule's BusConfigService delegates to). Because that dependency is a
 * direct module import rather than DI, UiModule needs NO BusModule import to get
 * identical bus-group bytes — the date-range visibility filter (moment
 * Asia/Seoul) and screenRoute mapping live entirely inside ui.buslist.
 *
 * getScrollComponent / getCampusSections are pure i18n-templated literals via
 * lib/i18n. All three default lang to "ko", matching the Express routes which
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
}

import { Controller, Get, Query } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { overviewRequest, type OverviewQuery } from "./notices-overview.schema";
import type { OverviewData, OverviewMeta } from "./notices-overview.wire";

// WHY: umbrella ADR 0012 D8: the released app still calls this route and hides its card on a null overview, so every
// valid query gets that answer, with no read and no call, until the forced update removes the route. One path segment, so
// the detail route `:sourceId/:articleNo` cannot catch it.
@Controller("notices")
export class NoticesOverviewController {
  @Get("overview")
  @CacheControl("no-store")
  getOverview(@Query(new ZodValidationPipe(overviewRequest, "INVALID_PARAMS")) _query: OverviewQuery): WithMeta<OverviewData, OverviewMeta> {
    return withMeta({ overview: null }, { cached: false, reason: "unavailable" });
  }
}

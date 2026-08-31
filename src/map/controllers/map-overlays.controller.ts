import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { sendSuccess } from "../../common/send-success";
import { MapService } from "../map.service";

/**
 * The two overlay collections — one per data source, each carrying every kind
 * of overlay that source produces.
 *
 * One route per DATA SOURCE, not per geometry: the campus route serves the
 * buildings collection plus hand-authored campus geometry, the event route
 * serves the live layer set's places. Pins, zones and route lines ride
 * together, tagged by `kind`, because a client draws one map and should fetch
 * it once. The cost is stated openly: a client downloads a whole source even
 * for layers it has switched off. If a source ever gets heavy the answer is to
 * SPLIT THE SOURCE — never a `?layers=` filter, which would fragment the edge
 * cache across every combination of toggles.
 */
@Controller("map/overlays")
export class MapOverlaysController {
  constructor(private readonly map: MapService) {}

  /**
   * GET /map/overlays/campus
   *
   * A day is right for the normal path: the buildings collection changes when
   * the university renames or renumbers something, which does not happen during
   * a user's session.
   *
   * The degraded fallback must NOT be cached, and the reason is a TTL mismatch
   * that is easy to miss. `getAllBuildings` caches whatever the query
   * returned — `[]` included — for five minutes, while this route's normal TTL
   * is a day. A brief empty read during a re-seed would otherwise pin the
   * 12-building fallback into every client and edge cache for 24 hours, on a
   * stable URL with no version stamp and nothing to bust it. The event sibling
   * self-heals from the same failure inside its 60-second TTL; this route needs
   * the explicit guard to match.
   *
   * `degraded` is a server-side signal and never reaches the wire.
   */
  @Get("campus")
  async campus(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { overlays, degraded } = await this.map.getCampusOverlays();
    res.set("Cache-Control", degraded ? "no-store" : "public, max-age=86400");
    sendSuccess(req, res, { overlays });
  }

  /**
   * GET /map/overlays/event
   *
   * A minute, because this URL is STABLE rather than version-stamped and so can
   * never be immutable. A minute is long enough for the edge to absorb a
   * festival-day burst, and short enough that an ops correction — a booth
   * moved, a zone redrawn, a set cancelled — is live before anyone walks there.
   *
   * Empty rather than an error when no festival is live: the app asks whenever
   * a layer is configured, and "no festival today" is an ordinary answer.
   */
  @Get("event")
  async event(@Req() req: Request, @Res() res: Response): Promise<void> {
    const data = await this.map.getEventOverlays();
    res.set("Cache-Control", "public, max-age=60");
    sendSuccess(req, res, data);
  }
}

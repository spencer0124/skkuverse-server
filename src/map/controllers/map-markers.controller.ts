import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { sendSuccess } from "../../common/send-success";
import { MapService } from "../map.service";

/**
 * Marker data for the layers `/map/config` advertises.
 *
 * One route per DATA SOURCE, not per layer: buildings come from the buildings
 * collection, festival booths from the event map's `places`. Layers within a
 * source share a route, because the app keys its marker cache on the
 * endpoint string — so two building layers, or six festival layers, cost one
 * fetch between them and each renders the subset carrying its own `layerId`.
 *
 * Both routes take `@Res()` purely to set Cache-Control. A plain return cannot:
 * it goes through the global ResponseInterceptor, which is how the campus route
 * shipped with no caching headers at all for as long as it existed.
 */
@Controller("map/markers")
export class MapMarkersController {
  constructor(private readonly map: MapService) {}

  /**
   * GET /map/markers/campus — every building, in both building layers.
   *
   * A day, because the buildings collection changes when the university renames
   * or renumbers something, which is not a thing that happens during a user's
   * session.
   *
   * UNLESS the projection fell back to its 12 hardcoded buildings, in which case
   * nothing may cache it. `getAllBuildings` caches an empty result for five
   * minutes, so a brief empty read during a re-seed would otherwise pin a
   * 12-building campus into every client and edge cache for 24 hours — a stable
   * URL with no version stamp and no revalidation has nothing to bust it with.
   * The event sibling self-heals from the same failure in 60 seconds; this
   * route needs the explicit guard to match.
   */
  @Get("campus")
  async campus(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { markers, degraded } = await this.map.getCampusMarkers();
    res.set(
      "Cache-Control",
      degraded ? "no-store" : "public, max-age=86400",
    );
    // `degraded` is a server-side signal, not part of the wire contract.
    sendSuccess(req, res, { markers });
  }

  /**
   * GET /map/markers/event — every published session of the live layer set,
   * whichever festival that is. Named for the mechanism, so next year's
   * config changes no URL.
   *
   * 60 seconds, not the snapshot tier's `immutable`: this URL is stable rather
   * than version-stamped, so it can never be immutable. A minute is long enough
   * for the edge to absorb a festival-day burst and short enough that an ops
   * correction — a booth moved, a set cancelled — is live before anyone walks
   * there. The window arithmetic does NOT need a short TTL: opening and closing
   * times ride in the payload, so a booth changes state on the device's clock
   * without a refetch.
   *
   * Note both responses still carry `Vary: Accept-Language` from LangMiddleware,
   * because sendSuccess puts `meta.lang` in the envelope. The marker DATA is
   * language-independent — `text` carries every language we hold — so only the
   * envelope varies, but the header is honest, and stripping it to win edge
   * caching would be a lie about what the response depends on.
   */
  @Get("event")
  async event(@Req() req: Request, @Res() res: Response): Promise<void> {
    const data = await this.map.getEventMarkers();
    res.set("Cache-Control", "public, max-age=60");
    sendSuccess(req, res, data);
  }
}

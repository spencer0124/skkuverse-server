import { Controller, Get, Query } from "@nestjs/common";
import { AppError } from "../../common/app-error";
import { MapService } from "../map.service";

const VALID_OVERLAYS = ["number", "label"] as const;
type Overlay = (typeof VALID_OVERLAYS)[number];

/**
 * Port of the /map/markers route (mounted at /map/markers, no auth,
 * generalLimiter). The overlay query param is validated against VALID_OVERLAYS;
 * an absent/invalid value throws AppError("INVALID_OVERLAY", ..., 400) — byte-
 * identical to the route file's res.error(400, "INVALID_OVERLAY", ...). On
 * success the handler returns the marker object and the global ResponseInterceptor
 * wraps it in {meta:{lang},data} (the route used a plain res.success(data), no
 * extra meta), so the envelope matches.
 */
@Controller("map/markers")
export class MapMarkersController {
  constructor(private readonly map: MapService) {}

  // GET /map/markers/campus?overlay=number|label
  @Get("campus")
  campus(
    @Query("overlay") overlayQuery: string | undefined,
  ): ReturnType<MapService["getCampusMarkers"]> {
    const overlay = overlayQuery;
    if (
      !overlay ||
      !(VALID_OVERLAYS as readonly string[]).includes(overlay)
    ) {
      throw new AppError(
        "INVALID_OVERLAY",
        `overlay must be one of: ${VALID_OVERLAYS.join(", ")}`,
        400,
      );
    }
    return this.map.getCampusMarkers(overlay as Overlay);
  }
}

import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { getCampusMarkers } from "./map-markers.data";

const router = Router();

const VALID_OVERLAYS = ["number", "label"] as const;
type Overlay = (typeof VALID_OVERLAYS)[number];

/**
 * GET /map/markers/campus?overlay=number|label
 * Returns campus building markers shaped for the requested overlay style.
 */
router.get(
  "/campus",
  asyncHandler(async (req, res) => {
    const overlay = req.query.overlay as string | undefined;
    if (!overlay || !(VALID_OVERLAYS as readonly string[]).includes(overlay)) {
      return res.error(
        400,
        "INVALID_OVERLAY",
        `overlay must be one of: ${VALID_OVERLAYS.join(", ")}`,
      );
    }
    const data = await getCampusMarkers(overlay as Overlay);
    res.success(data);
  }),
);

export = router;

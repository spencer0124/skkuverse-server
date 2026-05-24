import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { getEtaData } from "./campus-eta.data";

const router = Router();

/**
 * GET /bus/campus/eta
 * Returns driving ETA between campuses via Naver Directions API.
 */
router.get(
  "/eta",
  asyncHandler(async (_req, res) => {
    const data = await getEtaData();
    res.success(data);
  }),
);

export = router;

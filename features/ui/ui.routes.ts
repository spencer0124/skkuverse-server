import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { getBusList } from "./ui.buslist";
import { getScrollComponent } from "./ui.scroll";
import { getCampusSections } from "./ui.campus";
import type { SupportedLang } from "../../lib/types";

const router = Router();

// langMiddleware는 이 라우터보다 먼저 mount되므로 req.lang은 런타임 보장됨.
// `as SupportedLang` 단언은 type-system 보정 — 원본 .js는 req.lang을 그대로 전달.
router.get(
  "/home/transitlist",
  asyncHandler(async (req, res) => {
    const busList = getBusList(req.lang as SupportedLang);
    res.success(busList, { busListCount: busList.length });
  }),
);

router.get(
  "/home/scroll",
  asyncHandler(async (req, res) => {
    const items = getScrollComponent(req.lang as SupportedLang);
    res.success(items, { itemCount: items.length });
  }),
);

router.get(
  "/home/campus",
  asyncHandler(async (req, res) => {
    const data = getCampusSections(req.lang as SupportedLang);
    res.success(data);
  }),
);

export = router;

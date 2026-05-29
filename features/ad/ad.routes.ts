import express from "express";
import { rateLimit } from "express-rate-limit";
import asyncHandler from "../../lib/asyncHandler";
import { byUidOrIp } from "../../lib/rateLimitKeys";
import { getPlacements } from "./ad.data";
import { recordEvent } from "./ad.stats";
import type { AdEventType, AdItem, Placement } from "./types";

const router = express.Router();

const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: byUidOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
});

router.get(
  "/placements",
  asyncHandler(async (_req, res) => {
    const placements = await getPlacements();
    const enabledPlacements: Partial<Record<Placement, AdItem>> = {};
    for (const [key, value] of Object.entries(placements) as Array<
      [Placement, AdItem]
    >) {
      if (value.enabled) {
        enabledPlacements[key] = value;
      }
    }
    const count = Object.keys(enabledPlacements).length;
    res.success(enabledPlacements, { count });
  }),
);

router.post(
  "/events",
  eventLimiter,
  asyncHandler(async (req, res) => {
    const { placement, event, adId } = req.body as {
      placement?: unknown;
      event?: unknown;
      adId?: unknown;
    };

    if (
      !placement ||
      !event ||
      typeof placement !== "string" ||
      typeof event !== "string"
    ) {
      return res.error(
        400,
        "VALIDATION_ERROR",
        "placement and event are required and must be strings",
      );
    }

    const validEvents = ["view", "click"];
    if (!validEvents.includes(event)) {
      return res.error(
        400,
        "VALIDATION_ERROR",
        `event must be one of: ${validEvents.join(", ")}`,
      );
    }

    // Validate adId format if provided (must be valid MongoDB ObjectId).
    // 원본은 `regex.test(adId)`에 JS 자동 coercion을 그대로 사용 — non-string도
    // 문자열로 변환 후 regex로 reject됨. as string cast로 같은 coercion 의미 유지.
    if (adId && !/^[0-9a-fA-F]{24}$/.test(adId as string)) {
      return res.error(
        400,
        "VALIDATION_ERROR",
        "adId must be a valid 24-character hex string",
      );
    }

    // Validate placement exists using cached data. 원본 .js와 동일하게 "현재
    // 활성 placement map에 키가 없으면 unknown" 정책 — Placement union의 4개
    // 멤버 중 enabled ad가 한 건도 없는 placement는 같은 400을 받게 됨.
    const placements = await getPlacements();
    const placementKey = placement as Placement;
    const item = placements[placementKey];
    if (!item) {
      return res.error(
        400,
        "VALIDATION_ERROR",
        `unknown placement: ${placement}`,
      );
    }

    // Auto-match adId if not provided: use the cached placement's adId.
    // `adId`가 위에서 24-hex 검증 통과했거나 falsy. falsy면 item.adId(string|null)
    // 또는 null로 폴백 — 원본 ad.routes.js:60과 동일한 의미.
    const resolvedAdId: string | null =
      (adId as string | undefined) || item.adId || null;

    // event와 placement는 위에서 string 확정 + 검증 완료. AdEventType /
    // Placement 캐스트는 그 검증의 type-level 대응 — 새 narrowing 추가 아님.
    await recordEvent(placementKey, event as AdEventType, resolvedAdId);
    res.success({ placement, event, adId: resolvedAdId });
  }),
);

export = router;

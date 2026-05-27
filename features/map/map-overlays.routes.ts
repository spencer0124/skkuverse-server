import { Router } from "express";
import { jongro07Coords, jongro02Coords } from "../bus/route-overlay.data";
import { getOverlaysByCategory, computeEtag } from "./map-overlays.data";
import type { SupportedLang } from "../../lib/types";

const router = Router();

interface OverlayEntry {
  coords: typeof jongro07Coords;
}

const OVERLAYS: Record<string, OverlayEntry | undefined> = {
  jongro07: { coords: jongro07Coords },
  jongro02: { coords: jongro02Coords },
};

/**
 * GET /map/overlays?category=hssc
 * Returns building overlays for the given campus category.
 * Supports ETag-based conditional requests.
 */
router.get("/", (req, res) => {
  const category = req.query.category as string | undefined;
  if (!category) {
    return res.error(
      400,
      "MISSING_PARAM",
      "category query parameter is required",
    );
  }

  const lang = req.lang as SupportedLang;
  const data = getOverlaysByCategory(category, lang);
  if (!data) {
    return res.error(404, "NOT_FOUND", `Category '${category}' not found`);
  }

  const etag = computeEtag(category, lang);
  if (etag && req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  // computeEtag는 getOverlaysByCategory가 null인 경우만 null 반환 → 위에서 이미
  // 404로 처리됐으므로 여기 도달하면 etag는 항상 truthy. 원본 .js가 `res.set("ETag", etag)`
  // 무조건 호출하던 것을 같은 의미로 보존 (defensive null-skip 추가 금지).
  res.set("ETag", etag!);
  res.set("Cache-Control", "public, max-age=300");
  res.success(data);
});

/**
 * GET /map/overlays/:overlayId
 * Returns overlay coordinate data. Style/type metadata lives in /map/config.
 */
router.get("/:overlayId", (req, res) => {
  const overlay = OVERLAYS[req.params.overlayId as string];
  if (!overlay) {
    return res.error(
      404,
      "NOT_FOUND",
      `Overlay '${req.params.overlayId}' not found`,
    );
  }
  res.success(overlay);
});

export = router;

import { Router } from "express";
import {
  getBusGroups,
  computeEtag,
  getGroupById,
  computeGroupEtag,
} from "./bus-config.data";
import type { SupportedLang } from "../../lib/types";

const router = Router();

/**
 * GET /bus/config
 * Returns ordered groups array with ETag caching.
 */
router.get("/", (req, res) => {
  const lang = (req.lang ?? "ko") as SupportedLang;
  const etag = computeEtag(lang);

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  const groups = getBusGroups(lang);
  res.set("ETag", etag);
  res.set("Cache-Control", "public, max-age=300");
  res.success({ groups });
});

/**
 * GET /bus/config/:groupId
 * Returns a single group with ETag caching.
 */
router.get("/:groupId", (req, res) => {
  const { groupId } = req.params;
  const lang = (req.lang ?? "ko") as SupportedLang;
  const etag = computeGroupEtag(groupId, lang);

  if (!etag) {
    return res.error(404, "GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`);
  }

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  const group = getGroupById(groupId, lang);
  res.set("ETag", etag);
  res.set("Cache-Control", "public, max-age=300");
  res.success(group);
});

export = router;

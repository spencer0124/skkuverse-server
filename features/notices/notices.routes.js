const express = require("express");
const router = express.Router();
const axios = require("axios");
const asyncHandler = require("../../lib/asyncHandler");
const {
  findNoticesByDept,
  findNoticeByArticleNo,
} = require("./notices.data");
const {
  toListItem,
  toDetailItem,
  VALID_SUMMARY_TYPES,
} = require("./notices.transform");
const { decodeCursor, InvalidCursorError } = require("./notices.cursor");
const departments = require("./departments");

// Route order matters: `/departments` and `/dept/:deptId` must appear BEFORE
// the catch-all `/:deptId/:articleNo`, otherwise the dynamic pattern shadows
// them.

// GET /notices/departments
router.get(
  "/departments",
  asyncHandler(async (req, res) => {
    const etag = `W/"${departments.version.slice(0, 16)}"`;
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=3600"
    );
    res.setHeader("ETag", etag);
    // Express's `req.fresh` reads the response's ETag + Last-Modified headers
    // and compares them against If-None-Match / If-Modified-Since. It handles
    // weak/strong and comma-delimited lists for us. Must be called AFTER
    // setHeader("ETag", …) so the comparison sees our tag.
    if (req.fresh) return res.status(304).end();
    res.success(
      {
        departments: departments.list,
        version: departments.version,
      },
      { count: departments.list.length }
    );
  })
);

// GET /notices/dept/:deptId
router.get(
  "/dept/:deptId",
  asyncHandler(async (req, res) => {
    const { deptId } = req.params;
    if (!departments.map.has(deptId)) {
      return res.error(
        400,
        "INVALID_DEPT_ID",
        `unknown deptId: ${deptId}`
      );
    }

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1),
      50
    );

    const type = req.query.type;
    if (type && !VALID_SUMMARY_TYPES.has(type)) {
      return res.error(
        400,
        "INVALID_PARAMS",
        "type must be one of: action_required, event, informational"
      );
    }

    let cursor = null;
    if (req.query.cursor) {
      try {
        cursor = decodeCursor(req.query.cursor);
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          return res.error(400, "INVALID_CURSOR", "cursor is malformed");
        }
        throw err;
      }
    }

    const { items, nextCursor, hasMore } = await findNoticesByDept(deptId, {
      cursor,
      limit,
      type,
    });
    // Explicit arrow wrapper: `Array.prototype.map` passes (element, index,
    // array) — passing `toListItem` bare would leak the numeric index into
    // `toListItem`'s second `now` param and crash action_required best-pick
    // at `now.getTime()`. See regression test in notices-routes.test.js.
    const notices = items.map((doc) => toListItem(doc));
    res.success(
      { notices, nextCursor, hasMore },
      { count: notices.length }
    );
  })
);

// GET /notices/proxy/attachment?url=...&referer=...&mode=inline|download&name=...
// Proxies attachment downloads with a Referer header to bypass hotlink
// protection on some SKKU department servers (e.g. cal.skku.edu).
// Only *.skku.edu hosts are allowed to prevent open-proxy abuse.
//
// Fixes two upstream quirks:
// 1. Some servers return application/unknown for .hwp — corrected via ext map
// 2. Content-Disposition filenames are often mojibake — use client-supplied name

const EXT_MIME = {
  ".pdf": "application/pdf",
  ".hwp": "application/x-hwp",
  ".hwpx": "application/x-hwpx",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

function resolveContentType(upstreamCt, filename) {
  // Trust upstream if it's specific (not generic/unknown)
  if (
    upstreamCt &&
    upstreamCt !== "application/unknown" &&
    upstreamCt !== "application/octet-stream"
  ) {
    return upstreamCt;
  }
  // Fall back to extension-based lookup
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  return EXT_MIME[ext] || upstreamCt || "application/octet-stream";
}

router.get(
  "/proxy/attachment",
  asyncHandler(async (req, res) => {
    const { url, referer, mode, name } = req.query;
    if (!url || !referer) {
      return res.error(400, "INVALID_PARAMS", "url and referer required");
    }

    let targetHost;
    try {
      targetHost = new URL(url).hostname;
    } catch {
      return res.error(400, "INVALID_PARAMS", "malformed url");
    }

    if (!targetHost.endsWith("skku.edu")) {
      return res.error(403, "FORBIDDEN", "only skku.edu hosts allowed");
    }

    const upstream = await axios.get(url, {
      headers: {
        Referer: referer,
        "User-Agent": "Mozilla/5.0",
      },
      responseType: "stream",
      timeout: 15000,
    });

    // Use client-supplied name (from crawler), fall back to URL path
    const filename = name || new URL(url).pathname.split("/").pop() || "attachment";
    const upstreamCt = upstream.headers["content-type"];

    if (mode === "download") {
      // Force octet-stream so Safari/Chrome downloads instead of previewing
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
    } else {
      res.setHeader("Content-Type", resolveContentType(upstreamCt, filename));
      res.setHeader("Content-Disposition", "inline");
    }

    upstream.data.pipe(res);
  })
);

// GET /notices/:deptId/:articleNo
router.get(
  "/:deptId/:articleNo",
  asyncHandler(async (req, res) => {
    const { deptId, articleNo } = req.params;
    if (!departments.map.has(deptId)) {
      return res.error(
        400,
        "INVALID_DEPT_ID",
        `unknown deptId: ${deptId}`
      );
    }
    if (!/^\d+$/.test(articleNo)) {
      return res.error(400, "INVALID_PARAMS", "articleNo must be numeric");
    }
    const doc = await findNoticeByArticleNo(deptId, Number(articleNo));
    if (!doc) {
      return res.error(404, "NOT_FOUND", "notice not found");
    }
    res.success(toDetailItem(doc));
  })
);

module.exports = router;

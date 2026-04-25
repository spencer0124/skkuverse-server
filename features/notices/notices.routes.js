const express = require("express");
const router = express.Router();
const axios = require("axios");
const asyncHandler = require("../../lib/asyncHandler");
const {
  findNoticesBySource,
  findNoticesBySources,
  findNoticeByArticleNo,
} = require("./notices.data");
const {
  toListItem,
  toDetailItem,
  VALID_SUMMARY_TYPES,
} = require("./notices.transform");
const { decodeCursor, InvalidCursorError } = require("./notices.cursor");
const sources = require("./sources");
const tabConfig = require("./tabConfig");

// Route order matters: `/tabs` and `/source/:sourceId` must appear BEFORE
// the catch-all `/:sourceId/:articleNo`, otherwise the dynamic pattern shadows
// them.

// GET /notices/tabs — server-driven tab configuration
router.get(
  "/tabs",
  asyncHandler(async (req, res) => {
    const lang = req.lang === "ko" ? "ko" : "en"; // zh → en fallback
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.success(tabConfig.responseByLang[lang]);
  })
);

// GET /notices/source/:sourceId
router.get(
  "/source/:sourceId",
  asyncHandler(async (req, res) => {
    const { sourceId } = req.params;
    if (!sources.map.has(sourceId)) {
      return res.error(
        400,
        "INVALID_SOURCE_ID",
        `unknown sourceId: ${sourceId}`
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

    const { items, nextCursor, hasMore } = await findNoticesBySource(sourceId, {
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

// GET /notices?sourceIds=cs,sw&limit=20&type=…&cursor=…
// Multi-source merged list — uses the existing compound index via $in.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rawIds = (req.query.sourceIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawIds.length === 0 || rawIds.length > 5) {
      return res.error(
        400,
        "INVALID_PARAMS",
        "sourceIds: 1-5 comma-separated source IDs required"
      );
    }
    for (const id of rawIds) {
      if (!sources.map.has(id)) {
        return res.error(400, "INVALID_SOURCE_ID", `unknown sourceId: ${id}`);
      }
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

    const { items, nextCursor, hasMore } = await findNoticesBySources(rawIds, {
      cursor,
      limit,
      type,
    });
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

const VALID_MIME_TYPES = [
  "application",
  "text",
  "image",
  "audio",
  "video",
  "font",
  "multipart",
  "message",
];

function resolveContentType(upstreamCt, filename) {
  // Trust upstream only if it uses a standard top-level MIME type
  // (rejects non-standard types like "file/unknown" from gnuboard)
  const type = (upstreamCt || "").split("/")[0];
  const isSpecific =
    upstreamCt &&
    VALID_MIME_TYPES.includes(type) &&
    upstreamCt !== "application/unknown" &&
    upstreamCt !== "application/octet-stream";

  if (isSpecific) {
    return upstreamCt;
  }
  // Fall back to extension-based lookup
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  return EXT_MIME[ext] || upstreamCt || "application/octet-stream";
}

// --- Gnuboard session cache (PHPSESSID per domain, 5min TTL) ---
const SESSION_CACHE_TTL = 5 * 60 * 1000;
const sessionCache = new Map();

const _sessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessionCache) {
    if (now - val.time >= SESSION_CACHE_TTL) sessionCache.delete(key);
  }
}, SESSION_CACHE_TTL);
_sessionCleanup.unref();

async function getSessionId(refererUrl) {
  const domain = new URL(refererUrl).hostname;
  const cached = sessionCache.get(domain);
  if (cached && Date.now() - cached.time < SESSION_CACHE_TTL) {
    return cached.sessionId;
  }

  const resp = await axios.get(refererUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    maxRedirects: 5,
    timeout: 10000,
    responseType: "stream",
  });
  resp.data.destroy();

  const setCookie = resp.headers["set-cookie"] || [];
  let sessionId = null;
  for (const c of setCookie) {
    const match = c.match(/PHPSESSID=([^;]+)/);
    if (match) {
      sessionId = match[1];
      break;
    }
  }

  if (sessionId) {
    sessionCache.set(domain, { sessionId, time: Date.now() });
  }
  return sessionId;
}

function pipeDownload(upstream, res, url, name, mode) {
  const filename =
    name || new URL(url).pathname.split("/").pop() || "attachment";
  const upstreamCt = upstream.headers["content-type"];

  if (mode === "download") {
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
}

router.get(
  "/proxy/attachment",
  asyncHandler(async (req, res) => {
    const { url, referer, mode, name } = req.query;
    if (!url) {
      return res.error(400, "INVALID_PARAMS", "url is required");
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.error(400, "INVALID_PARAMS", "malformed url");
    }

    const ALLOWED_HOSTS = ["skku.edu", "skkumed.ac.kr"];

    if (!ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      return res.error(403, "FORBIDDEN", "host not allowed");
    }

    const headers = { "User-Agent": "Mozilla/5.0" };

    if (referer) {
      headers.Referer = referer;
      try {
        const sessionId = await getSessionId(referer);
        if (sessionId) headers.Cookie = `PHPSESSID=${sessionId}`;
      } catch (err) {
        req.log.warn(
          { err: err.message, referer },
          "gnuboard session fetch failed"
        );
      }
    }

    const upstream = await axios.get(url, {
      headers,
      responseType: "stream",
      timeout: 15000,
    });

    // Session expired: expected file download but got HTML (login page / error)
    // → invalidate cache and retry once with fresh session
    const ct = upstream.headers["content-type"] || "";
    if (referer && ct.includes("text/html")) {
      upstream.data.destroy();
      const domain = new URL(referer).hostname;
      sessionCache.delete(domain);
      try {
        const newSessionId = await getSessionId(referer);
        if (newSessionId) headers.Cookie = `PHPSESSID=${newSessionId}`;
      } catch (err) {
        req.log.warn(
          { err: err.message, referer },
          "gnuboard session retry fetch failed"
        );
      }
      const retry = await axios.get(url, {
        headers,
        responseType: "stream",
        timeout: 15000,
      });
      return pipeDownload(retry, res, url, name, mode);
    }

    pipeDownload(upstream, res, url, name, mode);
  })
);

// GET /notices/:sourceId/:articleNo
router.get(
  "/:sourceId/:articleNo",
  asyncHandler(async (req, res) => {
    const { sourceId, articleNo } = req.params;
    if (!sources.map.has(sourceId)) {
      return res.error(
        400,
        "INVALID_SOURCE_ID",
        `unknown sourceId: ${sourceId}`
      );
    }
    if (!/^\d+$/.test(articleNo)) {
      return res.error(400, "INVALID_PARAMS", "articleNo must be numeric");
    }
    const doc = await findNoticeByArticleNo(sourceId, Number(articleNo));
    if (!doc) {
      return res.error(404, "NOT_FOUND", "notice not found");
    }
    res.success(toDetailItem(doc));
  })
);

module.exports = router;

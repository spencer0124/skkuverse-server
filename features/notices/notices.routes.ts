import express, { type Response } from "express";
import { Readable } from "stream";
import axios from "axios";
import asyncHandler from "../../lib/asyncHandler";
import {
  findNoticesBySource,
  findNoticesBySources,
  findNoticeByArticleNo,
} from "./notices.data";
import {
  toListItem,
  toDetailItem,
  VALID_SUMMARY_TYPES,
} from "./notices.transform";
import { decodeCursor, InvalidCursorError } from "./notices.cursor";
import { validateQ } from "./notices.search";
import * as sources from "./sources";
import * as tabConfig from "./tabConfig";
import type { CursorPayload } from "./types";

const router = express.Router();

// Route order matters: `/tabs` and `/source/:sourceId` must appear BEFORE
// the catch-all `/:sourceId/:articleNo`, otherwise the dynamic pattern shadows
// them.

// GET /notices/tabs — server-driven tab configuration
router.get(
  "/tabs",
  asyncHandler(async (req, res) => {
    const lang: "ko" | "en" = req.lang === "ko" ? "ko" : "en"; // zh → en fallback
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.success(tabConfig.responseByLang[lang]);
  }),
);

// GET /notices/source/:sourceId
router.get(
  "/source/:sourceId",
  asyncHandler(async (req, res) => {
    const { sourceId } = req.params as { sourceId: string };
    if (!sources.map.has(sourceId)) {
      return res.error(
        400,
        "INVALID_SOURCE_ID",
        `unknown sourceId: ${sourceId}`,
      );
    }

    // req.query.limit may be string | string[] | ParsedQs | undefined; cast at
    // boundary and let parseInt's natural NaN handling do the fallback.
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1),
      50,
    );

    const type = req.query.type as string | undefined;
    if (type && !VALID_SUMMARY_TYPES.has(type)) {
      return res.error(
        400,
        "INVALID_PARAMS",
        "type must be one of: action_required, event, informational",
      );
    }

    let cursor: CursorPayload | null = null;
    if (req.query.cursor) {
      try {
        cursor = decodeCursor(req.query.cursor);
      } catch (err: unknown) {
        if (err instanceof InvalidCursorError) {
          return res.error(400, "INVALID_CURSOR", "cursor is malformed");
        }
        throw err;
      }
    }

    // validateQ silently returns null for missing / empty / control-char
    // / over-100-codepoint inputs. The data layer treats absent q as
    // "no search clause", so we conditionally include q in opts.
    const q = validateQ(req.query.q);

    const opts: { cursor: CursorPayload | null; limit: number; type?: string; q?: string } = {
      cursor,
      limit,
    };
    if (type) opts.type = type;
    if (q) opts.q = q;
    const { items, nextCursor, hasMore } = await findNoticesBySource(
      sourceId,
      opts,
    );
    // Explicit arrow wrapper: `Array.prototype.map` passes (element, index,
    // array) — passing `toListItem` bare would leak the numeric index into
    // `toListItem`'s second `now` param and crash action_required best-pick
    // at `now.getTime()`. See regression test in notices-routes.test.js.
    const notices = items.map((doc) => toListItem(doc));
    res.success({ notices, nextCursor, hasMore }, { count: notices.length });
  }),
);

// GET /notices?sourceIds=cs,sw&limit=20&type=…&cursor=…&q=…
// Multi-source merged list — uses the existing compound index via $in.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    // Cast preserves original .js semantics: array input → TypeError on .split
    // → 500 (asyncHandler catches). Do NOT defensively narrow here.
    const sourceIdsRaw = (req.query.sourceIds || "") as string;
    const rawIds = sourceIdsRaw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (rawIds.length === 0 || rawIds.length > 5) {
      return res.error(
        400,
        "INVALID_PARAMS",
        "sourceIds: 1-5 comma-separated source IDs required",
      );
    }
    for (const id of rawIds) {
      if (!sources.map.has(id)) {
        return res.error(400, "INVALID_SOURCE_ID", `unknown sourceId: ${id}`);
      }
    }

    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1),
      50,
    );

    const type = req.query.type as string | undefined;
    if (type && !VALID_SUMMARY_TYPES.has(type)) {
      return res.error(
        400,
        "INVALID_PARAMS",
        "type must be one of: action_required, event, informational",
      );
    }

    let cursor: CursorPayload | null = null;
    if (req.query.cursor) {
      try {
        cursor = decodeCursor(req.query.cursor);
      } catch (err: unknown) {
        if (err instanceof InvalidCursorError) {
          return res.error(400, "INVALID_CURSOR", "cursor is malformed");
        }
        throw err;
      }
    }

    const q = validateQ(req.query.q);

    const opts: { cursor: CursorPayload | null; limit: number; type?: string; q?: string } = {
      cursor,
      limit,
    };
    if (type) opts.type = type;
    if (q) opts.q = q;
    const { items, nextCursor, hasMore } = await findNoticesBySources(
      rawIds,
      opts,
    );
    const notices = items.map((doc) => toListItem(doc));
    res.success({ notices, nextCursor, hasMore }, { count: notices.length });
  }),
);

// GET /notices/proxy/attachment?url=...&referer=...&mode=inline|download&name=...
// Proxies attachment downloads with a Referer header to bypass hotlink
// protection on some SKKU department servers. Only *.skku.edu hosts allowed.

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".hwp": "application/x-hwp",
  ".hwpx": "application/x-hwpx",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

const VALID_MIME_TYPES: ReadonlySet<string> = new Set([
  "application",
  "text",
  "image",
  "audio",
  "video",
  "font",
  "multipart",
  "message",
]);

function resolveContentType(
  upstreamCt: string | undefined,
  filename: string,
): string {
  const type = (upstreamCt || "").split("/")[0] ?? "";
  const isSpecific =
    !!upstreamCt &&
    VALID_MIME_TYPES.has(type) &&
    upstreamCt !== "application/unknown" &&
    upstreamCt !== "application/octet-stream";

  if (isSpecific) {
    return upstreamCt;
  }
  const ext = (filename.match(/\.[^.]+$/) || [""])[0]!.toLowerCase();
  return EXT_MIME[ext] || upstreamCt || "application/octet-stream";
}

// --- Gnuboard session cache (PHPSESSID per domain, 5min TTL) ---
const SESSION_CACHE_TTL = 5 * 60 * 1000;
const sessionCache: Map<string, { sessionId: string; time: number }> =
  new Map();

const _sessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessionCache) {
    if (now - val.time >= SESSION_CACHE_TTL) sessionCache.delete(key);
  }
}, SESSION_CACHE_TTL);
_sessionCleanup.unref();

async function getSessionId(refererUrl: string): Promise<string | null> {
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
  (resp.data as Readable).destroy();

  const setCookie = (resp.headers["set-cookie"] || []) as string[];
  let sessionId: string | null = null;
  for (const c of setCookie) {
    const match = c.match(/PHPSESSID=([^;]+)/);
    if (match) {
      sessionId = match[1] ?? null;
      break;
    }
  }

  if (sessionId) {
    sessionCache.set(domain, { sessionId, time: Date.now() });
  }
  return sessionId;
}

interface UpstreamLike {
  headers: Record<string, unknown>;
  data: Readable;
}

function pipeDownload(
  upstream: UpstreamLike,
  res: Response,
  url: string,
  name: string | undefined,
  mode: string | undefined,
): void {
  const filename =
    name || new URL(url).pathname.split("/").pop() || "attachment";
  const upstreamCt = upstream.headers["content-type"] as string | undefined;

  if (mode === "download") {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
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
    // Override helmet's CORP for cross-origin embed by skkuverse.com Pages.
    res.set("Cross-Origin-Resource-Policy", "cross-origin");

    const url = req.query.url as string | undefined;
    const referer = req.query.referer as string | undefined;
    const mode = req.query.mode as string | undefined;
    const name = req.query.name as string | undefined;
    if (!url) {
      return res.error(400, "INVALID_PARAMS", "url is required");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.error(400, "INVALID_PARAMS", "malformed url");
    }

    const ALLOWED_HOSTS = ["skku.edu", "skkumed.ac.kr"];

    if (!ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      return res.error(403, "FORBIDDEN", "host not allowed");
    }

    const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };

    if (referer) {
      headers.Referer = referer;
      try {
        const sessionId = await getSessionId(referer);
        if (sessionId) headers.Cookie = `PHPSESSID=${sessionId}`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        req.log?.warn({ err: message, referer }, "gnuboard session fetch failed");
      }
    }

    const upstream = await axios.get(url, {
      headers,
      responseType: "stream",
      timeout: 15000,
    });

    // Session expired: expected file download but got HTML (login page / error)
    // → invalidate cache and retry once with fresh session.
    const ct = ((upstream.headers["content-type"] as string | undefined) || "");
    if (referer && ct.includes("text/html")) {
      (upstream.data as Readable).destroy();
      const domain = new URL(referer).hostname;
      sessionCache.delete(domain);
      try {
        const newSessionId = await getSessionId(referer);
        if (newSessionId) headers.Cookie = `PHPSESSID=${newSessionId}`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        req.log?.warn(
          { err: message, referer },
          "gnuboard session retry fetch failed",
        );
      }
      const retry = await axios.get(url, {
        headers,
        responseType: "stream",
        timeout: 15000,
      });
      return pipeDownload(
        retry as unknown as UpstreamLike,
        res,
        url,
        name,
        mode,
      );
    }

    pipeDownload(
      upstream as unknown as UpstreamLike,
      res,
      url,
      name,
      mode,
    );
  }),
);

// GET /notices/:sourceId/:articleNo
router.get(
  "/:sourceId/:articleNo",
  asyncHandler(async (req, res) => {
    const { sourceId, articleNo } = req.params as {
      sourceId: string;
      articleNo: string;
    };
    if (!sources.map.has(sourceId)) {
      return res.error(
        400,
        "INVALID_SOURCE_ID",
        `unknown sourceId: ${sourceId}`,
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
  }),
);

export = router;

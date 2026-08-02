import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import { Readable } from "stream";
import axios from "axios";
import type { Request, Response } from "express";
import { AppError } from "../common/app-error";
import { sendSuccess } from "../common/send-success";
import { NoticesDataService } from "./notices-data.service";
import { TransformService } from "./transform.service";
import { CursorService, InvalidCursorError } from "./cursor.service";
import { NoticesSearchService } from "./search.service";
import { SourcesService } from "./sources.service";
import { TabConfigService } from "./tabconfig.service";
import type { CursorPayload } from "./types";

/**
 * Port of notices.routes.ts (mounted at /notices behind
 * Firebase auth MIDDLEWARE + noticesLimiter in NoticesModule.configure()).
 *
 * Route ordering parity (Nest preserves declaration order within a controller):
 * the static `tabs`, `source/:sourceId`, `/` (root), and `proxy/attachment`
 * routes are declared BEFORE the catch-all `:sourceId/:articleNo` so the
 * dynamic two-segment pattern never shadows them — exactly the comment-pinned
 * precedence in notices.routes.ts.
 *
 * Every read handler uses @Res() + sendSuccess to reproduce the success
 * envelope (including the list `{ count }` extra meta) byte-identically.
 * Validation throws AppError(code, message, status) instead of res.error,
 * preserving exact status/code/message via the global HttpExceptionFilter.
 *
 * The /proxy/attachment handler writes the stream directly (res.setHeader +
 * upstream.data.pipe(res)) — it never returns a value, so the global
 * ResponseInterceptor is a no-op (res.headersSent / undefined return).
 */

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

@Controller("notices")
export class NoticesController {
  constructor(
    private readonly data: NoticesDataService,
    private readonly transform: TransformService,
    private readonly cursor: CursorService,
    private readonly search: NoticesSearchService,
    private readonly sources: SourcesService,
    private readonly tabConfig: TabConfigService,
  ) {}

  // GET /notices/tabs — server-driven tab configuration
  @Get("tabs")
  async tabs(@Req() req: Request, @Res() res: Response): Promise<void> {
    const lang: "ko" | "en" = req.lang === "ko" ? "ko" : "en"; // zh → en fallback
    res.setHeader("Cache-Control", "private, max-age=3600");
    sendSuccess(req, res, this.tabConfig.responseByLang[lang]);
  }

  // GET /notices/source/:sourceId
  @Get("source/:sourceId")
  async bySource(
    @Param("sourceId") sourceId: string,
    @Query("limit") limitQuery: string | undefined,
    @Query("type") typeQuery: string | undefined,
    @Query("cursor") cursorQuery: unknown,
    @Query("q") qQuery: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.sources.map.has(sourceId)) {
      throw new AppError(
        "INVALID_SOURCE_ID",
        `unknown sourceId: ${sourceId}`,
        400,
      );
    }

    // req.query.limit may be string | string[] | ParsedQs | undefined; cast at
    // boundary and let parseInt's natural NaN handling do the fallback.
    const rawLimit = parseInt(limitQuery as string, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1),
      50,
    );

    const type = typeQuery;
    if (type && !this.transform.VALID_SUMMARY_TYPES.has(type)) {
      throw new AppError(
        "INVALID_PARAMS",
        "type must be one of: action_required, event, informational",
        400,
      );
    }

    let cursor: CursorPayload | null = null;
    if (cursorQuery) {
      try {
        cursor = this.cursor.decode(cursorQuery);
      } catch (err: unknown) {
        if (err instanceof InvalidCursorError) {
          throw new AppError("INVALID_CURSOR", "cursor is malformed", 400);
        }
        throw err;
      }
    }

    // validateQ silently returns null for missing / empty / control-char
    // / over-100-codepoint inputs. The data layer treats absent q as
    // "no search clause", so we conditionally include q in opts.
    const q = this.search.validateQ(qQuery);

    const opts: {
      cursor: CursorPayload | null;
      limit: number;
      type?: string;
      q?: string;
    } = {
      cursor,
      limit,
    };
    if (type) opts.type = type;
    if (q) opts.q = q;
    const { items, nextCursor, hasMore } = await this.data.findNoticesBySource(
      sourceId,
      opts,
    );
    // Explicit arrow wrapper: `Array.prototype.map` passes (element, index,
    // array) — passing toListItem bare would leak the numeric index into the
    // `now` param and crash action_required best-pick at `now.getTime()`.
    const notices = items.map((doc) => this.transform.toListItem(doc));
    sendSuccess(
      req,
      res,
      { notices, nextCursor, hasMore },
      { count: notices.length },
    );
  }

  // GET /notices?sourceIds=cs,sw&limit=20&type=…&cursor=…&q=…
  // Multi-source merged list — uses the existing compound index via $in.
  //
  // The cap was originally 5, mirroring the largest picker tab's
  // `maxSelection` in categories.json — the endpoint only ever served one
  // picker tab's selection at a time. The app's search screen now offers an
  // "전체" scope that unions every tab the user follows (5 fixed tabs + each
  // picker's effective selection), which is ~8 by default and 20 if every
  // picker is filled to its max. 20 is that ceiling, not a round number.
  //
  // Cost scales with the id count: $in makes one index-scan branch per
  // source and MongoDB merge-sorts them. The `q` regex is NOT index-covered
  // (post-filter on scanned docs), so a query matching little walks deep down
  // every branch — that is the case the cap protects. Re-run
  // `scripts/explain-notices-search.js` (multiIn20 / multiIn20NoMatch) before
  // raising this further.
  private static readonly MAX_MULTI_SOURCE_IDS = 20;

  @Get()
  async multi(
    @Query("sourceIds") sourceIdsQuery: unknown,
    @Query("limit") limitQuery: string | undefined,
    @Query("type") typeQuery: string | undefined,
    @Query("cursor") cursorQuery: unknown,
    @Query("q") qQuery: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Cast preserves original .js semantics: array input → TypeError on .split
    // → 500 (HttpExceptionFilter catches). Do NOT defensively narrow here.
    const sourceIdsRaw = (sourceIdsQuery || "") as string;
    const rawIds = sourceIdsRaw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const maxIds = NoticesController.MAX_MULTI_SOURCE_IDS;
    if (rawIds.length === 0 || rawIds.length > maxIds) {
      throw new AppError(
        "INVALID_PARAMS",
        `sourceIds: 1-${maxIds} comma-separated source IDs required`,
        400,
      );
    }
    for (const id of rawIds) {
      if (!this.sources.map.has(id)) {
        throw new AppError("INVALID_SOURCE_ID", `unknown sourceId: ${id}`, 400);
      }
    }

    const rawLimit = parseInt(limitQuery as string, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1),
      50,
    );

    const type = typeQuery;
    if (type && !this.transform.VALID_SUMMARY_TYPES.has(type)) {
      throw new AppError(
        "INVALID_PARAMS",
        "type must be one of: action_required, event, informational",
        400,
      );
    }

    let cursor: CursorPayload | null = null;
    if (cursorQuery) {
      try {
        cursor = this.cursor.decode(cursorQuery);
      } catch (err: unknown) {
        if (err instanceof InvalidCursorError) {
          throw new AppError("INVALID_CURSOR", "cursor is malformed", 400);
        }
        throw err;
      }
    }

    const q = this.search.validateQ(qQuery);

    const opts: {
      cursor: CursorPayload | null;
      limit: number;
      type?: string;
      q?: string;
    } = {
      cursor,
      limit,
    };
    if (type) opts.type = type;
    if (q) opts.q = q;
    const { items, nextCursor, hasMore } = await this.data.findNoticesBySources(
      rawIds,
      opts,
    );
    const notices = items.map((doc) => this.transform.toListItem(doc));
    sendSuccess(
      req,
      res,
      { notices, nextCursor, hasMore },
      { count: notices.length },
    );
  }

  // GET /notices/proxy/attachment?url=...&referer=...&mode=inline|download&name=...
  // Proxies attachment downloads with a Referer header to bypass hotlink
  // protection on some SKKU department servers. Only *.skku.edu hosts allowed.
  @Get("proxy/attachment")
  async proxyAttachment(
    @Query("url") urlQuery: string | undefined,
    @Query("referer") refererQuery: string | undefined,
    @Query("mode") modeQuery: string | undefined,
    @Query("name") nameQuery: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Override helmet's CORP for cross-origin embed by skkuverse.com Pages.
    res.set("Cross-Origin-Resource-Policy", "cross-origin");

    const url = urlQuery;
    const referer = refererQuery;
    const mode = modeQuery;
    const name = nameQuery;
    if (!url) {
      throw new AppError("INVALID_PARAMS", "url is required", 400);
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError("INVALID_PARAMS", "malformed url", 400);
    }

    const ALLOWED_HOSTS = ["skku.edu", "skkumed.ac.kr"];

    if (!ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      throw new AppError("FORBIDDEN", "host not allowed", 403);
    }

    const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };

    if (referer) {
      headers.Referer = referer;
      try {
        const sessionId = await getSessionId(referer);
        if (sessionId) headers.Cookie = `PHPSESSID=${sessionId}`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.warn({ err: message, referer }, "gnuboard session fetch failed");
      }
    }

    const upstream = await axios.get(url, {
      headers,
      responseType: "stream",
      timeout: 15000,
    });

    // Session expired: expected file download but got HTML (login page / error)
    // → invalidate cache and retry once with fresh session.
    const ct = (upstream.headers["content-type"] as string | undefined) || "";
    if (referer && ct.includes("text/html")) {
      (upstream.data as Readable).destroy();
      const domain = new URL(referer).hostname;
      sessionCache.delete(domain);
      try {
        const newSessionId = await getSessionId(referer);
        if (newSessionId) headers.Cookie = `PHPSESSID=${newSessionId}`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.warn(
          { err: message, referer },
          "gnuboard session retry fetch failed",
        );
      }
      const retry = await axios.get(url, {
        headers,
        responseType: "stream",
        timeout: 15000,
      });
      pipeDownload(retry as unknown as UpstreamLike, res, url, name, mode);
      return;
    }

    pipeDownload(upstream as unknown as UpstreamLike, res, url, name, mode);
  }

  // GET /notices/:sourceId/:articleNo
  @Get(":sourceId/:articleNo")
  async detail(
    @Param("sourceId") sourceId: string,
    @Param("articleNo") articleNo: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.sources.map.has(sourceId)) {
      throw new AppError(
        "INVALID_SOURCE_ID",
        `unknown sourceId: ${sourceId}`,
        400,
      );
    }
    if (!/^\d+$/.test(articleNo)) {
      throw new AppError("INVALID_PARAMS", "articleNo must be numeric", 400);
    }
    const doc = await this.data.findNoticeByArticleNo(sourceId, Number(articleNo));
    if (!doc) {
      throw new AppError("NOT_FOUND", "notice not found", 404);
    }
    sendSuccess(req, res, this.transform.toDetailItem(doc));
  }
}

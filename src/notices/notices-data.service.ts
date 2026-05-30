import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../infra/logger";
import {
  DETAIL_PROJECTION,
  LIST_PROJECTION,
  ensureNoticeIndexes,
  findNoticeByArticleNo,
  findNoticesBySource,
  findNoticesBySources,
  getNoticesCollection,
} from "./notices.data";
import type { CursorPayload, NoticeDoc } from "./types";

interface FindOpts {
  cursor?: CursorPayload | null;
  limit: number;
  type?: string;
  q?: string | null;
}

interface FindResult {
  items: NoticeDoc[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * NoticesDataService — thin @Injectable wrapper over the validated, read-only
 * notices.data module (raw mongodb driver via lib/db, NOT
 * Mongoose). Every method delegates 1:1 — no reimplementation, no defensive
 * narrowing — so the LIST/DETAIL projections, the {sourceId,date,crawledAt,_id}
 * FORCE_INDEX .hint(), the serviceStartDate floor, the cursor encoding, and the
 * isDeleted $ne true filter stay byte-identical to the Express app.
 *
 * onModuleInit reproduces index.ts:208-229 EXACTLY: ensureNoticeIndexes() is
 * retried up to 3 times with 1000*attempt backoff; on final failure it logs at
 * ERROR level (NON-FATAL — "list queries will full-scan") rather than crashing.
 * The success log "[notices] Indexes ensured" with {attempt} and the failure
 * strings are reproduced verbatim. No silent narrowing: the retry/error-log
 * contract is preserved, not degraded into a swallow.
 *
 * getNoticesCollection / LIST_PROJECTION / DETAIL_PROJECTION are re-exposed so
 * the dispatcher + controllers (next phase) reuse the same raw-driver handles.
 */
@Injectable()
export class NoticesDataService implements OnModuleInit {
  readonly LIST_PROJECTION = LIST_PROJECTION;
  readonly DETAIL_PROJECTION = DETAIL_PROJECTION;

  async onModuleInit(): Promise<void> {
    // Exact port of index.ts:208-229 — 3-attempt retry with linear backoff,
    // final failure logged at ERROR (non-fatal). Without this index, list
    // queries fall back to full collection scan, which is expensive for the
    // 54MB+ notices collection.
    try {
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await ensureNoticeIndexes();
          logger.info({ attempt }, "[notices] Indexes ensured");
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      }
      if (lastErr) {
        logger.error(
          { err: (lastErr as { message?: string }).message },
          "[notices] Index setup failed after 3 attempts — list queries will full-scan",
        );
      }
    } catch (err) {
      logger.error(
        { err: (err as { message?: string }).message },
        "[notices] Index setup crashed",
      );
    }
  }

  getNoticesCollection(): ReturnType<typeof getNoticesCollection> {
    return getNoticesCollection();
  }

  findNoticesBySource(sourceId: string, opts: FindOpts): Promise<FindResult> {
    return findNoticesBySource(sourceId, opts);
  }

  findNoticesBySources(
    sourceIds: string[],
    opts: FindOpts,
  ): Promise<FindResult> {
    return findNoticesBySources(sourceIds, opts);
  }

  findNoticeByArticleNo(
    sourceId: string,
    articleNo: unknown,
  ): Promise<NoticeDoc | null> {
    return findNoticeByArticleNo(sourceId, articleNo);
  }
}

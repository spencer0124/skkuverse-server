import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { createLogThrottle } from "../../shared/log-throttle.util";
import { issuePaths } from "../../shared/zod-list.util";
import type { NoticeBrief } from "../detail/notices-detail.wire";
import type { NoticeDoc } from "../notices.document";
import { NOTICES_BRIEF_LOG_INTERVAL_MS } from "./notices-brief.constants";
import { toBrief } from "./notices-brief.mapper";
import { storedBrief, type StoredBrief } from "./notices-brief.schema";

@Injectable()
export class NoticesBriefService {
  private readonly unparsedThrottle = createLogThrottle(NOTICES_BRIEF_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(private readonly clock: Clock) {}

  describeBrief(notice: Pick<NoticeDoc, "_id" | "brief">): NoticeBrief | null {
    const stored = this.parseBrief(notice);
    return stored === null || stored.bullets.length === 0 ? null : toBrief(stored);
  }

  private parseBrief({ _id, brief }: Pick<NoticeDoc, "_id" | "brief">): StoredBrief | null {
    if (brief === undefined || brief === null) return null;
    const parsed = storedBrief.safeParse(brief);
    if (parsed.success) return parsed.data;
    const ticket = this.unparsedThrottle.take(_id.toHexString());
    if (ticket) {
      logger.warn({ event: "notices.brief.unparsed", noticeId: _id.toHexString(), paths: issuePaths(parsed.error), ...ticket }, "Notice brief left out: it does not match the brief schema");
    }
    return null;
  }
}

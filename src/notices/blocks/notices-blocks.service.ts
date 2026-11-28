import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { createLogThrottle } from "../../shared/log-throttle.util";
import { issuePaths } from "../../shared/zod-list.util";
import type { NoticeDoc } from "../notices.document";
import { NOTICES_BLOCKS_LOG_INTERVAL_MS } from "./notices-blocks.constants";
import { toAudience } from "./notices-blocks.mapper";
import { isEmptyAudience, isEmptyBrief, isEmptyRefs } from "./notices-blocks.rules";
import { storedAudience, storedBrief, storedRefs } from "./notices-blocks.schema";
import type { NoticeBlockName, NoticeBlocks } from "./notices-blocks.types";

type BlockSource = Pick<NoticeDoc, "_id" | NoticeBlockName>;

@Injectable()
export class NoticesBlocksService {
  private readonly unparsedThrottle = createLogThrottle(NOTICES_BLOCKS_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(private readonly clock: Clock) {}

  describeBlocks(notice: BlockSource): NoticeBlocks {
    const [brief, audience, refs] = [
      this.parseBlock(notice, "brief", storedBrief),
      this.parseBlock(notice, "audience", storedAudience),
      this.parseBlock(notice, "refs", storedRefs),
    ];
    const served = audience && toAudience(audience);
    return {
      brief: brief && !isEmptyBrief(brief) ? brief : null,
      audience: served && !isEmptyAudience(served) ? served : null,
      refs: refs && !isEmptyRefs(refs) ? refs : null,
    };
  }

  private parseBlock<Stored>(notice: BlockSource, block: NoticeBlockName, schema: z.ZodType<Stored>): Stored | null {
    const stored = notice[block];
    if (stored === undefined || stored === null) return null;
    const parsed = schema.safeParse(stored);
    if (parsed.success) return parsed.data;
    const noticeId = notice._id.toHexString();
    const ticket = this.unparsedThrottle.take(`${noticeId}:${block}`);
    if (ticket) {
      logger.warn({ event: "notices.block.unparsed", block, noticeId, paths: issuePaths(parsed.error), ...ticket }, "Notice block left out: it does not match its stored schema");
    }
    return null;
  }
}

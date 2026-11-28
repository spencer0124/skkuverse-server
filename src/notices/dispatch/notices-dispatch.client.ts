import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { postToFcmFunction, type FcmResponse } from "../../infra/fcm";
import type { NoticePushPayload } from "../../infra/fcm.wire";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import type { NoticeDoc } from "../notices.document";

@Injectable()
export class NoticesDispatchClient {
  constructor(
    private readonly legacy: NoticesLegacyService,
    private readonly clock: Clock,
  ) {}

  sendPush(notice: NoticeDoc, topics: string[]): Promise<FcmResponse> {
    return postToFcmFunction(this.toPushPayload(notice, topics));
  }

  // WHY: the Cloud Function relays these fields to the device, as its notice request shape names them;
  // an empty category is left out, which it reads as the general channel (umbrella issue 78).
  private toPushPayload(notice: NoticeDoc, topics: string[]): NoticePushPayload {
    return {
      type: "notice",
      noticeId: String(notice._id),
      topics,
      title_ko: notice.title || "",
      body_ko: notice.summaryOneLiner || this.deriveBody(notice),
      title_en: null,
      body_en: null,
      ...(notice.sourceId ? { sourceId: notice.sourceId } : {}),
      ...(notice.articleNo != null ? { articleNo: String(notice.articleNo) } : {}),
      ...(notice.category ? { category: notice.category } : {}),
    };
  }

  // WHY: with no summary the body is the row's rough one-liner, but only for facts that landed in time: a failed or
  // timed-out gate means the crawler does not vouch for them, so the push is title-only.
  private deriveBody(notice: NoticeDoc): string {
    if (notice.factsGate !== "ok") return "";
    return this.legacy.deriveBrief(notice, this.clock.now())?.oneLiner ?? "";
  }
}

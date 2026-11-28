import { Injectable } from "@nestjs/common";
import { postToFcmFunction, type FcmResponse } from "../../infra/fcm";
import type { NoticePushPayload } from "../../infra/fcm.wire";
import { noticesConfig } from "../notices.config";
import type { NoticeDoc } from "../notices.document";
import { toPushText } from "./notices-dispatch.rules";

@Injectable()
export class NoticesDispatchClient {
  async sendPush(notice: NoticeDoc, topics: string[]): Promise<FcmResponse> {
    return postToFcmFunction(this.toPushPayload(notice, topics));
  }

  // WHY: the Cloud Function relays these fields to the device, as its notice request shape names them;
  // an empty category is left out, which it reads as the general channel (umbrella issue 78).
  private toPushPayload(notice: NoticeDoc, topics: string[]): NoticePushPayload {
    const { title, body } = toPushText(notice, noticesConfig);
    return {
      type: "notice",
      noticeId: String(notice._id),
      topics,
      title_ko: title,
      body_ko: body,
      title_en: null,
      body_en: null,
      ...(notice.sourceId ? { sourceId: notice.sourceId } : {}),
      ...(notice.articleNo != null ? { articleNo: String(notice.articleNo) } : {}),
      ...(notice.category ? { category: notice.category } : {}),
    };
  }
}

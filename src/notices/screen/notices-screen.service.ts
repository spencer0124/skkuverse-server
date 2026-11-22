import { Injectable } from "@nestjs/common";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import logger from "../../infra/logger";
import type { NoticeScheduleItem } from "../detail/notices-detail.wire";
import type { NoticeDoc } from "../notices.document";
import type { NoticeScreen } from "../notices.wire";
import { NoticesRowService } from "../row/notices-row.service";
import { NoticesScheduleService } from "../schedule/notices-schedule.service";
import { toOriginal, toScreenBlocks } from "./notices-screen.mapper";
import { isPosterOnly, toBarAction, toBlockOrder, toCollapse, toDisplayByPlaceId, toFirstSeen, toHeaderChange, toPlaceIds, toStatusLine } from "./notices-screen.rules";
import type { ScreenNotice, ScreenScope } from "./notices-screen.types";

@Injectable()
export class NoticesScreenService {
  constructor(
    private readonly rows: NoticesRowService,
    private readonly places: BuildingPlaceDisplayService,
    private readonly schedules: NoticesScheduleService,
  ) {}

  // WHY: the detail screen's timeline (umbrella ADR 0012 D3); the schedule flow parses it and names its places.
  renderSchedule(notice: Pick<NoticeDoc, "_id" | "schedule">): Promise<NoticeScheduleItem[] | null> {
    return this.schedules.describeSchedule(notice);
  }

  async renderScreen(notice: ScreenNotice, now: Date): Promise<NoticeScreen | null> {
    const reading = this.rows.readNotice(notice, now);
    if (!reading) return null;
    const placeIds = toPlaceIds(reading);
    const displays = placeIds.length > 0 ? await this.describePlaces(notice, placeIds) : [];
    const scope: ScreenScope = { reading, displayByPlaceId: toDisplayByPlaceId(placeIds, displays) };
    return {
      // CONTRACT(skkuverse-crawler): `firstSeenAt` is written once per copy; a copy stored before it lacks it, and the crawler dates it by its `_id` (skkuverse-crawler/docs/notice-facts/design.md "Storage").
      header: { firstSeen: toFirstSeen(notice.firstSeenAt ?? notice._id.getTimestamp(), reading), change: toHeaderChange(scope) },
      status: toStatusLine(reading),
      blocks: toScreenBlocks(scope, toBlockOrder(notice.category, reading)),
      action: toBarAction(reading),
      collapsed: toCollapse(reading),
      staffOnly: reading.isStaffOnly,
      posterOnly: isPosterOnly(reading.facts),
      original: toOriginal(reading.facts, notice.attachments ?? []),
    };
  }

  // WHY: place names are an enrichment; building's caches keep no stale value, so a failed reload shows each place's quote, not a 500.
  private async describePlaces(notice: ScreenNotice, placeIds: string[]): Promise<Array<PlaceDisplay | null>> {
    try {
      return await this.places.describePlaces(placeIds);
    } catch (err) {
      logger.warn({ event: "notices.screen.places_unavailable", noticeId: notice._id.toHexString(), err }, "Notice places shown as written: building could not name them");
      return [];
    }
  }
}

import { Injectable } from "@nestjs/common";
import type { ObjectId } from "mongodb";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { createLogThrottle } from "../../shared/log-throttle.util";
import { issuePaths } from "../../shared/zod-list.util";
import type { NoticeScheduleItem } from "../notices.wire";
import type { NoticeDoc } from "../notices.document";
import { NOTICES_SCHEDULE_LOG_INTERVAL_MS } from "./notices-schedule.constants";
import { toPlaceIds, toScheduleItems } from "./notices-schedule.mapper";
import { storedSchedule, type ScheduleItem } from "./notices-schedule.schema";

@Injectable()
export class NoticesScheduleService {
  private readonly unparsedThrottle = createLogThrottle(NOTICES_SCHEDULE_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly clock: Clock,
    private readonly places: BuildingPlaceDisplayService,
  ) {}

  async describeSchedule(notice: Pick<NoticeDoc, "_id" | "schedule">): Promise<NoticeScheduleItem[] | null> {
    const items = this.parseItems(notice);
    if (items.length === 0) return null;
    const placeIds = toPlaceIds(items);
    const displays = placeIds.length > 0 ? await this.describePlaces(notice._id, placeIds) : [];
    return toScheduleItems(items, placeIds, displays);
  }

  private parseItems({ _id, schedule }: Pick<NoticeDoc, "_id" | "schedule">): ScheduleItem[] {
    if (schedule === undefined || schedule === null) return [];
    const parsed = storedSchedule.safeParse(schedule);
    if (parsed.success) return parsed.data.items;
    const ticket = this.unparsedThrottle.take(_id.toHexString());
    if (ticket) {
      logger.warn({ event: "notices.schedule.unparsed", noticeId: _id.toHexString(), paths: issuePaths(parsed.error), ...ticket }, "Notice schedule left out: it does not match the schedule schema");
    }
    return [];
  }

  // WHY: place names are an enrichment, as on the screen: a failed building read shows each place's words, not a 500.
  private async describePlaces(noticeId: ObjectId, placeIds: string[]): Promise<Array<PlaceDisplay | null>> {
    try {
      return await this.places.describePlaces(placeIds);
    } catch (err) {
      logger.warn({ event: "notices.schedule.places_unavailable", noticeId: noticeId.toHexString(), err }, "Notice schedule places shown as written: building could not name them");
      return [];
    }
  }
}

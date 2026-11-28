import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesScheduleService } from "../schedule/notices-schedule.service";
import { toDetailItem } from "./notices-detail.mapper";
import { isExportable, toCalendar } from "./notices-detail.rules";
import { NoticesDetailRepository } from "./notices-detail.repository";
import type { NoticeDetail } from "./notices-detail.wire";

@Injectable()
export class NoticesDetailService {
  constructor(
    private readonly repository: NoticesDetailRepository,
    private readonly schedules: NoticesScheduleService,
    private readonly clock: Clock,
  ) {}

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetail | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    if (!doc) return null;
    return toDetailItem(doc, await this.schedules.describeSchedule(doc));
  }

  async exportCalendar(sourceId: string, articleNo: number): Promise<string | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    if (!doc) return null;
    const events = (await this.schedules.describeSchedule(doc))?.filter(isExportable) ?? [];
    return events.length > 0 ? toCalendar(doc, events, this.clock.now()) : null;
  }
}

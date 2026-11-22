import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import { NoticesScreenService } from "../screen/notices-screen.service";
import { toDetailItem } from "./notices-detail.mapper";
import { isExportable, toCalendar } from "./notices-detail.rules";
import { NoticesDetailRepository } from "./notices-detail.repository";
import type { NoticeDetail } from "./notices-detail.wire";

@Injectable()
export class NoticesDetailService {
  constructor(
    private readonly repository: NoticesDetailRepository,
    private readonly screens: NoticesScreenService,
    private readonly legacy: NoticesLegacyService,
    private readonly clock: Clock,
  ) {}

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetail | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    if (!doc) return null;
    const now = this.clock.now();
    const schedule = await this.screens.renderSchedule(doc);
    return toDetailItem(doc, await this.screens.renderScreen(doc, now), { derived: this.legacy.deriveBrief(doc, now), schedule });
  }

  async exportCalendar(sourceId: string, articleNo: number): Promise<string | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    if (!doc) return null;
    const events = (await this.screens.renderSchedule(doc))?.filter(isExportable) ?? [];
    return events.length > 0 ? toCalendar(doc, events, this.clock.now()) : null;
  }
}

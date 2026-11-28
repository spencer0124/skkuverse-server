import { Injectable } from "@nestjs/common";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { toRowReading } from "./notices-row.rules";
import type { RowNotice, RowReading, RowSource } from "./notices-row.types";

@Injectable()
export class NoticesRowService {
  constructor(private readonly facts: NoticesFactsService) {}

  readNotice(notice: RowNotice, now: Date): RowReading | null {
    const source = this.toRowSource(notice);
    return source && toRowReading(source, now);
  }

  private toRowSource(notice: RowNotice): RowSource | null {
    const facts = this.facts.parseFacts(notice.facts, notice._id);
    return facts && { facts, factsHistory: this.facts.parseFactsHistory(notice.factsHistory, notice._id), title: notice.title };
  }
}

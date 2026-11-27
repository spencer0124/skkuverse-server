/**
 * NoticesBriefService: the one door a stored `brief` reaches a flow through.
 *
 * describeBrief serves the stored brief's question, fixed by its question key and its own language, with its bullets
 * as text objects, and null for a notice with no brief, a null one, one with no bullets or one the schema refuses; a
 * refused one logs `notices.brief.unparsed` with the notice id and the paths that failed, at most once a minute per
 * notice on the Clock.
 *
 * src/infra/logger.ts is mocked.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { logText } from "../../../__tests__/helpers/log-text";
import { NOTICES_BRIEF_LOG_INTERVAL_MS } from "./notices-brief.constants";
import { NoticesBriefService } from "./notices-brief.service";

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-brief.stored.json");
const BRIEF = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { brief: { questionKey: string; language: string; bullets: Array<Record<string, unknown>>; version: string } }).brief;

const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const START = new Date("2026-11-27T03:00:00.000Z");
const notice = (brief: unknown) => ({ _id: NOTICE_ID, brief });

let instant: Date;
let service: NoticesBriefService;

beforeEach(() => {
  jest.clearAllMocks();
  instant = START;
  const clock: Clock = { now: () => instant };
  service = new NoticesBriefService(clock);
});

describe("NoticesBriefService.describeBrief", () => {
  it("serves the stored question and every bullet as a text object, and logs nothing", () => {
    // Act
    const brief = service.describeBrief(notice(BRIEF));

    // Assert
    expect(brief).toEqual({
      question: "누가 받을 수 있을까?",
      bullets: [
        { text: "직전학기 12학점(마지막 학기는 9학점) 이상을 이수한 자연과학대학 재학생이 신청할 수 있어요." },
        { text: "평점평균이 2.0 이상이어야 해요." },
        { text: "선발되면 등록금 전액을 지원받아요." },
      ],
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("asks the question in the stored language", () => {
    // Act
    const brief = service.describeBrief(notice({ ...BRIEF, language: "en" }));

    // Assert
    expect(brief?.question).toBe("Who can get it?");
  });

  it("serves bullets with no question for the core key", () => {
    // Act
    const brief = service.describeBrief(notice({ ...BRIEF, questionKey: "core" }));

    // Assert
    expect(brief?.question).toBeNull();
    expect(brief?.bullets).toHaveLength(3);
  });

  it.each([
    ["no brief", undefined],
    ["a null brief", null],
    ["a brief with no bullets", { ...BRIEF, bullets: [] }],
  ])("serves null for %s, and logs nothing", (_case, brief) => {
    // Act & Assert
    expect(service.describeBrief(notice(brief))).toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("serves null for a brief the schema refuses, logging it once a minute per notice", () => {
    // Arrange
    const refused = { ...BRIEF, questionKey: "housing" };

    // Act
    const first = service.describeBrief(notice(refused));
    service.describeBrief(notice(refused));
    instant = new Date(START.getTime() + NOTICES_BRIEF_LOG_INTERVAL_MS);
    service.describeBrief(notice(refused));

    // Assert
    expect(first).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(logText(mockLogger.warn.mock.calls[0])).toContain("notices.brief.unparsed");
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ noticeId: NOTICE_ID.toHexString(), paths: "questionKey" });
    expect(mockLogger.warn.mock.calls[1]![0]).toMatchObject({ suppressed: 1 });
  });

  it("names every path of a refused brief that failed, and throttles each notice on its own", () => {
    // Arrange
    const refused = { ...BRIEF, language: "ja", bullets: [{ cites: ["f1"] }] };
    const other = { _id: new ObjectId("6a5ed9e520097db8672d2098"), brief: refused };

    // Act
    service.describeBrief(notice(refused));
    service.describeBrief(other);

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ paths: "language, bullets.0.text" });
    expect(mockLogger.warn.mock.calls[1]![0]).toMatchObject({ noticeId: "6a5ed9e520097db8672d2098" });
  });
});

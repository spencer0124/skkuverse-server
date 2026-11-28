/**
 * NoticesBlocksService: the one door a stored `brief`, `audience` and `refs` reach a flow through.
 *
 * describeBlocks serves each block as plain content, and null for a block the notice stores none of, a null one, an
 * empty one or one the schema refuses, the retired pipeline's brief included; one block's refusal never costs the
 * others. A refused block logs `notices.block.unparsed` with its name, the notice id and the paths that failed, at
 * most once a minute per notice and block on the Clock. An empty block is no failure, and logs nothing.
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
import { NOTICES_BLOCKS_LOG_INTERVAL_MS } from "./notices-blocks.constants";
import { NoticesBlocksService } from "./notices-blocks.service";

type Stored = Record<string, unknown>;
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-blocks.stored.json"), "utf8")) as { brief: Stored; audience: Stored; refs: Stored; retiredBrief: Stored };

const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const START = new Date("2026-11-28T03:00:00.000Z");
const notice = (blocks: { brief?: unknown; audience?: unknown; refs?: unknown }, _id = NOTICE_ID) => ({ _id, ...blocks });

let instant: Date;
let service: NoticesBlocksService;

beforeEach(() => {
  jest.clearAllMocks();
  instant = START;
  const clock: Clock = { now: () => instant };
  service = new NoticesBlocksService(clock);
});

describe("NoticesBlocksService.describeBlocks", () => {
  it("serves each stored block as plain content, and logs nothing", () => {
    // Act
    const blocks = service.describeBlocks(notice({ brief: FIXTURE.brief, audience: FIXTURE.audience, refs: FIXTURE.refs }));

    // Assert
    expect(blocks.brief?.bullets).toHaveLength(3);
    expect(blocks.audience).toEqual({ level: { include: ["grad"] }, status: { include: ["enrolled"], exclude: ["completed", "leave"] }, version: "audience-1" });
    expect(blocks.refs).toEqual({
      links: [{ url: "www.example-department.skku.edu/apply", domain: "example-department.skku.edu" }],
      phones: [{ value: "02-740-1722" }, { value: "02-740-1729" }],
      emails: [{ value: "grad@example.skku.edu" }],
      version: "refs-2",
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["no blocks", {}],
    ["null blocks", { brief: null, audience: null, refs: null }],
    ["empty blocks", { brief: { ...FIXTURE.brief, bullets: [] }, audience: { level: { include: [] }, status: { include: [], exclude: [] }, version: "audience-1" }, refs: { links: [], phones: [], emails: [], version: "refs-2" } }],
  ])("serves null for each block of a notice with %s, and logs nothing", (_case, blocks) => {
    // Act & Assert
    expect(service.describeBlocks(notice(blocks))).toEqual({ brief: null, audience: null, refs: null });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("serves null for a block the schema refuses and keeps the others", () => {
    // Act
    const blocks = service.describeBlocks(notice({ brief: FIXTURE.retiredBrief, audience: { ...FIXTURE.audience, level: { include: [{ value: "postdoc" }] } }, refs: FIXTURE.refs }));

    // Assert
    expect(blocks.brief).toBeNull();
    expect(blocks.audience).toBeNull();
    expect(blocks.refs?.version).toBe("refs-2");
  });

  it("logs a refused block once a minute per notice and block, naming the paths that failed", () => {
    // Arrange
    const refused = notice({ audience: { ...FIXTURE.audience, version: "" }, refs: { ...FIXTURE.refs, phones: [{ purpose: "inquiry" }], emails: null } });

    // Act
    service.describeBlocks(refused);
    service.describeBlocks(refused);
    instant = new Date(START.getTime() + NOTICES_BLOCKS_LOG_INTERVAL_MS);
    service.describeBlocks(refused);

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledTimes(4);
    expect(logText(mockLogger.warn.mock.calls[0])).toContain("notices.block.unparsed");
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ block: "audience", noticeId: NOTICE_ID.toHexString(), paths: "version" });
    expect(mockLogger.warn.mock.calls[1]![0]).toMatchObject({ block: "refs", paths: "phones.0.value, emails" });
    expect(mockLogger.warn.mock.calls[2]![0]).toMatchObject({ block: "audience", suppressed: 1 });
    expect(mockLogger.warn.mock.calls[3]![0]).toMatchObject({ block: "refs", suppressed: 1 });
  });

  it("throttles each notice on its own, and names the retired brief's version as its failure", () => {
    // Arrange
    const other = new ObjectId("6a5ed9e520097db8672d2098");

    // Act
    service.describeBlocks(notice({ brief: FIXTURE.retiredBrief }));
    service.describeBlocks(notice({ brief: FIXTURE.retiredBrief }, other));

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ block: "brief", paths: "version" });
    expect(mockLogger.warn.mock.calls[1]![0]).toMatchObject({ noticeId: other.toHexString() });
  });
});

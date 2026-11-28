/**
 * storedBrief, storedAudience and storedRefs: the server's readers of the `brief`, `audience` and `refs` the crawler
 * stores on a notice (umbrella ADR 0012 D7), each as its stage returns it with its evidence.
 *
 * The hand-written blocks in fixtures/notice-blocks.stored.json parse to what was stored less the evidence: a bullet's
 * quotes, kind and question number, the title's question, the scored candidates, an audience quote, a run record, and
 * any field a later stage adds. A copy missing any declared key, a value outside a vocabulary, a version that is not
 * the brief's current one, a fourth bullet and the retired pipeline's brief do not parse. Empty lists parse: the
 * service decides they show nothing.
 */
import fs from "fs";
import path from "path";
import { storedAudience, storedBrief, storedRefs } from "./notices-blocks.schema";

type Stored = Record<string, unknown>;
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-blocks.stored.json"), "utf8")) as { brief: Stored; audience: Stored; refs: Stored; retiredBrief: Stored };

const without = (stored: Stored, key: string): Stored => Object.fromEntries(Object.entries(stored).filter(([name]) => name !== key));

describe("storedBrief", () => {
  it("parses the stored brief to its language, its bullet texts and its version, and strips the evidence", () => {
    // Act
    const parsed = storedBrief.parse(FIXTURE.brief);

    // Assert
    expect(parsed).toEqual({
      language: "ko",
      bullets: [
        { text: "이 장학금은 성적이 우수한 대학원 진학자의 등록금을 정해진 기간 동안 지원해요." },
        { text: "추천서에 지도교수와 학과장 서명을 받아 대학원 학과 사무실에 제출해요." },
        { text: "선발되면 학기마다 TA로 활동해야 하고, 활동하지 않으면 장학금이 지급되지 않아요." },
      ],
      version: "brief-2",
    });
  });

  it.each(["language", "bullets", "version"])("refuses a brief with no %s", (key) => {
    // Act & Assert
    expect(storedBrief.safeParse(without(FIXTURE.brief, key)).success).toBe(false);
  });

  it.each([
    ["an unknown language", { language: "ja" }],
    ["a null bullet list", { bullets: null }],
    ["a bullet that is a bare string", { bullets: ["신청해요."] }],
    ["a bullet with no text", { bullets: [{ q: 1, quotes: [] }] }],
    ["a bullet whose text is empty", { bullets: [{ text: "" }] }],
    ["four bullets", { bullets: [1, 2, 3, 4].map((q) => ({ text: `bullet ${q}` })) }],
    ["the version of another brief", { version: "brief-3" }],
    ["a version that only begins with brief-2", { version: "brief-20" }],
    ["a freeze key as its version", { version: "9f2c41b07a3de6185c04" }],
  ])("refuses %s", (_case, patch) => {
    // Act & Assert
    expect(storedBrief.safeParse({ ...FIXTURE.brief, ...patch }).success).toBe(false);
  });

  it.each(["brief-2", "brief-2.1"])("parses the version %s", (version) => {
    // Act & Assert
    expect(storedBrief.safeParse({ ...FIXTURE.brief, version }).success).toBe(true);
  });

  it("refuses the brief of the retired pipeline", () => {
    // Act & Assert
    expect(storedBrief.safeParse(FIXTURE.retiredBrief).success).toBe(false);
  });

  it("parses an empty bullet list", () => {
    // Act
    const parsed = storedBrief.safeParse({ ...FIXTURE.brief, bullets: [] });

    // Assert
    expect(parsed.success && parsed.data.bullets).toEqual([]);
  });
});

describe("storedAudience", () => {
  it("parses the stored audience to its values, and strips each quote and the run record", () => {
    // Act
    const parsed = storedAudience.parse(FIXTURE.audience);

    // Assert
    expect(parsed).toEqual({
      level: { include: [{ value: "grad" }] },
      status: { include: [{ value: "enrolled" }, { value: "enrolled" }], exclude: [{ value: "completed" }, { value: "leave" }] },
      version: "audience-1",
    });
  });

  it.each(["level", "status", "version"])("refuses an audience with no %s", (key) => {
    // Act & Assert
    expect(storedAudience.safeParse(without(FIXTURE.audience, key)).success).toBe(false);
  });

  it.each([
    ["a level outside the vocabulary", { level: { include: [{ value: "postdoc", quote: "q" }] } }],
    ["a status outside the vocabulary", { status: { include: [{ value: "visiting", quote: "q" }], exclude: [] } }],
    ["a status with no exclude list", { status: { include: [] } }],
    ["a level that is a bare string", { level: { include: ["grad"] } }],
    ["an empty version", { version: "" }],
  ])("refuses %s", (_case, patch) => {
    // Act & Assert
    expect(storedAudience.safeParse({ ...FIXTURE.audience, ...patch }).success).toBe(false);
  });

  it.each(["undergrad", "grad"])("parses the level %s", (value) => {
    // Act & Assert
    expect(storedAudience.safeParse({ ...FIXTURE.audience, level: { include: [{ value }] } }).success).toBe(true);
  });

  it.each(["enrolled", "leave", "expected_graduate", "completed", "research_registered", "alumni"])("parses the status %s", (value) => {
    // Act & Assert
    expect(storedAudience.safeParse({ ...FIXTURE.audience, status: { include: [{ value }], exclude: [{ value }] } }).success).toBe(true);
  });
});

describe("storedRefs", () => {
  it("parses the stored refs to links with their domain and the bare values of the contacts", () => {
    // Act
    const parsed = storedRefs.parse(FIXTURE.refs);

    // Assert
    expect(parsed).toEqual({
      links: [{ url: "www.example-department.skku.edu/apply", domain: "example-department.skku.edu" }],
      phones: [{ value: "02-740-1722" }, { value: "02-740-1729" }],
      emails: [{ value: "grad@example.skku.edu" }],
      version: "refs-2",
    });
  });

  it("strips a purpose, an owner, a source line and any field a later study adds", () => {
    // Arrange
    const stored = {
      links: [{ url: "https://skku.edu", domain: "skku.edu", title: "t" }],
      phones: [{ value: "02-740-1722", purpose: "inquiry", owner: "대학원팀", line: "문의: 대학원팀(02-740-1722)" }],
      emails: [],
      version: "refs-2",
      study: { hits: 3 },
    };

    // Act
    const parsed = storedRefs.parse(stored);

    // Assert
    expect(parsed).toEqual({ links: [{ url: "https://skku.edu", domain: "skku.edu" }], phones: [{ value: "02-740-1722" }], emails: [], version: "refs-2" });
  });

  it.each(["links", "phones", "emails", "version"])("refuses refs with no %s", (key) => {
    // Act & Assert
    expect(storedRefs.safeParse(without(FIXTURE.refs, key)).success).toBe(false);
  });

  it.each([
    ["a link with no domain", { links: [{ url: "https://skku.edu" }] }],
    ["a link with an empty url", { links: [{ url: "", domain: "skku.edu" }] }],
    ["a contact with no value", { phones: [{ purpose: "inquiry" }] }],
    ["a contact that is a bare string", { emails: ["grad@example.skku.edu"] }],
    ["a null phone list", { phones: null }],
  ])("refuses %s", (_case, patch) => {
    // Act & Assert
    expect(storedRefs.safeParse({ ...FIXTURE.refs, ...patch }).success).toBe(false);
  });
});

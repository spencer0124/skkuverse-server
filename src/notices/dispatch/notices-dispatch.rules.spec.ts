/**
 * Dispatch decisions over the push fields: the claim window (a KST day floor, the lease cutoff, the attempt
 * cap), the field values of a push, a skip and a release, the group's representative and the text a push shows.
 * Its Mongo form is notices-dispatch.query.ts, pinned by the repository spec.
 */
import { ObjectId } from "mongodb";
import { noticesConfig } from "../notices.config";
import type { CategoryConfig, SourceConfig } from "../notices.types";
import { selectRepresentative, toClaimWindow, toPushedFields, toPushText, toReleasedFields, toSkippedFields } from "./notices-dispatch.rules";
import type { PushTabs } from "./notices-dispatch.types";

const POLICY = { maxAgeDays: 14, claimLeaseMs: 10 * 60_000, maxAttempts: 5 };

describe("toClaimWindow", () => {
  it("floors the age gate on the KST day, which is a day after the UTC one at 01:30 KST", () => {
    // Act
    const window = toClaimWindow(new Date("2026-10-19T16:30:00Z"), POLICY);

    // Assert
    expect(window.dateFloor).toBe("2026-10-06");
    expect(window.dateFloor).not.toBe("2026-10-05");
    expect(window.leaseExpiredBefore).toEqual(new Date("2026-10-19T16:20:00Z"));
    expect(window.maxAttempts).toBe(5);
  });
});

describe("toPushedFields", () => {
  it("marks pushed at the time given, releases the lease and clears the error", () => {
    // Act & Assert
    expect(toPushedFields(new Date("2026-10-19T16:30:00Z"))).toEqual({ pushedAt: new Date("2026-10-19T16:30:00Z"), dispatchClaimedAt: null, pushError: null });
  });
});

describe("toSkippedFields", () => {
  it("resolves the notice at the time given with the no-topic reason, releases the lease and clears the error", () => {
    // Act & Assert
    expect(toSkippedFields(new Date("2026-10-19T16:30:00Z"))).toEqual({
      pushedAt: new Date("2026-10-19T16:30:00Z"),
      pushSkippedReason: "no-topic",
      dispatchClaimedAt: null,
      pushError: null,
    });
  });
});

describe("toReleasedFields", () => {
  it("releases the lease and keeps the error's message, cut at 500 characters", () => {
    // Act & Assert
    expect([toReleasedFields(new Error("x".repeat(600))).pushError.length, toReleasedFields("plain").pushError]).toEqual([500, "plain"]);
  });
});

describe("selectRepresentative", () => {
  const doc = (sourceId: string) => ({ _id: new ObjectId(), sourceId });

  it("takes the lowest sourceId among members with a topic, else the first member", () => {
    // Arrange
    const members = [doc("skku-notice07"), doc("skku-main"), doc("skku-notice02")];

    // Act & Assert
    expect(selectRepresentative(members, (m) => m.sourceId !== "skku-main").sourceId).toBe("skku-notice02");
    expect(selectRepresentative(members, () => false).sourceId).toBe("skku-notice07");
  });

  it("refuses an empty group rather than sending a push for nobody", () => {
    // Act & Assert
    expect(() => selectRepresentative([], () => true)).toThrow("a push group has no members");
  });
});

describe("toPushText", () => {
  const source = (id: string, name: string): SourceConfig => ({ id, name, campus: "both", college: null, crawlAvailable: true, excludeReason: null });
  const label = (ko: string): CategoryConfig["label"] => ({ ko, en: ko });
  const tabs: PushTabs = {
    categories: [
      { id: "academic", label: label("학사"), tabMode: "fixed", sourceId: "skku-notice02" },
      { id: "dept", label: label("학과"), tabMode: "picker", sourceIds: ["arch", "bio"], maxSelection: 3 },
      { id: "library", label: label("도서관"), tabMode: "picker", sourceIds: ["lib-hssc"], maxSelection: 1 },
      { id: "event", label: label("행사"), tabMode: "fixed", sourceId: "twice" },
      { id: "general", label: label("일반"), tabMode: "picker", sourceIds: ["twice"], maxSelection: 1 },
    ],
    sourceById: new Map([
      source("skku-notice02", "성균관대_통합(학사)"),
      source("arch", "건축학과"),
      source("bio", "생명과학과(학부)"),
      source("lib-hssc", "중앙학술정보관"),
      source("twice", "두 탭 게시판"),
      source("skku-main", "학부통합(학사)"),
    ].map((entry) => [entry.id, entry])),
  };
  const textOf = (sourceId: string, title = "수강신청 안내") => toPushText({ sourceId, title }, tabs);

  it("titles a fixed tab's notice with the megaphone and the tab's name, and shows the original title as the body", () => {
    // Act & Assert
    expect(textOf("skku-notice02")).toEqual({ title: "📢 학사", body: "수강신청 안내" });
  });

  it("titles a department board's notice with the department's name, not the tab's", () => {
    // Act & Assert
    expect(textOf("arch").title).toBe("📢 건축학과");
    expect(textOf("bio").title).toBe("📢 생명과학과(학부)");
  });

  it("titles a notice of another picker's source with that picker's tab name", () => {
    // Act & Assert
    expect(textOf("lib-hssc").title).toBe("📢 도서관");
  });

  it("falls back to the source's name when no tab or more than one tab holds the source", () => {
    // Act & Assert
    expect(textOf("skku-main").title).toBe("📢 학부통합(학사)");
    expect(textOf("twice").title).toBe("📢 두 탭 게시판");
  });

  it("keeps the original title as written, spaces included", () => {
    // Act & Assert
    expect(textOf("arch", "  [모집] (1차) 서포터즈  ").body).toBe("  [모집] (1차) 서포터즈  ");
  });

  it.each(["", "   "])("refuses a notice whose title is %j rather than sending a push the function rejects", (title) => {
    // Act & Assert
    expect(() => textOf("arch", title)).toThrow("push body: the notice has no title");
  });

  it("refuses a source no tab file lists", () => {
    // Act & Assert
    expect(() => textOf("nowhere")).toThrow("push title: unknown source nowhere");
  });

  it("gives every listed source a non-empty title and body, the tab files as they ship", () => {
    // Act
    const texts = noticesConfig.sources.map((entry) => toPushText({ sourceId: entry.id, title: "공지" }, noticesConfig));

    // Assert
    expect(texts).toHaveLength(noticesConfig.sources.length);
    for (const text of texts) {
      expect(text.title).toMatch(/^📢 \S/);
      expect(text.body).toBe("공지");
    }
  });
});

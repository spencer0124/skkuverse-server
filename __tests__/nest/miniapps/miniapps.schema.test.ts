/**
 * Unit tests for assertValidRegistry — the boot-time fail-loud guard on the
 * mini-app registry.
 *
 * This runs against OUR OWN config, so every case here represents a deploy that
 * must not start rather than a request that must not succeed. The mobile client
 * parses the same data tolerantly (a bad entry there just drops a tile), which
 * is exactly why the strict half has to live on this side.
 */
import { assertValidRegistry } from "../../../src/miniapps/miniapps.schema";
import type { MiniAppDetail, MiniAppIndexRaw } from "../../../src/miniapps/types";

function index(
  overrides: Partial<MiniAppIndexRaw["miniApps"][number]> = {},
): MiniAppIndexRaw {
  return {
    version: 1,
    miniApps: [
      {
        id: "a",
        name: "A",
        order: 1,
        logo: { kind: "remote", path: "/miniapps/a.png" },
        ...overrides,
      },
    ],
  };
}

function details(
  overrides: Partial<MiniAppDetail> = {},
): Record<string, MiniAppDetail> {
  return {
    a: {
      version: 1,
      id: "a",
      startUrl: "https://example.com",
      verified: true,
      relatedLinks: [],
      ...overrides,
    },
  };
}

describe("assertValidRegistry", () => {
  it("accepts a well-formed registry", () => {
    expect(() => assertValidRegistry(index(), details())).not.toThrow();
  });

  it("rejects duplicate ids in the index", () => {
    const dup = index();
    dup.miniApps.push({ ...dup.miniApps[0] });
    expect(() => assertValidRegistry(dup, details())).toThrow(/duplicate ids/);
  });

  it("rejects a non-kebab-case slug", () => {
    // The slug is the deep-link path segment and the analytics id; anything
    // outside [a-z0-9-] would need escaping somewhere downstream.
    const bad = index({ id: "Bad_Slug" });
    const badDetails = { Bad_Slug: { ...details().a, id: "Bad_Slug" } };
    expect(() => assertValidRegistry(bad, badDetails)).toThrow(
      /invalid id slug/,
    );
  });

  it("rejects an absolute logo URL (must stay relative to WEB_ORIGIN)", () => {
    const bad = index({ logo: { kind: "remote", path: "https://evil.com/a.png" } });
    expect(() => assertValidRegistry(bad, details())).toThrow(
      /site-root-relative/,
    );
  });

  it("rejects an index entry with no matching detail", () => {
    expect(() => assertValidRegistry(index(), {})).toThrow(/has no detail/);
  });

  it("rejects an orphan detail not present in the index", () => {
    const orphaned = {
      ...details(),
      ghost: { ...details().a, id: "ghost" },
    };
    expect(() => assertValidRegistry(index(), orphaned)).toThrow(
      /not present in index/,
    );
  });

  it("rejects a detail whose id disagrees with its index entry", () => {
    expect(() =>
      assertValidRegistry(index(), { a: { ...details().a, id: "b" } }),
    ).toThrow(/!= index id/);
  });

  it("rejects a non-http startUrl", () => {
    // The client feeds startUrl straight to a WebView; a javascript: or data:
    // URL here would execute in the mini-app shell.
    expect(() =>
      assertValidRegistry(index(), {
        a: { ...details().a, startUrl: "javascript:alert(1)" },
      }),
    ).toThrow(/bad startUrl/);
  });

  it("rejects a fragment-routed startUrl, which fails without failing", () => {
    // The one malformed startUrl that raises nothing anywhere: the fragment
    // never reaches the origin, the SPA fallback answers at HTTP 200, and the
    // app's error overlay only rises above 400. Wrong page, clean logs.
    expect(() =>
      assertValidRegistry(index(), {
        a: { ...details().a, startUrl: "https://webview.skkuverse.com/#/eskara" },
      }),
    ).toThrow(/uses a fragment/);
  });

  it("rejects a non-http relatedLinks url", () => {
    expect(() =>
      assertValidRegistry(index(), {
        a: {
          ...details().a,
          relatedLinks: [{ url: "javascript:alert(1)" }],
        },
      }),
    ).toThrow(/bad relatedLinks url/);
  });
});

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
        homeLogo: { kind: "remote", path: "/miniapps/a.png" },
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
    const bad = index({ homeLogo: { kind: "remote", path: "https://evil.com/a.png" } });
    expect(() => assertValidRegistry(bad, details())).toThrow(
      /site-root-relative/,
    );
  });

  it("accepts a logo on the media bucket", () => {
    const ok = index({
      homeLogo: { kind: "media", url: "https://media.skkuverse.com/miniapps/a/logo-01234567.jpg" },
    });
    expect(() => assertValidRegistry(ok, details())).not.toThrow();
  });

  it.each([
    ["another host", "https://evil.com/a.jpg"],
    ["the web origin", "https://skkuverse.com/miniapps/a.png"],
    ["a relative path", "/miniapps/a.png"],
  ])("rejects a media logo on %s", (_label, url) => {
    const bad = index({ homeLogo: { kind: "media", url } });
    expect(() => assertValidRegistry(bad, details())).toThrow(/media bucket/);
  });

  it.each([["🍢"], ["🌶️"], ["👩‍🍳"]])("accepts an emoji logo, %s", (emoji) => {
    // 🌶️ carries a variation selector and 👩‍🍳 is a joined sequence: several
    // code points, one glyph on the tile.
    const ok = index({ homeLogo: { kind: "emoji", emoji } });
    expect(() => assertValidRegistry(ok, details())).not.toThrow();
  });

  it.each([
    ["empty", ""],
    ["a word", "ab"],
    ["two emoji", "🍢🍗"],
    ["an emoticon", ":)"],
    ["an emoji and a letter", "🍢a"],
  ])("rejects an emoji logo that is %s", (_label, emoji) => {
    const bad = index({ homeLogo: { kind: "emoji", emoji } });
    expect(() => assertValidRegistry(bad, details())).toThrow(/exactly one emoji/);
  });

  it("accepts a hidden entry", () => {
    expect(() => assertValidRegistry(index({ hidden: true }), details())).not.toThrow();
    expect(() => assertValidRegistry(index({ hidden: false }), details())).not.toThrow();
  });

  it.each([["true"], [1], [null]])("rejects a non-boolean hidden, %j", (hidden) => {
    const bad = index({ hidden: hidden as unknown as boolean });
    expect(() => assertValidRegistry(bad, details())).toThrow(/hidden for "a" must be a boolean/);
  });

  it("accepts an entry with only shellLogo", () => {
    const ok: MiniAppIndexRaw = {
      version: 1,
      miniApps: [{ id: "a", name: "A", order: 1, shellLogo: { kind: "emoji", emoji: "😋" } }],
    };
    expect(() => assertValidRegistry(ok, details())).not.toThrow();
  });

  it("rejects an entry with neither homeLogo nor shellLogo", () => {
    const none: MiniAppIndexRaw = { version: 1, miniApps: [{ id: "a", name: "A", order: 1 }] };
    expect(() => assertValidRegistry(none, details())).toThrow(
      /"a" needs at least one of homeLogo or shellLogo/,
    );
  });

  it.each([
    ["the old single logo", "logo"],
    ["a misspelt homeLogo", "homelogo"],
  ])("rejects an unknown index key: %s", (_label, key) => {
    const bad = {
      version: 1,
      miniApps: [{ ...index().miniApps[0]!, [key]: { kind: "emoji", emoji: "😋" } }],
    } as MiniAppIndexRaw;
    expect(() => assertValidRegistry(bad, details())).toThrow(
      new RegExp(`unknown index key "${key}" in "a"`),
    );
  });

  it.each([[null], [[]], ["😋"]])("rejects a logo that is not an object, %j", (logo) => {
    const bad = index({ homeLogo: logo as unknown as MiniAppIndexRaw["miniApps"][number]["homeLogo"] });
    expect(() => assertValidRegistry(bad, details())).toThrow(/homeLogo for "a" must be an object/);
  });

  it("rejects a remote logo whose path is not a string", () => {
    const bad = index({
      homeLogo: { kind: "remote", path: ["/miniapps/a.png"] as unknown as string },
    });
    expect(() => assertValidRegistry(bad, details())).toThrow(/site-root-relative/);
  });

  it("checks shellLogo with the same rules as homeLogo", () => {
    const bad = index({ shellLogo: { kind: "media", url: "https://evil.com/a.jpg" } });
    expect(() => assertValidRegistry(bad, details())).toThrow(/shellLogo\.url .*media bucket/);
    const twoEmoji = index({ shellLogo: { kind: "emoji", emoji: "🍢🍗" } });
    expect(() => assertValidRegistry(twoEmoji, details())).toThrow(/shellLogo\.emoji .*exactly one emoji/);
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

  describe("a startUrl on our own web view must address a page", () => {
    // The malformed shapes here raise nothing anywhere: the fragment never
    // reaches the origin, the SPA fallback answers at HTTP 200, and the app's
    // error overlay only rises above 400. Wrong page, clean logs.
    const withStartUrl = (startUrl: string) => () =>
      assertValidRegistry(index(), { a: { ...details().a, startUrl } });

    it("rejects a fragment route", () => {
      expect(withStartUrl("https://webview.skkuverse.com/#/eskara")).toThrow(/must address a page/);
    });

    it("rejects a fragment after a real path, which an origin-and-path check misses", () => {
      // Lands on the ESKARA index rather than the entry page — the worse failure,
      // because the user arrives somewhere plausible.
      expect(withStartUrl("https://webview.skkuverse.com/eskara#/entry")).toThrow(
        /must address a page/,
      );
    });

    it("rejects the bare origin, which the old fragment-only ban let through", () => {
      expect(withStartUrl("https://webview.skkuverse.com/")).toThrow(/must address a page/);
    });

    it("accepts a real page", () => {
      expect(withStartUrl("https://webview.skkuverse.com/eskara")).not.toThrow();
    });
  });

  describe("a third-party startUrl keeps its own routing", () => {
    // The rule is origin-gated on purpose. Four of the five registered mini-apps
    // are third parties, this check runs at import, and assertValidRegistry
    // throws — so applying our routing choice to their URLs would mean the server
    // does not boot because someone else's site changed.
    const withStartUrl = (startUrl: string) => () =>
      assertValidRegistry(index(), { a: { ...details().a, startUrl } });

    it("allows a bare root path — this is skkuw's real startUrl", () => {
      expect(withStartUrl("https://www.skkuw.com/")).not.toThrow();
    });

    it("allows a fragment, because that host may legitimately route by hash", () => {
      expect(withStartUrl("https://example.com/#/section")).not.toThrow();
    });

    it("still requires http(s)", () => {
      expect(withStartUrl("javascript:alert(1)")).toThrow(/bad startUrl/);
    });
  });

  describe("shell", () => {
    const withShell = (shell: unknown) => () =>
      assertValidRegistry(index(), {
        a: { ...details().a, shell: shell as MiniAppDetail["shell"] },
      });

    it.each([[{}], [{ bar: "top" }], [{ bar: "bottom" }], [{ bar: "hide" }]])(
      "accepts %j",
      (shell) => {
        expect(withShell(shell)).not.toThrow();
      },
    );

    it.each([["left"], ["TOP"], [true], [null]])("rejects bar %j", (bar) => {
      expect(withShell({ bar })).toThrow(/shell.bar for "a" must be one of top, bottom, hide/);
    });

    it.each([["bottomBar"], ["backForward"], ["position"]])(
      "rejects the unknown key %s, including the old switches",
      (key) => {
        expect(withShell({ [key]: false })).toThrow(new RegExp(`unknown shell key "${key}"`));
      },
    );

    it("rejects a shell that is not an object", () => {
      expect(withShell([])).toThrow(/must be an object/);
      expect(withShell(false)).toThrow(/must be an object/);
      expect(withShell("top")).toThrow(/must be an object/);
    });
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

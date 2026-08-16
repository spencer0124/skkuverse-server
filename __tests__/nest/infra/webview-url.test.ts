/**
 * The webview URL rule, exercised directly rather than through a caller.
 *
 * Every case below was run against the real predicate before being written down,
 * because the interesting ones turn on `new URL` semantics that are easy to state
 * wrongly from memory: it lowercases a host, drops a default port, strips
 * surrounding whitespace, and folds a backslash into a slash. Three of these
 * assertions exist because a plausible hand-rolled check gets them backwards.
 */
import { WEBVIEW_ORIGIN } from "../../../src/infra/origins";
import { isOnWebviewOrigin, toWebviewUrl } from "../../../src/infra/webview-url";

const O = WEBVIEW_ORIGIN;

describe("toWebviewUrl — accepts", () => {
  const cases: [string, string][] = [
    ["a root-relative path, joined onto the origin", "/eskara/entry"],
    ["a deep path", "/a/b/c"],
    ["a query string, which addresses a real page", "/eskara/entry?day=1"],
    ["an absolute URL on our own origin", `${O}/eskara/entry`],
    // URL.origin drops the default port and lowercases the host, so both of these
    // really are this origin. A string comparison would reject them.
    ["the default port spelled out", `${O}:443/x`],
    ["an uppercase host", "https://WEBVIEW.SKKUVERSE.COM/x"],
  ];

  for (const [name, value] of cases) {
    it(name, () => {
      expect(toWebviewUrl(value)).not.toBeNull();
    });
  }

  it("joins the relative form and leaves the absolute form untouched", () => {
    // Returns the caller's string rather than url.href: normalising would rewrite
    // an ops-authored value (port dropped, host lowercased) with no one asking.
    expect(toWebviewUrl("/eskara/entry")).toBe(`${O}/eskara/entry`);
    expect(toWebviewUrl(`${O}/eskara/entry`)).toBe(`${O}/eskara/entry`);
  });
});

describe("toWebviewUrl — rejects", () => {
  const cases: [string, string][] = [
    // The rule. A fragment never reaches the origin, so the SPA fallback answers
    // the surviving path at HTTP 200 and the app's overlay (400+) never fires.
    ["a hash route at the root", `${O}/#/eskara/entry`],
    ["a hash route after a real path", `${O}/eskara#/entry`],
    ["a hash route after a trailing slash", `${O}/eskara/#/entry`],
    ["the relative spelling of the same thing", "/eskara#/entry"],
    // Revoked deliberately: no first-party page uses an anchor, and allowing one
    // is exactly what let `#/entry` through.
    ["an ordinary anchor on a real page", `${O}/eskara/entry#tickets`],
    ["the bare origin", O],
    ["the origin with a trailing slash", `${O}/`],
    ["a trailing empty fragment", `${O}/#`],
    ["the root, relative", "/"],

    // Near-miss hosts. Each of these passes `startsWith(WEBVIEW_ORIGIN)` or looks
    // like our host to a casual reading.
    ["userinfo pointing elsewhere", `${O}@evil.com/x`],
    ["our host as a domain prefix", "https://webview.skkuverse.com.evil.com/x"],
    ["a non-default port, which is a different origin", `${O}:8443/x`],
    ["a trailing-dot host, which is also a different origin", "https://webview.skkuverse.com./x"],
    // The retired webview host. It is no longer granted the bridge either, so
    // this stays a rejection: an old ops-authored value or a copy-paste from a
    // pre-move payload must not resolve to a first-party URL.
    ["the retired legacy host", "https://webview.skkuuniverse.com/eskara/entry"],
    ["an unrelated host", "https://evil.com/x"],
    ["http rather than https", "http://webview.skkuverse.com/x"],

    // Relative values that are not paths.
    ["a protocol-relative URL wearing a path's clothes", "//evil.com"],
    ["the same escape with a backslash", "/\\evil.com"],
    ["a non-URL", "javascript:alert(1)"],
    ["an empty string", ""],

    // `new URL` strips surrounding whitespace, so these would parse clean. The
    // guard runs before the parse for that reason: this function returns the
    // caller's string, so a trailing newline would otherwise reach the client.
    ["a trailing newline, as a spreadsheet paste produces", `${O}/x\n`],
    ["a leading space", `  ${O}/x`],
    ["an inner space", `${O}/a b`],
  ];

  for (const [name, value] of cases) {
    it(name, () => {
      expect(toWebviewUrl(value)).toBeNull();
    });
  }
});

describe("isOnWebviewOrigin", () => {
  it("recognises our own host regardless of path, port or case", () => {
    expect(isOnWebviewOrigin(`${O}/eskara`)).toBe(true);
    expect(isOnWebviewOrigin(`${O}/`)).toBe(true);
    expect(isOnWebviewOrigin(`${O}:443/x`)).toBe(true);
    expect(isOnWebviewOrigin("https://WEBVIEW.SKKUVERSE.COM/x")).toBe(true);
  });

  it("does not claim a third-party host", () => {
    // The gate that keeps our routing rule off other people's sites — and off the
    // registry's four third-party entries, which is what stops this from becoming
    // a boot failure.
    expect(isOnWebviewOrigin("https://www.skkuw.com/")).toBe(false);
    expect(isOnWebviewOrigin("https://student.skku.edu/student/notice2.do")).toBe(false);
    // Not third-party but retired: the predicate names one host, and the host it
    // names is the one WEBVIEW_ORIGIN holds today.
    expect(isOnWebviewOrigin("https://webview.skkuuniverse.com/x")).toBe(false);
    expect(isOnWebviewOrigin(`${O}@evil.com/x`)).toBe(false);
  });

  it("is false rather than throwing for something unparseable", () => {
    expect(isOnWebviewOrigin("not a url")).toBe(false);
    expect(isOnWebviewOrigin("/eskara/entry")).toBe(false);
  });
});

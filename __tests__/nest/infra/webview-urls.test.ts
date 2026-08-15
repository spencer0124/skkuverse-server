/**
 * Every webview URL this API emits, checked for host and form.
 *
 * These four strings had no test at all. `ui.routes.test.ts` asserts that
 * `actionValue` and `pageWebviewLink` exist but never what they contain, and the
 * bus-config tests compare ETags computed from the same data, so they move with
 * a change rather than catching it.
 *
 * That mattered once the web view switched from hash routing to path routing
 * (skkuverse#46). A `#/` URL served to a BrowserRouter is not an error: the
 * fragment never reaches the origin, the SPA fallback answers the bare path with
 * the shell at HTTP 200, and the app's webview only raises its error overlay
 * above status 400. The user gets the wrong page and no way back, and nothing
 * anywhere reports a failure. There is no signal after deploy, so the signal has
 * to be here.
 *
 * The walk is deliberately shape-blind. It finds URLs by looking for the host
 * rather than by reading known field names, so a new webview link added to any
 * of these payloads is covered without this file being updated.
 */
import { getCampusSections } from "../../../src/ui/ui/ui.campus";
import fs from "fs";
import path from "path";
import { getScrollComponent } from "../../../src/ui/ui/ui.scroll";
import { getBusGroups } from "../../../src/bus/bus-config/bus-config.data";
import { BRIDGE_ORIGINS, WEBVIEW_ORIGIN } from "../../../src/infra/origins";

/** Every string anywhere in `value` that names a webview host. */
function webviewUrlsIn(value: unknown): string[] {
  if (typeof value === "string") {
    return value.includes("webview.") ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(webviewUrlsIn);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(webviewUrlsIn);
  }
  return [];
}

/**
 * The mini-app registry is walked too, and it is the one place a webview URL is
 * still hand-typed rather than built from WEBVIEW_ORIGIN — which is how
 * `eskara-2026.json` came to name the legacy host in hash form.
 *
 * Safe to fold in whole: `webviewUrlsIn` filters on the string `webview.`, and
 * the four third-party entries (`student.skku.edu`, `www.skkuw.com`,
 * `webzine.skku.edu`) do not match it. Their URLs answer to their own hosts'
 * rules, not to the assertions below.
 */
const registryDetails = Object.fromEntries(
  fs
    .readdirSync(path.join(__dirname, "../../../src/miniapps/details"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => [
      f,
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../../src/miniapps/details", f), "utf8"),
      ) as unknown,
    ]),
);

const payloads: Record<string, unknown> = {
  "GET /ui/home/campus": getCampusSections(),
  "GET /ui/home/scroll": getScrollComponent(),
  "GET /bus/config": getBusGroups(),
  "src/miniapps/details/*.json": registryDetails,
};

describe("webview URLs the API hands out", () => {
  it("emits at least one, so an empty walk cannot pass by accident", () => {
    const all = Object.values(payloads).flatMap(webviewUrlsIn);
    expect(all.length).toBeGreaterThan(0);
  });

  for (const [name, payload] of Object.entries(payloads)) {
    describe(name, () => {
      const urls = webviewUrlsIn(payload);

      it("builds every webview URL from WEBVIEW_ORIGIN", () => {
        for (const url of urls) {
          expect(url.startsWith(`${WEBVIEW_ORIGIN}/`)).toBe(true);
        }
      });

      it("uses path form, never a fragment", () => {
        for (const url of urls) {
          expect(url).not.toContain("#");
        }
      });

      it("names a host that is granted the bridge", () => {
        // A URL for a host outside the allowlist loads with a dead bridge:
        // the client fails closed and neither side logs anything.
        for (const url of urls) {
          expect(BRIDGE_ORIGINS).toContain(new URL(url).origin);
        }
      });
    });
  }
});

/**
 * Referential-integrity + shape check for the mini-app registry.
 *
 * Ported from packages/shared/src/miniapps/schema.ts, which used to run this at
 * client module load. Now that the server owns the data, the check belongs
 * here: this is OUR OWN config, so a typo is a bug, not a runtime contingency —
 * it throws at boot rather than degrading. The client, which receives the same
 * data as an untrusted remote payload, parses tolerantly instead.
 *
 * That asymmetry is deliberate. Fail loud where you can fix it; fail soft where
 * you can only render it.
 */
import { isOnWebviewOrigin, toWebviewUrl } from "../infra/webview-url";
import type { MiniAppDetail, MiniAppIndexRaw } from "./types";

const HTTP_RE = /^https?:\/\//;
const SLUG_RE = /^[a-z0-9-]+$/;
/** Logo paths are site-root-relative; an absolute URL here would bypass WEB_ORIGIN. */
const ROOT_PATH_RE = /^\/[\w\-./]+$/;

export function assertValidRegistry(
  index: MiniAppIndexRaw,
  details: Record<string, MiniAppDetail>,
): void {
  const ids = index.miniApps.map((m) => m.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("miniapp registry: duplicate ids in index");
  }
  for (const entry of index.miniApps) {
    if (!SLUG_RE.test(entry.id)) {
      throw new Error(`miniapp registry: invalid id slug "${entry.id}"`);
    }
    if (entry.logo.kind !== "remote" || !ROOT_PATH_RE.test(entry.logo.path)) {
      throw new Error(
        `miniapp registry: logo.path for "${entry.id}" must be a site-root-relative path`,
      );
    }
    const detail = details[entry.id];
    if (!detail) {
      throw new Error(`miniapp registry: index id "${entry.id}" has no detail`);
    }
    if (detail.id !== entry.id) {
      throw new Error(
        `miniapp registry: detail.id "${detail.id}" != index id "${entry.id}"`,
      );
    }
    if (!HTTP_RE.test(detail.startUrl)) {
      throw new Error(`miniapp registry: bad startUrl for "${entry.id}"`);
    }
    // Our own web view routes by path, so a startUrl pointing at it must address
    // a real page: a fragment or a bare origin produces no error anywhere, just
    // the SPA shell at HTTP 200 and a user on the wrong page. These URLs are
    // hand-typed here rather than built from WEBVIEW_ORIGIN, so this file is
    // exactly where that recurs.
    //
    // Gated on the origin, and that gate is not cosmetic. Four of the five
    // registered mini-apps are third parties (student.skku.edu, www.skkuw.com,
    // webzine.skku.edu); they route however they like, and skkuw's startUrl is a
    // bare root path already. Applying our rule to them would turn someone else's
    // routing choice into a boot failure here, since this runs at import.
    if (isOnWebviewOrigin(detail.startUrl) && !toWebviewUrl(detail.startUrl)) {
      throw new Error(
        `miniapp registry: startUrl for "${entry.id}" must address a page on the web view — no fragment, not the root`,
      );
    }
    for (const link of detail.relatedLinks) {
      if (!HTTP_RE.test(link.url)) {
        throw new Error(
          `miniapp registry: bad relatedLinks url in "${entry.id}"`,
        );
      }
    }
  }
  for (const id of Object.keys(details)) {
    if (!ids.includes(id)) {
      throw new Error(`miniapp registry: detail "${id}" not present in index`);
    }
  }
}

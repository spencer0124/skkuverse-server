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

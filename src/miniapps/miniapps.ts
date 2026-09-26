/**
 * Server-owned mini-app registry loader.
 *
 * Reads index.json + details/*.json, validates referential integrity (throws at
 * boot on malformed config), resolves image logos to absolute URLs, freezes
 * everything, and exposes an ordered list + a Map for O(1) lookups.
 *
 * Mirrors notices/sources.ts, including the __dirname path resolution: at
 * runtime this is dist/src/miniapps/, and scripts/copy-build-assets.js stages
 * the JSON next to the compiled .js so fs.readFileSync resolves. Adding a JSON
 * file here without registering it there breaks production only — the dev
 * watcher reads from src and never notices.
 */
import fs from "fs";
import path from "path";
import { FIRST_PARTY_MINIAPP_ORIGINS, WEB_ORIGIN } from "../infra/origins";
import { assertValidRegistry } from "./miniapps.schema";
import type {
  MiniAppDetail,
  MiniAppIndexEntry,
  MiniAppIndexRaw,
  MiniAppLogo,
  MiniAppLogoRaw,
} from "./types";

function readJson<T>(...segments: string[]): T {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, ...segments), "utf8"),
  ) as T;
}

const rawIndex = readJson<MiniAppIndexRaw>("index.json");

const rawDetails: Record<string, MiniAppDetail> = Object.fromEntries(
  rawIndex.miniApps.map((entry) => [
    entry.id,
    readJson<MiniAppDetail>("details", `${entry.id}.json`),
  ]),
);

// Fail loud at module load — our own data, so a typo is a bug.
assertValidRegistry(rawIndex, rawDetails);

/** Registry schema version — clients gate breaking changes on this. */
export const version: number = rawIndex.version;

/** The wire logo: both image spellings become one absolute `uri`; an emoji passes through. */
export function resolveLogo(logo: MiniAppLogoRaw): MiniAppLogo {
  switch (logo.kind) {
    case "emoji":
      return { kind: "emoji", emoji: logo.emoji };
    case "media":
      return { kind: "remote", uri: logo.url };
    case "remote":
      return { kind: "remote", uri: `${WEB_ORIGIN}${logo.path}` };
  }
}

/**
 * Ordered index with both logos resolved. The fallback between them is applied
 * here, so the client always receives a `homeLogo` and a `shellLogo` and never
 * has to know which one was authored.
 */
export const list: ReadonlyArray<Readonly<MiniAppIndexEntry>> = Object.freeze(
  [...rawIndex.miniApps]
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      // assertValidRegistry above guarantees at least one of the two.
      const home = (entry.homeLogo ?? entry.shellLogo) as MiniAppLogoRaw;
      const shell = (entry.shellLogo ?? entry.homeLogo) as MiniAppLogoRaw;
      // Named fields rather than `...entry`, so no raw on-disk value can reach
      // the wire even if a key slipped past the schema's allow-list.
      return Object.freeze({
        id: entry.id,
        name: entry.name,
        ...(entry.shortName !== undefined ? { shortName: entry.shortName } : {}),
        order: entry.order,
        homeLogo: Object.freeze(resolveLogo(home)),
        shellLogo: Object.freeze(resolveLogo(shell)),
        ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
      });
    }),
);

/** Frozen id → detail map for O(1) lookups. */
export const map: ReadonlyMap<string, Readonly<MiniAppDetail>> = new Map(
  Object.entries(rawDetails).map(([id, detail]) => [
    id,
    Object.freeze({ ...detail }),
  ]),
);

/**
 * First-party origin → the mini app that owns it, published on GET /app/config
 * as `miniapps.origins` so the app can open any URL on one of these origins in
 * that mini app's shell rather than the generic /webview.
 *
 * Built from the registry's startUrls, so the host is never typed twice. Each
 * FIRST_PARTY_MINIAPP_ORIGINS entry must be claimed by exactly one registered
 * mini app — none means the list names a host nothing opens, two means a URL
 * there has no single owner — and either throws at boot.
 */
export const firstPartyOrigins: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    FIRST_PARTY_MINIAPP_ORIGINS.map((origin) => {
      const owners = [...map.values()].filter((d) => new URL(d.startUrl).origin === origin);
      if (owners.length !== 1) {
        throw new Error(
          `miniapp registry: first-party origin ${origin} must be the startUrl origin of exactly one mini app, found ${owners.length}`,
        );
      }
      return [origin, owners[0]!.id];
    }),
  ),
);

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
import { WEB_ORIGIN } from "../infra/origins";
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
function resolveLogo(logo: MiniAppLogoRaw): MiniAppLogo {
  switch (logo.kind) {
    case "emoji":
      return { kind: "emoji", emoji: logo.emoji };
    case "media":
      return { kind: "remote", uri: logo.url };
    case "remote":
      return { kind: "remote", uri: `${WEB_ORIGIN}${logo.path}` };
  }
}

/** Ordered index with image logos resolved to absolute URLs. */
export const list: ReadonlyArray<Readonly<MiniAppIndexEntry>> = Object.freeze(
  [...rawIndex.miniApps]
    .sort((a, b) => a.order - b.order)
    .map((entry) =>
      Object.freeze({
        ...entry,
        logo: Object.freeze(resolveLogo(entry.logo)),
      }),
    ),
);

/** Frozen id → detail map for O(1) lookups. */
export const map: ReadonlyMap<string, Readonly<MiniAppDetail>> = new Map(
  Object.entries(rawDetails).map(([id, detail]) => [
    id,
    Object.freeze({ ...detail }),
  ]),
);

/**
 * Server-owned mini-app registry loader.
 *
 * Reads index.json + details/*.json, validates referential integrity (throws at
 * boot on malformed config), resolves logo paths against WEB_ORIGIN, freezes
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

/** Ordered index with logo paths resolved to absolute URLs under WEB_ORIGIN. */
export const list: ReadonlyArray<Readonly<MiniAppIndexEntry>> = Object.freeze(
  [...rawIndex.miniApps]
    .sort((a, b) => a.order - b.order)
    .map((entry) =>
      Object.freeze({
        ...entry,
        logo: Object.freeze({
          kind: "remote" as const,
          uri: `${WEB_ORIGIN}${entry.logo.path}`,
        }),
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

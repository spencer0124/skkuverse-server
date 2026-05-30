/**
 * Server-owned notice-source list loader.
 *
 * Reads `sources.json` (vendored from skkuverse-crawler + UX metadata:
 * campus, category, hasCategory, hasAuthor), freezes it, and exposes a
 * Map for O(1) lookups.
 *
 * Path resolves relative to __dirname — at runtime this is
 * dist/src/notices/, and scripts/copy-build-assets.js stages
 * sources.json next to the compiled .js so fs.readFileSync resolves.
 */
import fs from "fs";
import path from "path";
import type { SourceConfig } from "./types";

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sources.json"), "utf8"),
) as SourceConfig[];

const list: ReadonlyArray<Readonly<SourceConfig>> = Object.freeze(
  raw.map((s) => Object.freeze({ ...s })),
);
const map: ReadonlyMap<string, Readonly<SourceConfig>> = new Map(
  list.map((s) => [s.id, s]),
);

export { list, map };

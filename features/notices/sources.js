/**
 * Server-owned notice-source list loader.
 *
 * Reads `sources.json` (vendored from skkuverse-crawler + UX metadata:
 * campus, category, hasCategory, hasAuthor), freezes it, and exposes a
 * Map for O(1) lookups.
 */

const fs = require("fs");
const path = require("path");

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sources.json"), "utf8")
);

const list = Object.freeze(raw.map((s) => Object.freeze({ ...s })));
const map = new Map(list.map((s) => [s.id, s]));

module.exports = { list, map };

/**
 * Server-owned departments list loader.
 *
 * Reads `departments.json` (144 entries vendored from skkuverse-crawler +
 * UX metadata: campus, category, hasCategory, hasAuthor), freezes it,
 * computes a stable sha256 version hash, and exposes a Map for O(1) lookups.
 *
 * The version hash lets clients compare their bundled fallback list against
 * the server's current list without parsing both in full.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "departments.json"), "utf8")
);

const list = Object.freeze(raw.map((d) => Object.freeze({ ...d })));

// Canonical serialization for hashing: sort by id, include only value-bearing fields.
const canonical = JSON.stringify(
  list
    .map((d) => [d.id, d.name, d.campus, d.category, d.hasCategory, d.hasAuthor])
    .sort((a, b) => a[0].localeCompare(b[0]))
);
const version = crypto.createHash("sha256").update(canonical).digest("hex");

const map = new Map(list.map((d) => [d.id, d]));

module.exports = { list, version, map };

/**
 * Notice tab configuration loader.
 *
 * Reads `categories.json` (tab definitions) and `sources.json` (notice
 * source metadata) at startup, validates structure, and pre-computes the
 * data needed by the `GET /notices/tabs` handler.
 *
 * Both files are SSOT-managed by skkuverse-crawler. Changes require a
 * server redeploy to take effect.
 *
 * Exits with code 1 on any validation failure — bad config must never
 * result in a silently broken /notices/tabs response.
 */

const fs = require("fs");
const path = require("path");

const isTest = process.env.NODE_ENV === "test";

// ── Helpers ──

function fatal(message) {
  console.error(`FATAL [tabConfig]: ${message}`);
  if (!isTest) process.exit(1);
}

function loadJSON(filename) {
  const filePath = path.join(__dirname, filename);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    fatal(`Cannot read ${filename}: ${err.message}`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fatal(`Invalid JSON in ${filename}: ${err.message}`);
    return undefined;
  }
}

// ── Load & validate ──

const rawCategories = loadJSON("categories.json");
const rawSources = loadJSON("sources.json");

if (!Array.isArray(rawCategories)) {
  fatal("categories.json must be a JSON array");
}
if (!Array.isArray(rawSources)) {
  fatal("sources.json must be a JSON array");
}

const sourceMap = new Map(rawSources.map((s) => [s.id, s]));

const errors = [];

for (let i = 0; i < rawCategories.length; i++) {
  const cat = rawCategories[i];
  const prefix = `categories[${i}]`;

  if (!cat.id || typeof cat.id !== "string") {
    errors.push(`${prefix}: missing or invalid "id"`);
    continue;
  }

  if (!cat.label || typeof cat.label !== "object") {
    errors.push(`${prefix} (${cat.id}): missing "label" object`);
  } else if (!cat.label.ko || !cat.label.en) {
    errors.push(`${prefix} (${cat.id}): label must have "ko" and "en" keys`);
  }

  if (cat.tabMode === "fixed") {
    if (!cat.sourceId || typeof cat.sourceId !== "string") {
      errors.push(`${prefix} (${cat.id}): fixed tab missing "sourceId"`);
    } else if (!sourceMap.has(cat.sourceId)) {
      errors.push(
        `${prefix} (${cat.id}): sourceId "${cat.sourceId}" not found in sources.json`
      );
    }
  } else if (cat.tabMode === "picker") {
    if (!Array.isArray(cat.sourceIds) || cat.sourceIds.length === 0) {
      errors.push(`${prefix} (${cat.id}): picker tab must have non-empty "sourceIds" array`);
    } else {
      for (const id of cat.sourceIds) {
        if (!sourceMap.has(id)) {
          errors.push(
            `${prefix} (${cat.id}): sourceId "${id}" in sourceIds not found in sources.json`
          );
        }
      }
    }
    if (typeof cat.maxSelection !== "number" || cat.maxSelection < 1) {
      errors.push(`${prefix} (${cat.id}): picker tab must have "maxSelection" >= 1`);
    }

    if (cat.defaultIds != null) {
      if (!Array.isArray(cat.defaultIds)) {
        errors.push(`${prefix} (${cat.id}): "defaultIds" must be an array`);
      } else {
        for (const id of cat.defaultIds) {
          if (!cat.sourceIds.includes(id)) {
            errors.push(
              `${prefix} (${cat.id}): defaultIds "${id}" is not in sourceIds`
            );
          }
        }
      }
    }

    if (cat.campusDefaultIds != null) {
      if (typeof cat.campusDefaultIds !== "object" || Array.isArray(cat.campusDefaultIds)) {
        errors.push(
          `${prefix} (${cat.id}): "campusDefaultIds" must be an object`
        );
      } else {
        const validKeys = new Set(["hssc", "nsc"]);
        for (const [campusKey, ids] of Object.entries(cat.campusDefaultIds)) {
          if (!validKeys.has(campusKey)) {
            errors.push(
              `${prefix} (${cat.id}): campusDefaultIds key "${campusKey}" must be "hssc" or "nsc"`
            );
            continue;
          }
          if (!Array.isArray(ids)) {
            errors.push(
              `${prefix} (${cat.id}): campusDefaultIds.${campusKey} must be an array`
            );
            continue;
          }
          for (const id of ids) {
            if (!cat.sourceIds.includes(id)) {
              errors.push(
                `${prefix} (${cat.id}): campusDefaultIds.${campusKey} "${id}" is not in sourceIds`
              );
            }
          }
          // Per-campus seed cap: union of common defaults + this campus must
          // not exceed maxSelection so the picker UI's cap stays valid for
          // every campus selection.
          if (Array.isArray(cat.defaultIds) && typeof cat.maxSelection === "number") {
            const seed = new Set([...cat.defaultIds, ...ids]);
            if (seed.size > cat.maxSelection) {
              errors.push(
                `${prefix} (${cat.id}): seed for campus "${campusKey}" has ${seed.size} ids > maxSelection ${cat.maxSelection}`
              );
            }
          }
        }
      }
    }
  } else {
    errors.push(`${prefix} (${cat.id}): unknown tabMode "${cat.tabMode}"`);
  }
}

if (errors.length > 0) {
  fatal(
    `categories.json validation failed (${errors.length} error(s)):\n${errors.map((e) => `  • ${e}`).join("\n")}`
  );
}

// ── Pre-compute tab data ──

/**
 * Build the tabs response for a given language.
 * @param {"ko"|"en"} lang
 * @returns {{ schemaVersion: number, tabs: object[] }}
 */
function buildTabsResponse(lang) {
  const tabs = [];

  for (const cat of rawCategories) {
    const label = cat.label[lang] || cat.label.en || cat.label.ko;

    if (cat.tabMode === "fixed") {
      const source = sourceMap.get(cat.sourceId);
      tabs.push({
        key: cat.id,
        label,
        tabMode: "fixed",
        fixed: {
          sourceId: cat.sourceId,
          name: source.name,
          campus: source.campus ?? null,
        },
      });
    } else if (cat.tabMode === "picker") {
      const sources = [];
      for (const id of cat.sourceIds) {
        const source = sourceMap.get(id);
        if (!source) continue;
        // Domain boundary: crawler-domain `crawlAvailable` (read from
        // sources.json, generated by skkuverse-crawler) is exposed to the
        // client as the friendlier `noticeAvailable`. `excludeReason` is
        // an i18n key (e.g. "loginRequired") — the client looks up the
        // localized copy. `?? true` and `?? null` keep this resilient
        // against an older sources.json that pre-dates the rename.
        sources.push({
          id: source.id,
          name: source.name,
          campus: source.campus ?? null,
          college: source.college ?? null,
          noticeAvailable: source.crawlAvailable ?? true,
          excludeReason: source.excludeReason ?? null,
        });
      }

      tabs.push({
        key: cat.id,
        label,
        tabMode: "picker",
        picker: {
          sources,
          maxSelection: Math.min(cat.maxSelection, sources.length),
          defaultIds: cat.defaultIds ?? [],
          campusDefaultIds: cat.campusDefaultIds ?? {},
        },
      });
    }
  }

  return { schemaVersion: 1, tabs };
}

// Pre-compute for each supported language and freeze for immutability.
const responseByLang = Object.freeze({
  ko: Object.freeze(buildTabsResponse("ko")),
  en: Object.freeze(buildTabsResponse("en")),
});

module.exports = { responseByLang, sourceMap };

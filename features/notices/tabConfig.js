/**
 * Notice tab configuration loader.
 *
 * Reads `categories.json` (tab definitions) and `departments.json` (dept
 * metadata) at startup, validates structure, and pre-computes the data
 * needed by the `GET /notices/tabs` handler.
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
const rawDepartments = loadJSON("departments.json");

if (!Array.isArray(rawCategories)) {
  fatal("categories.json must be a JSON array");
}
if (!Array.isArray(rawDepartments)) {
  fatal("departments.json must be a JSON array");
}

const deptMap = new Map(rawDepartments.map((d) => [d.id, d]));

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
    if (!cat.deptId || typeof cat.deptId !== "string") {
      errors.push(`${prefix} (${cat.id}): fixed tab missing "deptId"`);
    } else if (!deptMap.has(cat.deptId)) {
      errors.push(
        `${prefix} (${cat.id}): deptId "${cat.deptId}" not found in departments.json`
      );
    }
  } else if (cat.tabMode === "picker") {
    if (!Array.isArray(cat.deptIds) || cat.deptIds.length === 0) {
      errors.push(`${prefix} (${cat.id}): picker tab must have non-empty "deptIds" array`);
    } else {
      for (const id of cat.deptIds) {
        if (!deptMap.has(id)) {
          errors.push(
            `${prefix} (${cat.id}): deptId "${id}" in deptIds not found in departments.json`
          );
        }
      }
    }
    if (typeof cat.maxSelection !== "number" || cat.maxSelection < 1) {
      errors.push(`${prefix} (${cat.id}): picker tab must have "maxSelection" >= 1`);
    }
    if (cat.defaultDeptIds != null) {
      if (!Array.isArray(cat.defaultDeptIds)) {
        errors.push(`${prefix} (${cat.id}): "defaultDeptIds" must be an array`);
      } else {
        for (const id of cat.defaultDeptIds) {
          if (!cat.deptIds.includes(id)) {
            errors.push(
              `${prefix} (${cat.id}): defaultDeptIds "${id}" is not in deptIds`
            );
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
      const dept = deptMap.get(cat.deptId);
      tabs.push({
        key: cat.id,
        label,
        tabMode: "fixed",
        fixed: {
          deptId: cat.deptId,
          name: dept.name,
          campus: dept.campus ?? null,
        },
      });
    } else if (cat.tabMode === "picker") {
      const departments = [];
      for (const id of cat.deptIds) {
        const dept = deptMap.get(id);
        if (!dept) continue;
        departments.push({ id: dept.id, name: dept.name, campus: dept.campus ?? null });
      }

      tabs.push({
        key: cat.id,
        label,
        tabMode: "picker",
        picker: {
          departments,
          maxSelection: Math.min(cat.maxSelection, departments.length),
          defaultDeptIds: cat.defaultDeptIds ?? [],
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

module.exports = { responseByLang, deptMap };

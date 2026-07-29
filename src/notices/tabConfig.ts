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
import fs from "fs";
import path from "path";
import type {
  SourceConfig,
  CategoryConfig,
  Tab,
  TabsResponse,
} from "./types";

const isTest = process.env.NODE_ENV === "test";

// ── Helpers ──

function fatal(message: string): void {
  console.error(`FATAL [tabConfig]: ${message}`);
  if (!isTest) process.exit(1);
}

function loadJSON(filename: string): unknown {
  const filePath = path.join(__dirname, filename);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(`Cannot read ${filename}: ${message}`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(`Invalid JSON in ${filename}: ${message}`);
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

// `fatal` in test mode returns without exit; in that case the rest of the
// module loads against undefined arrays which crashes below. That's the
// intended dev/test-time signal — let it crash loudly.
const categoriesArr = rawCategories as CategoryConfig[];
const sourcesArr = rawSources as SourceConfig[];

const sourceMap: Map<string, SourceConfig> = new Map(
  sourcesArr.map((s) => [s.id, s]),
);

const errors: string[] = [];

for (let i = 0; i < categoriesArr.length; i++) {
  // Validate against unknown-shaped input (categories.json may be edited
  // independently). Cast `cat` to a permissive shape, then narrow per branch.
  const cat = categoriesArr[i] as unknown as Record<string, unknown>;
  const prefix = `categories[${i}]`;

  if (!cat.id || typeof cat.id !== "string") {
    errors.push(`${prefix}: missing or invalid "id"`);
    continue;
  }

  const label = cat.label as { ko?: unknown; en?: unknown } | undefined;
  if (!label || typeof label !== "object") {
    errors.push(`${prefix} (${cat.id}): missing "label" object`);
  } else if (!label.ko || !label.en) {
    errors.push(`${prefix} (${cat.id}): label must have "ko" and "en" keys`);
  }

  if (cat.tabMode === "fixed") {
    if (!cat.sourceId || typeof cat.sourceId !== "string") {
      errors.push(`${prefix} (${cat.id}): fixed tab missing "sourceId"`);
    } else if (!sourceMap.has(cat.sourceId)) {
      errors.push(
        `${prefix} (${cat.id}): sourceId "${cat.sourceId}" not found in sources.json`,
      );
    }
  } else if (cat.tabMode === "picker") {
    const sourceIds = cat.sourceIds as unknown;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      errors.push(
        `${prefix} (${cat.id}): picker tab must have non-empty "sourceIds" array`,
      );
    } else {
      for (const id of sourceIds) {
        if (!sourceMap.has(id as string)) {
          errors.push(
            `${prefix} (${cat.id}): sourceId "${id}" in sourceIds not found in sources.json`,
          );
        }
      }
    }
    if (typeof cat.maxSelection !== "number" || cat.maxSelection < 1) {
      errors.push(
        `${prefix} (${cat.id}): picker tab must have "maxSelection" >= 1`,
      );
    }

    if (cat.defaultIds != null) {
      if (!Array.isArray(cat.defaultIds)) {
        errors.push(`${prefix} (${cat.id}): "defaultIds" must be an array`);
      } else {
        for (const id of cat.defaultIds) {
          if (!(sourceIds as unknown[] | undefined)?.includes(id)) {
            errors.push(
              `${prefix} (${cat.id}): defaultIds "${id}" is not in sourceIds`,
            );
          }
        }
      }
    }

    if (cat.campusDefaultIds != null) {
      if (
        typeof cat.campusDefaultIds !== "object" ||
        Array.isArray(cat.campusDefaultIds)
      ) {
        errors.push(
          `${prefix} (${cat.id}): "campusDefaultIds" must be an object`,
        );
      } else {
        const validKeys = new Set(["hssc", "nsc"]);
        for (const [campusKey, ids] of Object.entries(
          cat.campusDefaultIds as Record<string, unknown>,
        )) {
          if (!validKeys.has(campusKey)) {
            errors.push(
              `${prefix} (${cat.id}): campusDefaultIds key "${campusKey}" must be "hssc" or "nsc"`,
            );
            continue;
          }
          if (!Array.isArray(ids)) {
            errors.push(
              `${prefix} (${cat.id}): campusDefaultIds.${campusKey} must be an array`,
            );
            continue;
          }
          for (const id of ids) {
            if (!(sourceIds as unknown[] | undefined)?.includes(id)) {
              errors.push(
                `${prefix} (${cat.id}): campusDefaultIds.${campusKey} "${id}" is not in sourceIds`,
              );
            }
          }
          // Per-campus seed cap: union of common defaults + this campus must
          // not exceed maxSelection so the picker UI's cap stays valid for
          // every campus selection.
          if (
            Array.isArray(cat.defaultIds) &&
            typeof cat.maxSelection === "number"
          ) {
            const seed = new Set([...(cat.defaultIds as string[]), ...(ids as string[])]);
            if (seed.size > cat.maxSelection) {
              errors.push(
                `${prefix} (${cat.id}): seed for campus "${campusKey}" has ${seed.size} ids > maxSelection ${cat.maxSelection}`,
              );
            }
          }
        }
      }
    }
  } else {
    errors.push(`${prefix} (${cat.id}): unknown tabMode "${String(cat.tabMode)}"`);
  }
}

if (errors.length > 0) {
  fatal(
    `categories.json validation failed (${errors.length} error(s)):\n${errors.map((e) => `  • ${e}`).join("\n")}`,
  );
}

// ── Pre-compute tab data ──

/**
 * Build the tabs response for a given language.
 */
function buildTabsResponse(lang: "ko" | "en"): TabsResponse {
  const tabs: Tab[] = [];

  for (const cat of categoriesArr) {
    const labelMap = cat.label as { ko: string; en?: string };
    const label = labelMap[lang] || labelMap.en || labelMap.ko;

    if (cat.tabMode === "fixed") {
      // Validation above (lines ~93-100) proves sourceMap.has(cat.sourceId).
      // Non-null assertion preserves original .js fail-loud semantics: a
      // missing source would TypeError on `source.name` → 500 → ops alert,
      // rather than silently dropping the tab. ([[feedback_no_silent_defensive_narrowing]])
      const source = sourceMap.get(cat.sourceId)!;
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
          // Localized copy is resolved by TabConfigService (the served
          // response). This legacy builder's response is never served —
          // notices.topics imports only `categories` from this module.
          excludeReasonText: null,
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
const responseByLang: Readonly<Record<"ko" | "en", Readonly<TabsResponse>>> =
  Object.freeze({
    ko: Object.freeze(buildTabsResponse("ko")),
    en: Object.freeze(buildTabsResponse("en")),
  });

// Frozen view of the validated category definitions, exposed for callers that
// need to reverse-map a sourceId onto its tab(s) — e.g. the FCM dispatcher
// computing topics for a notice. Validation already ran above, so consumers
// can trust shape: { id, tabMode: "fixed"|"picker", sourceId? | sourceIds[] }.
const categories: ReadonlyArray<Readonly<CategoryConfig>> = Object.freeze(
  categoriesArr.map((c) => Object.freeze(c)),
);

export { responseByLang, categories };

import { Injectable } from "@nestjs/common";
import fs from "fs";
import path from "path";
import type {
  SourceConfig,
  CategoryConfig,
  Tab,
  TabsResponse,
} from "../../features/notices/types";

/**
 * TabConfigService — NestJS port of features/notices/tabConfig.ts.
 *
 * Loads + validates categories.json and sources.json and pre-computes the
 * Object.freeze'd per-language tabs response served by GET /notices/tabs.
 *
 * FAIL-LOUD AT BOOTSTRAP: the original module does `process.exit(1)` on any
 * validation failure at require()-time. We cannot delegate to it without
 * importing that exit-on-load side effect, so the load+validate logic is
 * ported here verbatim with the single change that `fatal` THROWS instead of
 * `process.exit(1)`. The throw is raised inside `load()`, invoked from the
 * provider factory (see tabconfig.provider.ts) so a bad JSON config crashes
 * the Nest app at boot rather than silently degrading the /notices/tabs
 * response. No `?? []` / typeof guard converts a throw into a silent skip
 * (per feedback_no_silent_defensive_narrowing).
 *
 * The JSON files are read from features/notices/ at runtime (dist staging is
 * handled by scripts/copy-build-assets.js next to the compiled features/*).
 */

const CONFIG_DIR = path.join(__dirname, "..", "..", "features", "notices");

// Element type of the picker tab's `sources` array. Byte-identical to the
// shape built by the original tabConfig.ts (and structurally to the
// `TabPickerSource` member of the shared `Tab` union in
// features/notices/types.ts). Declared standalone — NOT derived via a
// conditional/indexed access on `Tab` — to avoid perturbing TS's deferred
// resolution of the `Tab` union across the program. Annotating the local
// accumulator with it prevents an evolving `never[]` for `const sources = []`.
interface PickerSource {
  id: string;
  name: string;
  campus: string | null;
  college: string | null;
  noticeAvailable: boolean;
  excludeReason: string | null;
}

@Injectable()
export class TabConfigService {
  private _responseByLang!: Readonly<
    Record<"ko" | "en", Readonly<TabsResponse>>
  >;
  private _categories!: ReadonlyArray<Readonly<CategoryConfig>>;
  private loaded = false;

  /**
   * Loaded, validated, frozen tabs response keyed by language ("ko" | "en").
   * zh falls back to "en" at the controller (mirrors notices.routes.ts:31).
   */
  get responseByLang(): Readonly<
    Record<"ko" | "en", Readonly<TabsResponse>>
  > {
    return this._responseByLang;
  }

  /** Frozen validated category definitions (for topic reverse-mapping). */
  get categories(): ReadonlyArray<Readonly<CategoryConfig>> {
    return this._categories;
  }

  /**
   * Load + validate the JSON config and pre-compute the frozen responses.
   * Idempotent. Throws on any validation failure (fail-loud at bootstrap).
   */
  load(): void {
    if (this.loaded) return;

    const rawCategories = this.loadJSON("categories.json");
    const rawSources = this.loadJSON("sources.json");

    if (!Array.isArray(rawCategories)) {
      this.fatal("categories.json must be a JSON array");
    }
    if (!Array.isArray(rawSources)) {
      this.fatal("sources.json must be a JSON array");
    }

    const categoriesArr = rawCategories as CategoryConfig[];
    const sourcesArr = rawSources as SourceConfig[];

    const sourceMap: Map<string, SourceConfig> = new Map(
      sourcesArr.map((s) => [s.id, s]),
    );

    const errors: string[] = [];

    for (let i = 0; i < categoriesArr.length; i++) {
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
        errors.push(
          `${prefix} (${cat.id}): label must have "ko" and "en" keys`,
        );
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
              if (
                Array.isArray(cat.defaultIds) &&
                typeof cat.maxSelection === "number"
              ) {
                const seed = new Set([
                  ...(cat.defaultIds as string[]),
                  ...(ids as string[]),
                ]);
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
        errors.push(
          `${prefix} (${cat.id}): unknown tabMode "${String(cat.tabMode)}"`,
        );
      }
    }

    if (errors.length > 0) {
      this.fatal(
        `categories.json validation failed (${errors.length} error(s)):\n${errors.map((e) => `  • ${e}`).join("\n")}`,
      );
    }

    this._responseByLang = Object.freeze({
      ko: Object.freeze(this.buildTabsResponse(categoriesArr, sourceMap, "ko")),
      en: Object.freeze(this.buildTabsResponse(categoriesArr, sourceMap, "en")),
    });

    this._categories = Object.freeze(
      categoriesArr.map((c) => Object.freeze(c)),
    );

    this.loaded = true;
  }

  // ── Helpers (ported from features/notices/tabConfig.ts) ──

  /**
   * FAIL-LOUD: the original `fatal` does `console.error` + `process.exit(1)`.
   * In NestJS we THROW so bootstrap aborts loudly without silent defaulting.
   */
  private fatal(message: string): never {
    throw new Error(`FATAL [tabConfig]: ${message}`);
  }

  private loadJSON(filename: string): unknown {
    const filePath = path.join(CONFIG_DIR, filename);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.fatal(`Cannot read ${filename}: ${message}`);
    }
    try {
      return JSON.parse(raw);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.fatal(`Invalid JSON in ${filename}: ${message}`);
    }
  }

  private buildTabsResponse(
    categoriesArr: CategoryConfig[],
    sourceMap: Map<string, SourceConfig>,
    lang: "ko" | "en",
  ): TabsResponse {
    const tabs: Tab[] = [];

    for (const cat of categoriesArr) {
      const labelMap = cat.label as { ko: string; en?: string };
      const label = labelMap[lang] || labelMap.en || labelMap.ko;

      if (cat.tabMode === "fixed") {
        // Validation above proves sourceMap.has(cat.sourceId). Non-null
        // assertion preserves the original fail-loud semantics.
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
        const sources: PickerSource[] = [];
        for (const id of cat.sourceIds) {
          const source = sourceMap.get(id);
          if (!source) continue;
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
}

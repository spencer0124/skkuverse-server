/**
 * The notices `v2` flows import nothing the released routes will lose (docs/reference/notices-api.md, "What goes when
 * the released routes go"), so dropping those routes touches no `v2` file. A `v2` file may import the notices root, its
 * own folder, and from another flow of the module only its `.module` and `.service` and the stored shapes of its `.document`
 * and `.types`: never a wire, controller, mapper, schema, rules, query or constants file of the released list, detail,
 * overview, tabs, attachment or dispatch flows, and never the overview limiter. A spec may also name a released
 * flow's `.repository`, to put a fake under the service it builds.
 */
import path from "path";
import { importsOf, parseSource, resolveRelative } from "../helpers/architecture/ast";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const V2_ROOT = "src/notices/v2/";
const SHARED_FLOWS = ["blocks", "schedule"];
const ALLOWED_ROLES = new Set(["module", "service", "document", "types"]);
const SPEC_ROLES = new Set([...ALLOWED_ROLES, "repository"]);
const RELEASED_ONLY = ["src/http/notices-overview-rate-limit.middleware"];

const roleOf = (target: string): string => path.posix.basename(target).split(".").at(-1) ?? "";

/** `<importer> → <target>` for each import of a `v2` file that reaches released-route code. */
export function noticesV2ImportViolations(file: string, source: string): string[] {
  const out = importsOf(parseSource(file, source)).flatMap(({ specifier }) => {
    const target = resolveRelative(file, specifier);
    if (target === undefined || target.startsWith(V2_ROOT)) return [];
    if (RELEASED_ONLY.includes(target)) return [`${file} → ${target}`];
    const flow = /^src\/notices\/([^/]+)\//.exec(target)?.[1];
    if (flow === undefined || SHARED_FLOWS.includes(flow) || flow === "v2") return [];
    const allowed = file.endsWith(".spec.ts") ? SPEC_ROLES : ALLOWED_ROLES;
    return allowed.has(roleOf(target)) ? [] : [`${file} → ${target}`];
  });
  return [...new Set(out)];
}

describe("notices v2 import rule applies as specified", () => {
  const file = "src/notices/v2/list/notices-v2-list.service.ts";

  it("lets a v2 file import the root, its own folder, the shared flows and another flow's module, service and stored shapes", () => {
    // Arrange
    const source = [
      'import { NoticesListService } from "../../list/notices-list.service";',
      'import type { NoticeListRow } from "../../list/notices-list.document";',
      'import type { NoticePage } from "../../list/notices-list.types";',
      'import { NoticesDetailModule } from "../../detail/notices-detail.module";',
      'import { toSourceIds } from "../../notices.rules";',
      'import { noticeBrief } from "../../notices.wire";',
      'import { NoticesBlocksService } from "../../blocks/notices-blocks.service";',
      'import { toListV2 } from "./notices-v2-list.mapper";',
      'import { NoticesV2Module } from "../notices-v2.module";',
      'import { NoticesRateLimitMiddleware } from "../../../http/notices-rate-limit.middleware";',
    ].join("\n");

    // Act & Assert
    expect(noticesV2ImportViolations(file, source)).toEqual([]);
  });

  it("lets a spec name a released flow's repository, and no source file", () => {
    // Arrange
    const source = 'import type { NoticesListRepository } from "../../list/notices-list.repository";';

    // Act & Assert
    expect(noticesV2ImportViolations("src/notices/v2/list/notices-v2-list.service.spec.ts", source)).toEqual([]);
    expect(noticesV2ImportViolations(file, source)).toEqual([`${file} → src/notices/list/notices-list.repository`]);
  });

  it.each([
    ["a released wire", 'import type { NoticeList } from "../../list/notices-list.wire";', "src/notices/list/notices-list.wire"],
    ["a released mapper", 'import { toListItem } from "../../list/notices-list.mapper";', "src/notices/list/notices-list.mapper"],
    ["a released controller", 'import { NoticesDetailController } from "../../detail/notices-detail.controller";', "src/notices/detail/notices-detail.controller"],
    ["a released schema", 'import { sourceListRequest } from "../../list/notices-list.schema";', "src/notices/list/notices-list.schema"],
    ["a released rules file", 'import { selectRoleBadge } from "../../list/notices-list.rules";', "src/notices/list/notices-list.rules"],
    ["the overview flow", 'import { overviewData } from "../../overview/notices-overview.wire";', "src/notices/overview/notices-overview.wire"],
    ["the overview limiter", 'import { NoticesOverviewRateLimitMiddleware } from "../../../http/notices-overview-rate-limit.middleware";', "src/http/notices-overview-rate-limit.middleware"],
  ])("rejects %s", (_case, source, target) => {
    // Act & Assert
    expect(noticesV2ImportViolations(file, source)).toEqual([`${file} → ${target}`]);
  });
});

describe("src/notices/v2/", () => {
  it("imports no released-route wire, controller, mapper, schema, rules, query or constants file", () => {
    // Arrange
    const files = filesUnder("src/notices/v2").filter((f) => f.endsWith(".ts"));

    // Act
    const violations = files.flatMap((f) => noticesV2ImportViolations(f, readSource(f)));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

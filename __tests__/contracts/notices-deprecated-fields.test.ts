/**
 * What the notices wires keep only for released app versions is published as deprecated (umbrella ADR 0012, D8), so a
 * client generated from contracts/produced/ learns what to move off: the detail's and the list item's `summary`, and the
 * whole `GET /notices/overview` answer. Each flag survives the draft-07 export the artifacts use and the committed
 * artifact carries it, the field stays required so the released app keeps receiving it, and no field the next
 * version reads is flagged: `views` is kept, so it is not. The list's `type` query parameter has no wire schema, so
 * it is not in the artifacts; docs/reference/notices-api.md deprecates it.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { noticeDetail } from "../../src/notices/detail/notices-detail.wire";
import { noticeList } from "../../src/notices/list/notices-list.wire";
import { overviewData, overviewMeta } from "../../src/notices/overview/notices-overview.wire";

type JsonSchema = { properties?: Record<string, JsonSchema>; items?: JsonSchema; required?: string[]; deprecated?: boolean; description?: string };

const PRODUCED = path.join(__dirname, "../../contracts/produced");
const committed = (id: string): JsonSchema => JSON.parse(fs.readFileSync(path.join(PRODUCED, `${id}.schema.json`), "utf8")) as JsonSchema;
const exported = (schema: z.ZodType): JsonSchema => z.toJSONSchema(schema, { io: "input", target: "draft-7" }) as unknown as JsonSchema;
const detailOf = (schema: JsonSchema): JsonSchema => schema;
const itemOf = (schema: JsonSchema): JsonSchema => schema.properties!.notices!.items!;

const SOURCES: Array<[string, () => JsonSchema, (schema: JsonSchema) => JsonSchema]> = [
  ["the detail in the export", () => exported(noticeDetail), detailOf],
  ["the detail in the committed artifact", () => committed("notices-detail.noticeDetail"), detailOf],
  ["a list item in the export", () => exported(noticeList), itemOf],
  ["a list item in the committed artifact", () => committed("notices-list.noticeList"), itemOf],
];

describe.each(SOURCES)("%s", (_case, read, objectOf) => {
  it("deprecates summary, pointing at the forced update, and keeps it required", () => {
    // Act
    const object = objectOf(read());

    // Assert
    expect(object.properties?.summary).toMatchObject({ deprecated: true });
    expect(object.properties?.summary?.description).toContain("removed at the forced update");
    expect(object.required).toContain("summary");
  });

  it("keeps views, required and not deprecated", () => {
    // Act
    const object = objectOf(read());

    // Assert
    expect(object.properties?.views?.deprecated).toBeUndefined();
    expect(object.properties?.views?.description).toBeUndefined();
    expect(object.required).toContain("views");
  });

  it("deprecates no other field", () => {
    // Act
    const object = objectOf(read());

    // Assert
    const flagged = Object.entries(object.properties ?? {}).filter(([, property]) => property.deprecated === true).map(([name]) => name);
    expect(flagged).toEqual(["summary"]);
  });
});

describe.each([
  ["overviewData", overviewData, "notices-overview.overviewData"],
  ["overviewMeta", overviewMeta, "notices-overview.overviewMeta"],
] as const)("%s", (_name, schema, id) => {
  it("is deprecated as a whole in the export and in the committed artifact", () => {
    // Act
    const [fromWire, fromArtifact] = [exported(schema), committed(id)];

    // Assert
    for (const read of [fromWire, fromArtifact]) {
      expect(read).toMatchObject({ deprecated: true });
      expect(read.description).toContain("removed at the forced update");
    }
  });
});

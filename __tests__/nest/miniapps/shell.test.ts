/**
 * Unit tests for the tolerant shell-config parser copied from
 * `packages/miniapp/src/protocol/manifest.ts` in skkuverse-miniapp (see
 * `src/miniapps/shell.ts`'s header for why it is a copy rather than an
 * import). These vectors mirror the `manifest` describe block in that
 * package's `test/protocol.test.ts`, adapted to this file's narrower surface
 * (no `parseShellPatch`/`shell.set` — the server only ever reads a whole
 * manifest, never a runtime patch).
 */
import {
  DEFAULT_SHELL,
  mergeShell,
  parseManifest,
  parseShellFields,
  type ShellConfig,
} from "../../../src/miniapps/shell";

describe("parseManifest", () => {
  it("fills every field from DEFAULT_SHELL when there is nothing to read", () => {
    expect(parseManifest(null)).toEqual({ shell: DEFAULT_SHELL });
    expect(parseManifest(undefined)).toEqual({ shell: DEFAULT_SHELL });
    expect(parseManifest("not an object")).toEqual({ shell: DEFAULT_SHELL });
    expect(parseManifest({})).toEqual({ shell: DEFAULT_SHELL });
  });

  it("keeps valid fields and drops invalid ones, upper-casing a valid hex background", () => {
    expect(
      parseManifest({
        shell: { bar: "top", header: "sideways", statusBar: "light", background: "#0a0b0c", x: 1 },
      }),
    ).toEqual({ shell: { ...DEFAULT_SHELL, bar: "top", statusBar: "light", background: "#0A0B0C" } });
  });
});

describe("parseShellFields", () => {
  it("returns {} for anything that is not a plain object", () => {
    for (const value of [null, undefined, "x", 1, true, [], ["bar", "top"]]) {
      expect(parseShellFields(value)).toEqual({});
    }
  });

  it.each([
    ["top"],
    ["bottom"],
    ["none"],
  ])("accepts bar %j", (bar) => {
    expect(parseShellFields({ bar })).toEqual({ bar });
  });

  it.each([["hide"], ["TOP"], [1], [null]])("drops an invalid bar %j", (bar) => {
    expect(parseShellFields({ bar })).toEqual({});
  });

  it.each([["opaque"], ["overlay"]])("accepts header %j", (header) => {
    expect(parseShellFields({ header })).toEqual({ header });
  });

  it.each([["sideways"], ["OPAQUE"], [1], [null]])("drops an invalid header %j", (header) => {
    expect(parseShellFields({ header })).toEqual({});
  });

  it.each([["dark"], ["light"]])("accepts statusBar %j", (statusBar) => {
    expect(parseShellFields({ statusBar })).toEqual({ statusBar });
  });

  it.each([["gray"], ["DARK"], [1], [null]])("drops an invalid statusBar %j", (statusBar) => {
    expect(parseShellFields({ statusBar })).toEqual({});
  });

  it("accepts a lowercase hex background and upper-cases it", () => {
    expect(parseShellFields({ background: "#0a0b0c" })).toEqual({ background: "#0A0B0C" });
  });

  it.each([["#FFF"], ["FFFFFF"], ["#GGGGGG"], [123456], [null]])(
    "drops an invalid background %j",
    (background) => {
      expect(parseShellFields({ background })).toEqual({});
    },
  );

  it("keeps only the four known keys, dropping everything else", () => {
    expect(
      parseShellFields({ bar: "top", extra: "nope", another: 1 }),
    ).toEqual({ bar: "top" });
  });

  it("reads every field at once", () => {
    expect(
      parseShellFields({ bar: "none", header: "overlay", statusBar: "light", background: "#112233" }),
    ).toEqual({ bar: "none", header: "overlay", statusBar: "light", background: "#112233" });
  });
});

describe("mergeShell", () => {
  it("replaces only the fields `over` sets", () => {
    const base: ShellConfig = DEFAULT_SHELL;
    expect(mergeShell(base, { bar: "top" })).toEqual({ ...DEFAULT_SHELL, bar: "top" });
  });

  it("with {} returns the base unchanged", () => {
    expect(mergeShell(DEFAULT_SHELL, {})).toEqual(DEFAULT_SHELL);
  });

  it("composes: default < registry < manifest, three-tier precedence", () => {
    const registryFields = { bar: "top" as const };
    const manifestFields = { bar: "none" as const, background: "#000000" };
    const merged = mergeShell(mergeShell(DEFAULT_SHELL, registryFields), manifestFields);
    // manifest wins where both set a field...
    expect(merged.bar).toBe("none");
    expect(merged.background).toBe("#000000");
    // ...and registry/default still supply what manifest and registry leave unset.
    expect(merged.header).toBe(DEFAULT_SHELL.header);
    expect(merged.statusBar).toBe(DEFAULT_SHELL.statusBar);
  });

  it("registry wins over default when manifest sets nothing", () => {
    const registryFields = { bar: "top" as const };
    const merged = mergeShell(mergeShell(DEFAULT_SHELL, registryFields), {});
    expect(merged).toEqual({ ...DEFAULT_SHELL, bar: "top" });
  });
});

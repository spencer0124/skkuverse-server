/**
 * The shell a miniapp asks the app to draw around it.
 *
 * Ported from `packages/miniapp/src/protocol/manifest.ts` in the
 * `skkuverse-miniapp` repo (the `@skkuverse/miniapp` SDK, `/protocol`
 * subpath) — that package is ESM-only (`"type": "module"`, no `require`
 * export condition) and this server compiles as CommonJS, so a normal
 * `require()`/`import` of it fails at load time rather than merely at
 * typecheck time. Rather than loosen the server's module settings for one
 * dependency, the tolerant parsing logic this file needs is copied here.
 * Keep the two in step by hand: a field added there needs the matching field
 * added here, and the vectors in `__tests__/nest/miniapps/shell.test.ts`
 * mirror `packages/miniapp/test/protocol.test.ts`'s `manifest` block.
 *
 * A first-party miniapp declares this shape at `public/skkuverse.json`,
 * served from its own origin. `miniapps.manifest.ts` fetches that file and
 * merges it into the registry's `GET /miniapps/:id`, so the app knows the
 * shell before it creates the WebView and the first frame is already right.
 *
 * Parsing is tolerant everywhere: an unknown key or a bad value is dropped and
 * the default takes its place. A miniapp with a broken manifest still opens.
 */

export type ShellBar = "top" | "bottom" | "none";
export type ShellHeader = "opaque" | "overlay";
export type ShellStatusBar = "dark" | "light";

export interface ShellConfig {
  /**
   * Where the app draws the miniapp's name pill.
   * - `top`: in the header, beside the back button.
   * - `bottom`: a floating bar at the bottom with back/forward buttons.
   * - `none`: nowhere. The header keeps only back and more.
   */
  bar: ShellBar;
  /**
   * - `opaque`: the header is a solid band and the page starts below it.
   * - `overlay`: the page starts at the top of the screen, under the status
   *   bar and a transparent header.
   */
  header: ShellHeader;
  /** Status bar icon colour: `dark` icons for a light page, `light` for a dark one. */
  statusBar: ShellStatusBar;
  /** `#RRGGBB` painted behind the WebView: while loading, and on overscroll. */
  background: string;
}

/** A whole manifest from untrusted JSON. Only the part this server reads. */
export interface Manifest {
  shell: ShellConfig;
}

export const DEFAULT_SHELL: Readonly<ShellConfig> = Object.freeze({
  bar: "bottom",
  header: "opaque",
  statusBar: "dark",
  background: "#FFFFFF",
});

/** Where a miniapp serves its manifest, relative to its origin. */
export const MANIFEST_PATH = "/skkuverse.json";

const BARS: ReadonlySet<string> = new Set<ShellBar>(["top", "bottom", "none"]);
const HEADERS: ReadonlySet<string> = new Set<ShellHeader>(["opaque", "overlay"]);
const STATUS_BARS: ReadonlySet<string> = new Set<ShellStatusBar>(["dark", "light"]);
const HEX = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | undefined {
  return typeof value === "string" && allowed.has(value) ? (value as T) : undefined;
}

/**
 * The valid fields of an untrusted shell object, and nothing else. The result
 * may be empty; merge it over a base with `mergeShell`.
 */
export function parseShellFields(value: unknown): Partial<ShellConfig> {
  if (!isRecord(value)) return {};
  const out: Partial<ShellConfig> = {};
  const bar = pick<ShellBar>(value.bar, BARS);
  if (bar) out.bar = bar;
  const header = pick<ShellHeader>(value.header, HEADERS);
  if (header) out.header = header;
  const statusBar = pick<ShellStatusBar>(value.statusBar, STATUS_BARS);
  if (statusBar) out.statusBar = statusBar;
  if (typeof value.background === "string" && HEX.test(value.background)) {
    out.background = value.background.toUpperCase();
  }
  return out;
}

/** `base` with every field `over` sets replacing it. */
export function mergeShell(base: ShellConfig, over: Partial<ShellConfig>): ShellConfig {
  return { ...base, ...over };
}

/** A whole manifest from untrusted JSON. Never throws; falls back to defaults. */
export function parseManifest(value: unknown): Manifest {
  const shell = isRecord(value) ? parseShellFields(value.shell) : {};
  return { shell: mergeShell(DEFAULT_SHELL, shell) };
}

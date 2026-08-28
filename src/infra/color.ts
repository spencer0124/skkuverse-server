/**
 * Bare six-digit hex — `F04452`, never `#F04452` — the form the app's
 * `toCssColor` prepends the `#` to. One rule with two authors: the bus overlay
 * colours in `src/bus/registry/jongro-registry.ts` and the festival layer
 * colours in a layer set's config. Kept here so a change to what the app
 * accepts is made once.
 */
const HEX6_RE = /^[0-9A-Fa-f]{6}$/;

export function isHex6(s: unknown): boolean {
  return typeof s === "string" && HEX6_RE.test(s);
}

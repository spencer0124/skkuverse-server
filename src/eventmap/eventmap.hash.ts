import crypto from "crypto";

/**
 * Deterministic serialization + md5, shared by the two event map hashes
 * (skkuverse#14). Contract: docs/reference/eventmap-api.md §6.5.
 *
 * This lives in its OWN module, not in eventmap.config.ts, so that
 * eventmap.materialize.ts can stay genuinely pure. The config module reads the
 * filesystem in its module body; importing it from the materializer would make
 * "no DB, no clock" true only in the narrow sense while a disk read happened at
 * import — and would couple every materializer unit test to a config file
 * loading successfully.
 */

/**
 * Object keys sorted at every depth, Dates as ISO, undefined dropped. Array
 * order is PRESERVED: it is meaningful (layer draw order, chip display order)
 * and both hashes must react to it.
 *
 * Sorting is what lets two api replicas agree byte-for-byte. BSON field order
 * survives a round trip, but not necessarily identically on both replicas after
 * an ops edit adds or moves a field.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`)
    .join(",")}}`;
}

export function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

import crypto from "crypto";

/**
 * Constant-time shared-secret comparison for the /internal/* routes.
 *
 * Extracted verbatim from notices.internal.controller.ts when the event map
 * gained a second internal route (skkuverse#14). Two copies of a timing-safe
 * comparison is two things to get subtly wrong: the length pre-check exists
 * because timingSafeEqual THROWS on unequal buffer lengths rather than
 * returning false, and the typeof guard exists because a missing header is
 * undefined, not a string.
 *
 * Callers are responsible for the 401 — this returns a boolean and nothing else,
 * so it stays usable from anywhere without importing the HTTP layer.
 */
export function tokensMatch(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

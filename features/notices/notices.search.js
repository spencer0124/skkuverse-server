/**
 * Notice search helpers — pure functions, no DB.
 *
 * Two responsibilities:
 *   - escapeRegex: turn user input into a literal pattern so regex
 *     metacharacters don't broaden matches or cause ReDoS-style
 *     pathological backtracking. The matched chars are the standard
 *     ECMAScript regex metacharacters; backslash is escaped last so the
 *     replacement output stays unambiguous.
 *   - validateQ: normalize a value from req.query.q into either a
 *     trimmed search string or null. The route layer treats null as
 *     "no search clause" — the function NEVER throws, so the route can
 *     compose the query unconditionally with `if (q)`.
 *
 * Length is measured in Unicode codepoints (`[...str].length`), not UTF-16
 * code units (`str.length`). A naive `.length` cap allows e.g. 50 emoji
 * (each is two code units) and rejects 100 ASCII chars at the same
 * threshold — confusing for users in CJK / emoji-heavy queries.
 */

const MAX_QUERY_CODEPOINTS = 100;

const REGEX_METACHARS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s) {
  return s.replace(REGEX_METACHARS, "\\$&");
}

function hasControlChar(s) {
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i);
    if (cp < 32 || cp === 127) return true;
  }
  return false;
}

function validateQ(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (hasControlChar(trimmed)) return null;
  // Codepoint count — handles surrogate pairs correctly.
  if ([...trimmed].length > MAX_QUERY_CODEPOINTS) return null;
  return trimmed;
}

module.exports = {
  escapeRegex,
  validateQ,
  MAX_QUERY_CODEPOINTS,
};

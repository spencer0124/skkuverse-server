// EVIDENCE: RFC 5545 section 3.1: a content line is at most 75 octets before a fold.
const MAX_LINE_OCTETS = 75;

function toFoldedLine(line: string): string {
  const parts = [""];
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (octets + size > MAX_LINE_OCTETS - (parts.length > 1 ? 1 : 0)) {
      parts.push("");
      octets = 0;
    }
    parts[parts.length - 1] += char;
    octets += size;
  }
  return parts.join("\r\n ");
}

/** WHY: RFC 5545 section 3.1: each content line ends in CRLF, and a longer one folds onto lines that open with a space. */
export function toICalendarText(lines: readonly string[]): string {
  return `${lines.map(toFoldedLine).join("\r\n")}\r\n`;
}

/** WHY: RFC 5545 section 3.3.11: a TEXT value escapes its backslashes, semicolons, commas and line breaks. */
export function toEscapedText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function toUtcStamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

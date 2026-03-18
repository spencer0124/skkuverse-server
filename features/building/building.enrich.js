const { toDisplayNo } = require("./building.data");

// Bump this when enrichment logic changes to trigger re-enrichment of all buildings
const ENRICH_VERSION = 1;

// --- Elevator status enum mapping ---

const ELEVATOR_STATUS_MAP = {
  "층에 설 때만 음성 안내": "arrival",
  "층에 설 때, 버튼 누를 때 음성 안내": "arrival_button",
  "음성 안내 없음": "none",
  "운영X": "not_operating",
};

// --- Regex patterns ---

// Matches the start of a BF block in description text.
// Handles: "* 배리어프리", "*배리어프리", "*학생회관\n배리어프리"
const BF_START_RE = /\n\n\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내/;

// Matches section headers within BF text, with optional label like (A동)
const BF_SECTION_RE =
  /\*\s*(?:[^\n]*\n)?배리어프리 편의시설 안내(?:\(([^)]+)\))?/g;

// --- Section field parsers ---

function parseRamp(text) {
  const m = text.match(/경사로\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1].trim();
  const available = !raw.toUpperCase().startsWith("X");
  const noteMatch = raw.match(/\((.+)\)/);
  return { available, note: noteMatch ? noteMatch[1] : null };
}

function parseToilet(text) {
  // Handle typo "승장애인" prefix (_id:2 has it on elevator, but be safe)
  const m = text.match(/장애인 화장실\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1].trim();
  const countMatch = raw.match(/총\s*(\d+)\s*개/);
  return { raw, count: countMatch ? parseInt(countMatch[1], 10) : null };
}

function parseElevator(text) {
  // Handle typo "승장애인 표시 승강기" (_id:2)
  const m = text.match(/(?:승)?장애인 표시 승강기\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1].trim();
  // "N대 중 M대" pattern (standard)
  const fullMatch = raw.match(/(\d+)\s*대\s*중\s*(\d+)\s*대/);
  if (fullMatch) {
    return {
      raw,
      total: parseInt(fullMatch[1], 10),
      accessible: parseInt(fullMatch[2], 10),
    };
  }
  // "N대" alone — accessible count only, total unknown
  const singleMatch = raw.match(/(\d+)\s*대/);
  if (singleMatch) {
    return { raw, total: null, accessible: parseInt(singleMatch[1], 10) };
  }
  return { raw, total: null, accessible: null };
}

function parseElevatorStatus(text) {
  const m = text.match(/승강기 기능 상태\s*[:：]\s*(.+)/);
  if (!m) return null;
  const raw = m[1].trim();
  return ELEVATOR_STATUS_MAP[raw] || raw;
}

function parseParking(text) {
  const m = text.match(/장애인 주차장\s*[:：]\s*(.+)/);
  if (!m) return null;
  const num = m[1].trim().match(/(\d+)/);
  return num ? parseInt(num[1], 10) : null;
}

function parseSection(text) {
  return {
    ramp: parseRamp(text),
    toilet: parseToilet(text),
    elevator: parseElevator(text),
    elevatorStatus: parseElevatorStatus(text),
    parking: parseParking(text),
  };
}

// --- Main parser ---

/**
 * Parse barrier-free accessibility info from building description.
 * @param {string} descriptionKo - Korean description text
 * @returns {null | { cleanDescription: string, detail: object }}
 *   - null: no BF text found
 *   - { cleanDescription, detail: { sections: [...] } }: parsed successfully
 *   - { cleanDescription: original, detail: { sections: [], parseError } }: BF detected but parse failed
 */
function parseBarrierFree(descriptionKo) {
  if (!descriptionKo) return null;

  // Normalize line endings
  const text = descriptionKo.replace(/\r\n/g, "\n");

  // Find BF block start
  const startMatch = text.match(BF_START_RE);
  if (!startMatch) return null;

  const cleanDescription = text.slice(0, startMatch.index).trim();
  const bfText = text.slice(startMatch.index);

  // Find all section headers within BF text
  const headers = [];
  let m;
  const re = new RegExp(BF_SECTION_RE.source, "g");
  while ((m = re.exec(bfText)) !== null) {
    headers.push({
      label: m[1] || null,
      index: m.index,
      endIndex: m.index + m[0].length,
    });
  }

  if (headers.length === 0) {
    return {
      cleanDescription: text,
      detail: {
        sections: [],
        parseError: "BF block detected but no section headers parsed",
      },
    };
  }

  const sections = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].endIndex;
    const end =
      i + 1 < headers.length ? headers[i + 1].index : bfText.length;
    const sectionText = bfText.slice(start, end);
    sections.push({ label: headers[i].label, ...parseSection(sectionText) });
  }

  return { cleanDescription, detail: { sections } };
}

// --- Enrichment pipeline ---

/**
 * Derive enriched fields from a raw building document.
 * Pure function — no side effects, no DB calls.
 * @param {object} rawDoc - Document from buildings_raw
 * @returns {object} Fields to $set on the enriched buildings collection
 */
function enrichBuilding(rawDoc) {
  const parsed = parseBarrierFree(rawDoc.description?.ko);

  const descriptionKo = parsed ? parsed.cleanDescription : (rawDoc.description?.ko || "");
  const accessibilityDetail = parsed ? parsed.detail : null;

  return {
    buildNo: rawDoc.buildNo,
    displayNo: toDisplayNo(rawDoc.buildNo, rawDoc.campus),
    type: rawDoc.buildNo ? "building" : "facility",
    campus: rawDoc.campus,
    "name.ko": rawDoc.name?.ko || "",
    "name.en": rawDoc.name?.en || "",
    "description.ko": descriptionKo,
    "description.en": rawDoc.description?.en || "",
    "location": rawDoc.location,
    "image": rawDoc.image,
    attachments: rawDoc.attachments || [],
    "accessibility.elevator": rawDoc.accessibility?.elevator || false,
    "accessibility.toilet": rawDoc.accessibility?.toilet || false,
    "accessibility.detail": accessibilityDetail,
    enrichVersion: ENRICH_VERSION,
    skkuCreatedAt: rawDoc.skkuCreatedAt,
    skkuUpdatedAt: rawDoc.skkuUpdatedAt,
  };
}

module.exports = {
  ENRICH_VERSION,
  ELEVATOR_STATUS_MAP,
  parseBarrierFree,
  enrichBuilding,
};

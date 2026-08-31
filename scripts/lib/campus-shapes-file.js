"use strict";

/**
 * The authoring reader for permanent campus geometry — footprints, the campus
 * boundary, walking paths.
 *
 * Pure: text in, documents out. No Mongo, no clock beyond `updatedAt`, so the
 * whole thing is testable without a database — the same shape as
 * `map-places-file.js`, and it shares that file's geometry reader so the two
 * sheets cannot disagree about what a valid ring is.
 *
 * Accumulates every error rather than throwing at the first, and names the
 * exact path, because the only reader of the message is whoever is holding the
 * sheet.
 *
 * There is no category table here, unlike the event sheet. `presentationFor`
 * exists so ops can invent a category mid-festival; permanent geometry has no
 * such need, and the layers it targets are repo TypeScript either way — so a
 * shape names its `layerId` directly.
 */

const { asGeometry } = require("./geojson-geometry");

const CAMPUSES = ["hssc", "nsc"];

function asI18n(value, where, errors) {
  if (typeof value === "string") {
    if (value.trim() === "") {
      errors.push(`${where} must not be blank`);
      return null;
    }
    // A bare string is Korean. English falls back to it rather than being
    // absent, so a consumer never has to.
    return { ko: value, en: value };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${where} must be a string or an object with ko/en`);
    return null;
  }
  if (typeof value.ko !== "string" || value.ko.trim() === "") {
    errors.push(`${where}.ko must be a non-empty string`);
    return null;
  }
  return {
    ko: value.ko,
    en: typeof value.en === "string" && value.en.trim() !== "" ? value.en : value.ko,
  };
}

function asShape(raw, i, errors) {
  // Anything this shape contributes lands here first, so a shape with ANY
  // problem is excluded whole and the importer's "N valid, M rejected" line
  // counts rows rather than messages.
  const own = [];
  const where = `shapes[${i}]`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    errors.push(`${where}.id must be a non-empty string`);
    return null;
  }
  const where2 = `shapes[${i}] ("${raw.id}")`;

  if (!CAMPUSES.includes(raw.campus)) {
    own.push(`${where2}.campus must be one of [${CAMPUSES.join(", ")}]`);
  }
  if (typeof raw.layerId !== "string" || raw.layerId.trim() === "") {
    own.push(`${where2}.layerId must be a non-empty string`);
  }
  if (typeof raw.order !== "number" || !Number.isFinite(raw.order)) {
    // No default. A silent 0 would make the draw order arbitrary while looking
    // deliberate.
    own.push(`${where2}.order must be a finite number`);
  }
  // `null` is meaningful: geometry that is not a building — a boundary, a lawn,
  // a path — and it becomes `tap: null` on the wire. Absent is not the same as
  // null here, because forgetting the field should not silently make a
  // footprint inert.
  if (raw.skkuId !== null && (typeof raw.skkuId !== "number" || !Number.isInteger(raw.skkuId))) {
    own.push(`${where2}.skkuId must be an integer, or null for geometry with no building`);
  }

  const geometry = asGeometry(raw.geometry, `${where2}.geometry`, own);
  const title = asI18n(raw.title, `${where2}.title`, own);
  const subtitle =
    raw.subtitle === undefined || raw.subtitle === null
      ? null
      : asI18n(raw.subtitle, `${where2}.subtitle`, own);

  errors.push(...own);
  if (own.length > 0 || !geometry || !title) return null;

  return {
    _id: raw.id,
    campus: raw.campus,
    layerId: raw.layerId,
    geometry,
    title,
    subtitle,
    skkuId: raw.skkuId,
    order: raw.order,
    updatedAt: new Date(),
  };
}

/**
 * @param {string} text the file's contents
 * @returns {{docs: object[], errors: string[]}}
 */
function parseCampusShapesFile(text) {
  const errors = [];
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    return { docs: [], errors: [`file is not valid JSON: ${err.message}`] };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { docs: [], errors: ["file must be a JSON object"] };
  }
  if (!Array.isArray(root.shapes)) {
    return { docs: [], errors: ["shapes must be an array"] };
  }

  const docs = [];
  const seen = new Set();
  root.shapes.forEach((raw, i) => {
    const doc = asShape(raw, i, errors);
    if (!doc) return;
    // A duplicate id would silently overwrite its twin on upsert, leaving one
    // shape missing with the import reporting success.
    if (seen.has(doc._id)) {
      errors.push(`shapes[${i}] ("${doc._id}") duplicates an earlier id`);
      return;
    }
    seen.add(doc._id);
    docs.push(doc);
  });

  return { docs, errors };
}

module.exports = { parseCampusShapesFile };

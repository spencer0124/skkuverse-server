/**
 * scripts/lib/eventmap-csv.js — the ops coordinate sheet reader.
 *
 * This is the only part of Phase 1 with real logic, and every case below is a
 * way the sheet has actually been (or can trivially be) wrong. The expected
 * values were taken from a live probe of csv-parse@7.0.2 against the committed
 * CSV, not assumed.
 *
 * The module is pure — no DB, no clock — which is why it can be required
 * directly. Both executable scripts keep main() behind require.main === module.
 */
import fs from "fs";
import path from "path";

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const { parsePlacesCsv, EXPECTED_COLUMNS } = require("../../../scripts/lib/eventmap-csv");

const HEADER = "placeId,campus,name_ko,zone,lat,lng,note_ko\n";
const OPTS = { layerSetId: "test-set" };

const REAL_CSV = path.join(
  __dirname,
  "../../../scripts/data/eskara-2026-places.csv",
);

function firstError(csv: string): string {
  const { errors } = parsePlacesCsv(csv, OPTS);
  expect(errors.length).toBeGreaterThan(0);
  return errors[0].message;
}

describe("parsePlacesCsv — the committed ops sheet", () => {
  it("round-trips all 62 surveyed places with zero rejections", () => {
    const { docs, errors } = parsePlacesCsv(fs.readFileSync(REAL_CSV, "utf8"), {
      layerSetId: "eskara-2026",
    });

    expect(errors).toEqual([]);
    expect(docs).toHaveLength(62);
  });

  it("stores coordinates as GeoJSON [lng, lat], not [lat, lng]", () => {
    const { docs } = parsePlacesCsv(fs.readFileSync(REAL_CSV, "utf8"), {
      layerSetId: "eskara-2026",
    });
    const stage = docs.find((d: { _id: string }) => d._id === "nsc-main-stage");

    // Seoul is ~37 N, ~127 E. If these ever swap, the pin lands in the ocean
    // and nothing else in the pipeline notices.
    expect(stage.location).toEqual({
      type: "Point",
      coordinates: [126.971747, 37.294452],
    });
  });

  it("accepts a blank zone rather than rejecting the row", () => {
    // nsc-barrierfree genuinely has no zone yet — an unsurveyed zone is not a
    // broken row, and treating it as one would drop a real place.
    const { docs } = parsePlacesCsv(fs.readFileSync(REAL_CSV, "utf8"), {
      layerSetId: "eskara-2026",
    });
    const bf = docs.find((d: { _id: string }) => d._id === "nsc-barrierfree");

    expect(bf.zone).toBeNull();
  });

  it("moves the ops note into extensions instead of a wire field", () => {
    const { docs } = parsePlacesCsv(HEADER + "x,nsc,X,Z,37.2,126.9,범례 1\n", OPTS);

    expect(docs[0].extensions).toEqual({ noteKo: "범례 1" });
  });

  it("omits extensions entirely when there is no note", () => {
    const { docs } = parsePlacesCsv(HEADER + "x,nsc,X,Z,37.2,126.9,\n", OPTS);

    expect(docs[0]).not.toHaveProperty("extensions");
  });
});

describe("parsePlacesCsv — RFC 4180 handling", () => {
  it("keeps a comma that lives inside a quoted field", () => {
    // Five committed rows look like this. split(",") would shred every one.
    const { docs, errors } = parsePlacesCsv(
      `${HEADER}x,nsc,X,Z,37.2,126.9,"부추전, 김치전, 인자전"\n`,
      OPTS,
    );

    expect(errors).toEqual([]);
    expect(docs[0].extensions.noteKo).toBe("부추전, 김치전, 인자전");
  });

  it('collapses a doubled quote ("") to one literal quote', () => {
    // Not in today's data. Pinned now so the day ops types a quote mark is not
    // the day we find out what happens.
    const { docs, errors } = parsePlacesCsv(
      `${HEADER}x,nsc,X,Z,37.2,126.9,"a""b"\n`,
      OPTS,
    );

    expect(errors).toEqual([]);
    expect(docs[0].extensions.noteKo).toBe('a"b');
  });

  it("survives the UTF-8 BOM a spreadsheet export prepends", () => {
    // Without bom:true the first key parses as "U+FEFF then placeId" and all 62 rows
    // fail for a missing id — an encoding problem wearing a data problem's face.
    const { docs, errors } = parsePlacesCsv(
      `\uFEFF${HEADER}x,nsc,X,Z,37.2,126.9,n\n`,
      OPTS,
    );

    expect(errors).toEqual([]);
    expect(docs[0]._id).toBe("x");
  });

  it("reports a ragged row as one readable error, not a stack trace", () => {
    // csv-parse THROWS on this. If the throw escaped, the operator would get a
    // stack trace instead of a line number.
    const { docs, errors } = parsePlacesCsv(`${HEADER}x,nsc,X\n`, OPTS);

    expect(docs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toContain("CSV_RECORD_INCONSISTENT_COLUMNS");
  });
});

describe("parsePlacesCsv — coordinate rejection", () => {
  it('rejects a blank lat instead of storing Number("") === 0', () => {
    // The trap recorded in skkuverse#12: an isNaN-only guard admits "" as 0,
    // the pair becomes [0,0], and 2dsphere accepts it because the Gulf of
    // Guinea is a real location.
    const { docs } = parsePlacesCsv(`${HEADER}x,nsc,X,Z,,126.9,n\n`, OPTS);

    expect(docs).toEqual([]);
    expect(firstError(`${HEADER}x,nsc,X,Z,,126.9,n\n`)).toContain("lat is blank");
  });

  it('rejects a comma decimal rather than parseFloat-ing "37,29" into 37', () => {
    expect(firstError(`${HEADER}x,nsc,X,Z,"37,29",126.9,n\n`)).toContain(
      "not a plain decimal",
    );
  });

  it("rejects scientific and hex notation Number() would happily accept", () => {
    expect(firstError(`${HEADER}x,nsc,X,Z,3.729e1,126.9,n\n`)).toContain(
      "not a plain decimal",
    );
    expect(firstError(`${HEADER}x,nsc,X,Z,0x25,126.9,n\n`)).toContain(
      "not a plain decimal",
    );
  });

  it("catches a lat/lng swap through the range check", () => {
    // Both values are finite and both are plausible decimals — only the range
    // reveals that the columns were filled in the wrong order.
    expect(firstError(`${HEADER}x,nsc,X,Z,126.97,37.29,n\n`)).toContain(
      "lat and lng may be swapped",
    );
  });

  it("rejects an lng past ±180", () => {
    expect(firstError(`${HEADER}x,nsc,X,Z,37.2,200.5,n\n`)).toContain(
      "outside ±180",
    );
  });
});

describe("parsePlacesCsv — identity and shape", () => {
  it("rejects a campus outside the closed union", () => {
    expect(firstError(`${HEADER}x,seoul,X,Z,37.2,126.9,n\n`)).toContain(
      "campus must be one of [hssc, nsc]",
    );
  });

  it("rejects a duplicate placeId and names the line it collides with", () => {
    // _id is the human slug, so a duplicate would silently upsert one plot on
    // top of another and the sheet would still look 62 rows long.
    const csv = `${HEADER}x,nsc,X,Z,37.2,126.9,n\nx,nsc,Y,Z,37.3,126.8,n\n`;
    const { docs, errors } = parsePlacesCsv(csv, OPTS);

    expect(docs).toHaveLength(1);
    expect(errors[0].message).toContain("already used on line 2");
  });

  it("rejects a blank placeId or name", () => {
    expect(firstError(`${HEADER},nsc,X,Z,37.2,126.9,n\n`)).toContain(
      "placeId is blank",
    );
    expect(firstError(`${HEADER}x,nsc,,Z,37.2,126.9,n\n`)).toContain(
      "name_ko is blank",
    );
  });

  it("fails once on a changed header instead of once per row", () => {
    // A renamed column would otherwise produce 62 identical row errors, which
    // reads as "the data is broken" when the truth is "the sheet changed shape".
    const csv =
      "place_id,campus,name_ko,zone,lat,lng,note_ko\n" +
      "x,nsc,X,Z,37.2,126.9,n\ny,nsc,Y,Z,37.3,126.8,n\n";
    const { docs, errors } = parsePlacesCsv(csv, OPTS);

    expect(docs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].message).toContain("missing [placeId]");
    expect(errors[0].message).toContain("unexpected [place_id]");
  });

  it("exposes the expected column set so the sheet and the reader cannot drift", () => {
    expect(EXPECTED_COLUMNS).toEqual([
      "placeId",
      "campus",
      "name_ko",
      "zone",
      "lat",
      "lng",
      "note_ko",
    ]);
  });

  it("refuses to build documents without a layerSetId", () => {
    const { docs, errors } = parsePlacesCsv(`${HEADER}x,nsc,X,Z,37.2,126.9,n\n`, {});

    expect(docs).toEqual([]);
    expect(errors[0].message).toContain("layerSetId is required");
  });

  it("reports a header-only file rather than silently importing nothing", () => {
    expect(firstError(HEADER)).toContain("no rows");
  });
});

const { getAllBuildings } = require("../building/building.data");

// Fallback when DB is empty (original hardcoded markers)
const FALLBACK_MARKERS = [
  // ── HSSC (인사캠) ──
  { id: "hssc_1",  code: "1",  name: "수선관",       campus: "hssc", lat: 37.587361, lng: 126.994479 },
  { id: "hssc_2",  code: "2",  name: "양현재",       campus: "hssc", lat: 37.587441, lng: 126.990506 },
  { id: "hssc_4",  code: "4",  name: "법학관",       campus: "hssc", lat: 37.588636, lng: 126.993209 },
  { id: "hssc_7",  code: "7",  name: "호암관",       campus: "hssc", lat: 37.588353, lng: 126.994262 },
  { id: "hssc_8",  code: "8",  name: "수선관별관",    campus: "hssc", lat: 37.58752,  lng: 126.99322  },
  { id: "hssc_9",  code: "9",  name: "경영대학별관",  campus: "hssc", lat: 37.586819, lng: 126.995246 },
  { id: "hssc_31", code: "31", name: "퇴계인문관",    campus: "hssc", lat: 37.589184, lng: 126.991539 },
  { id: "hssc_32", code: "32", name: "다산경제관",    campus: "hssc", lat: 37.589053, lng: 126.992435 },
  { id: "hssc_33", code: "33", name: "경영대학",      campus: "hssc", lat: 37.588572, lng: 126.992666 },
  { id: "hssc_61", code: "61", name: "국제관",        campus: "hssc", lat: 37.587882, lng: 126.991079 },
  { id: "hssc_62", code: "62", name: "경영대학신관",  campus: "hssc", lat: 37.58816,  lng: 126.990868 },
  // ── NSC (자과캠) ──
  { id: "nsc_1",   code: "1",  name: "자연과학캠퍼스", campus: "nsc",  lat: 37.29358,  lng: 126.974942 },
];

function formatFallback(overlay) {
  if (overlay === "number") {
    return {
      markers: FALLBACK_MARKERS.map((m) => ({
        id: m.id,
        displayNo: m.code,
        campus: m.campus,
        lat: m.lat,
        lng: m.lng,
      })),
    };
  }
  // overlay === "label"
  return {
    markers: FALLBACK_MARKERS.map((m) => ({
      id: m.id,
      text: m.name,
      campus: m.campus,
      lat: m.lat,
      lng: m.lng,
    })),
  };
}

async function getCampusMarkers(overlay) {
  const buildings = await getAllBuildings();
  if (!buildings?.length) return formatFallback(overlay);

  if (overlay === "number") {
    return {
      markers: buildings
        .filter((b) => b.displayNo)
        .map((b) => ({
          skkuId: b._id,
          displayNo: b.displayNo,
          campus: b.campus,
          lat: b.location.coordinates[1],
          lng: b.location.coordinates[0],
        })),
    };
  }

  // overlay === "label"
  return {
    markers: buildings.map((b) => ({
      skkuId: b._id,
      text: b.name,
      campus: b.campus,
      lat: b.location.coordinates[1],
      lng: b.location.coordinates[0],
    })),
  };
}

module.exports = { getCampusMarkers, FALLBACK_MARKERS };

// TODO: eta 필드는 subtitle로 대체됨. Flutter 마이그레이션 완료 후 제거 예정.
const HSSCStations = [
  { sequence: 1, stationName: "농구장", subtitle: "Basketball Court (Shuttle Bus Stop)", stationNumber: null, eta: "Basketball Court (Shuttle Bus Stop)", isFirstStation: true, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 2, stationName: "학생회관", subtitle: "Student Center", stationNumber: null, eta: "Student Center", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 3, stationName: "정문", subtitle: "Main Gate of SKKU", stationNumber: null, eta: "Main Gate of SKKU", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 4, stationName: "올림픽기념국민생활관 [하차전용]", subtitle: "Olympic Hall [Drop-off Only]", stationNumber: null, eta: "Olympic Hall [Drop-off Only]", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 5, stationName: "혜화동우체국 [하차전용]", subtitle: "Hyehwa Postoffice [Drop-off Only]", stationNumber: null, eta: "Hyehwa Postoffice [Drop-off Only]", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 6, stationName: "혜화동로터리 [미정차]", subtitle: "Hyehwa Rotary [Non-stop]", stationNumber: null, eta: "Hyehwa Rotary [Non-stop]", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 7, stationName: "혜화역 1번출구", subtitle: "Hyehwa Station (Shuttle Bus Stop)", stationNumber: null, eta: "Hyehwa Station (Shuttle Bus Stop)", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [{ line: "4", color: "00A5DE" }] },
  { sequence: 8, stationName: "혜화동로터리 [미정차]", subtitle: "Hyehwa Rotary [Non-stop]", stationNumber: null, eta: "Hyehwa Rotary [Non-stop]", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 9, stationName: "성균관대입구사거리", subtitle: "SKKU Junction", stationNumber: null, eta: "SKKU Junction", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 10, stationName: "정문", subtitle: "Main Gate of SKKU", stationNumber: null, eta: "Main Gate of SKKU", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
  { sequence: 11, stationName: "600주년기념관", subtitle: "600th Anniversary Hall", stationNumber: null, eta: "600th Anniversary Hall", isFirstStation: false, isLastStation: true, isRotationStation: false, busType: "BusType.hsscBus", transferLines: [] },
];

module.exports = { HSSCStations };

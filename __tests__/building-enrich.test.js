const { parseBarrierFree, enrichBuilding, ENRICH_VERSION } = require("../features/building/building.enrich");

// --- Test fixtures: real descriptions from skkumap_dev.buildings ---

const DESC_600 = `건학 600주년을 기념하기 위해서 1999년 11월에 완공되었다. 총장실, 부총장실을 비롯한 대학본부가 자리잡고 있으며, 각종 행사를 위한 대규모 공연장인 새천년홀과 조병두국제홀이 있다. 이 밖에 패컬티식당과 은행골, SUBWAY와 도미노피자가 입점해 있고, 수시로 전시회를 개최하는 박물관과 동아시아 연구의 메카인 동아시아학술원이 위치하고 있다.

* 배리어프리 편의시설 안내
경사로 : X
장애인 화장실: B2~1,5,6, 총 5개 (B2 남, B1~1,5,6 여 )
승장애인 표시 승강기 : 3대 중 1대
승강기 기능 상태 : 층에 설 때만 음성 안내
장애인 주차장 : 4`;

const DESC_HOAM = "1969년 건립된 지상 12층 규모의 건물로 학부대학과 사범대학, 교육대학원이 사용한다. 강의공간 및 학군단, 교수 연구실이 위치해 있으며, 대학언론사무국과 성대방송국이 자리잡고 있다.\r\n\r\n*배리어프리 편의시설 안내\r\n경사로 : o\r\n장애인 화장실: 1F, 총 2개(남,여 각 1개)\r\n장애인 표시 승강기 : 2대 중 1대\r\n승강기 기능 상태 : 층에 설 때만 음성 안내\r\n장애인 주차장 : 1";

const DESC_STUDENT_HALL = `총학생회, 학생복지위원회 등 학생자치기구 사무실과 70여개에 이르는 동아리연합회 소속의 동아리방들이 자리잡고 있다. 아픈 교내 구성원들을 위한 건강센터와 휴게실도 마련되어 있다.

*학생회관
배리어프리 편의시설 안내
경사로 : o(1층 출입로는 평지)
장애인 화장실: 3층, 총 1개 (3층 남)
장애인 주차장 : 4`;

const DESC_DASAN = `시대를 앞선 탁월한 정치경제 사상가였던 다산(茶山) 정약용 선생의 정신과 업적을 기리기 위해 1993년에 건립되었다. 교수 및 대학원생들의 연구실, 학생회실 및 휴게실, Creative-Smart Zone, 학생 상담을 위한 카운슬링센터 및 인권센터 등이 위치하며, 한국어 및 외국어 강좌를 운영하는 성균어학원이 자리잡고 있다.

*배리어프리 편의시설 안내
경사로 : o
장애인 표시 승강기 : 2대 중 2대
승강기 기능 상태 : 층에 설 때, 버튼 누를 때 음성 안내`;

const DESC_RESEARCH2 = `제2종합연구동은 산학협력 및 세계적 수준의 연구결과 창출을 통한 글로벌 리딩대학으로의 도약을 위해 2006년에 준공된 복합연구공간이다. 총 3동의 건물로 구성되어 있다. 연구에 필요한 최신식 기기와 설비를 갖추고 있으며, 지하 1층, 지상 7층, 총 7층 규모로 구성되었다.

*배리어프리 편의시설 안내(A동)
경사로: o
장애인 화장실: 1,3,5,7F/총 8개(층별 남,여 각1개씩)
장애인 표시 승강기: 1대 중 1대
승강기 기능 상태: 층에 설 때만 음성 안내

*배리어프리 편의시설 안내(B,C동)
경사로: o
장애인 화장실: 1,3,5F/총 6개(층별 남,여 각1개씩)
장애인 표시 승강기: 1대 중 1대
승강기 기능 상태: 층에 설 때만 음성 안내`;

const DESC_DORM_NEW = `2008년 신축된 최신식 시설의 기숙사인 신관은 지상 15층, 지하 2층으로 구성되어 있으며, 피트니스센터, 세미나실,  소강당, 도미노피자 등의 편의시설이 완비되어 있다. 호실도 1인실부터 2인 1실, 4인 1실, 3인 3실, 4인 4실, 6인 3실 등 다양한 생활공간이 마련되어 학생들이 원하는 대로 선택할 수 있도록 배려했다.

*배리어프리 편의시설 안내(A동)
경사로: o
장애인 화장실: B1, 총 2개(남,여 각1개씩)
장애인 표시 승강기: 2대 중 1대
승강기 기능 상태: 층에 설 때, 버튼 누를 때 음성 안내

*배리어프리 편의시설 안내(B동)
경사로: o
장애인 화장실:  B1, 총 2개(남,여 각1개씩)
장애인 표시 승강기: 4대 중 1대
승강기 기능 상태: 층에 설 때, 버튼 누를 때 음성 안내`;

const DESC_LIBRARY = `조선 제9대 성종 6년(1475)에 국학의 문고로 건축되어 유생들의 학문연구를 뒷받침해온 우리나라 최초의 도서관인 존경각(尊經閣). 이를 모체로 하는 중앙학술정보관은 국내서 약 65만권, 국외서 약 40만권으로 120만권에 가까운 많은 도서를 소장하고 있으며, 디지털 콘텐츠를 기반으로 한 복합문화공간이자, 지능정보사회에 걸맞는 도서관으로 탈바꿈하고 있다.

*배리어프리 편의시설 안내
경사로 : X
장애인 화장실: 3,4층(5층 확인 불가)
장애인 표시 승강기 : 1대 중 1대
승강기 기능 상태 : 층에 설 때, 버튼 누를 때 음성 안내
장애인 주차장 : 1`;

const DESC_UTILITY = `2018년 9월에 준공된 유틸리티센터는 자연과학캠퍼스의 종합관리사무실과 학내 구성원들의 체력 증진을 위한 체력단련실 및 스쿼시 시설 등의 "1398피트니스센터"가 위치해 있는 최신식 건물이다.

*배리어프리 편의시설 안내
경사로: o
장애인 화장실: 1F, 총 2개 (남, 여 각 1개씩)
장애인 표시 승강기: 1대 중 1대
승강기 기능 상태: 운영X`;

const DESC_ENG21 = `1978년에 완공된 제1공학관은 21동부터 23동까지로 나뉘며 'ㄷ'자 형태로 구분되어 있다. 21동에는 정보통신/소프트웨어/공과대학행정실을 비롯한 행정실, CAD연구실 등 다양한 연구실과 스마트라운지, 스마트갤러리와 같은 시설을 갖추고 있다.

*배리어프리 편의시설 안내
경사로: o
장애인 표시 승강기:1대
승강기 기능 상태: 층에 설 때만 음성 안내`;

const DESC_NO_BF = "정문은 성균관대학교의 정문입니다.";

// --- parseBarrierFree tests ---

describe("parseBarrierFree", () => {
  test("returns null for description without BF text", () => {
    expect(parseBarrierFree(DESC_NO_BF)).toBeNull();
  });

  test("returns null for empty/null input", () => {
    expect(parseBarrierFree(null)).toBeNull();
    expect(parseBarrierFree("")).toBeNull();
  });

  test("standard 5-field building (600주년기념관)", () => {
    const result = parseBarrierFree(DESC_600);
    expect(result).not.toBeNull();
    expect(result.cleanDescription).toContain("동아시아학술원이 위치하고 있다.");
    expect(result.cleanDescription).not.toContain("배리어프리");
    expect(result.detail.sections).toHaveLength(1);

    const s = result.detail.sections[0];
    expect(s.label).toBeNull();
    expect(s.ramp).toEqual({ available: false, note: null });
    expect(s.toilet).toEqual({
      raw: "B2~1,5,6, 총 5개 (B2 남, B1~1,5,6 여 )",
      count: 5,
    });
    // Handles "승장애인" typo
    expect(s.elevator).toEqual({ raw: "3대 중 1대", total: 3, accessible: 1 });
    expect(s.elevatorStatus).toBe("arrival");
    expect(s.parking).toBe(4);
  });

  test("\\r\\n normalization (호암관)", () => {
    const result = parseBarrierFree(DESC_HOAM);
    expect(result).not.toBeNull();
    expect(result.cleanDescription).not.toContain("\r");
    expect(result.detail.sections).toHaveLength(1);

    const s = result.detail.sections[0];
    expect(s.ramp.available).toBe(true);
    expect(s.toilet.count).toBe(2);
    expect(s.elevator).toEqual({ raw: "2대 중 1대", total: 2, accessible: 1 });
    expect(s.parking).toBe(1);
  });

  test("variant header with building name (학생회관)", () => {
    const result = parseBarrierFree(DESC_STUDENT_HALL);
    expect(result).not.toBeNull();
    expect(result.cleanDescription).toContain("휴게실도 마련되어 있다.");
    expect(result.detail.sections).toHaveLength(1);

    const s = result.detail.sections[0];
    expect(s.ramp).toEqual({ available: true, note: "1층 출입로는 평지" });
    expect(s.toilet.count).toBe(1);
    expect(s.elevator).toBeNull(); // no elevator field
    expect(s.elevatorStatus).toBeNull();
    expect(s.parking).toBe(4);
  });

  test("missing fields — no toilet, no parking (다산경제관)", () => {
    const result = parseBarrierFree(DESC_DASAN);
    expect(result).not.toBeNull();
    const s = result.detail.sections[0];
    expect(s.ramp.available).toBe(true);
    expect(s.toilet).toBeNull();
    expect(s.elevator).toEqual({ raw: "2대 중 2대", total: 2, accessible: 2 });
    expect(s.elevatorStatus).toBe("arrival_button");
    expect(s.parking).toBeNull();
  });

  test("multi-section A동/B,C동 (제2종합연구동)", () => {
    const result = parseBarrierFree(DESC_RESEARCH2);
    expect(result).not.toBeNull();
    expect(result.cleanDescription).toContain("규모로 구성되었다.");
    expect(result.detail.sections).toHaveLength(2);

    const [sA, sBC] = result.detail.sections;
    expect(sA.label).toBe("A동");
    expect(sA.toilet.count).toBe(8);
    expect(sA.elevator).toEqual({ raw: "1대 중 1대", total: 1, accessible: 1 });

    expect(sBC.label).toBe("B,C동");
    expect(sBC.toilet.count).toBe(6);
    expect(sBC.elevator).toEqual({ raw: "1대 중 1대", total: 1, accessible: 1 });
  });

  test("multi-section A동/B동 (기숙사신관)", () => {
    const result = parseBarrierFree(DESC_DORM_NEW);
    expect(result).not.toBeNull();
    expect(result.detail.sections).toHaveLength(2);

    const [sA, sB] = result.detail.sections;
    expect(sA.label).toBe("A동");
    expect(sA.elevator).toEqual({ raw: "2대 중 1대", total: 2, accessible: 1 });
    expect(sA.elevatorStatus).toBe("arrival_button");

    expect(sB.label).toBe("B동");
    expect(sB.elevator).toEqual({ raw: "4대 중 1대", total: 4, accessible: 1 });
  });

  test("toilet without count (중앙학술정보관)", () => {
    const result = parseBarrierFree(DESC_LIBRARY);
    expect(result).not.toBeNull();
    const s = result.detail.sections[0];
    expect(s.toilet.raw).toBe("3,4층(5층 확인 불가)");
    expect(s.toilet.count).toBeNull();
    expect(s.elevatorStatus).toBe("arrival_button");
  });

  test("elevator status 운영X (유틸리티센터)", () => {
    const result = parseBarrierFree(DESC_UTILITY);
    expect(result).not.toBeNull();
    const s = result.detail.sections[0];
    expect(s.elevatorStatus).toBe("not_operating");
  });

  test("elevator single N대 without 중 pattern (제1공학관21동)", () => {
    const result = parseBarrierFree(DESC_ENG21);
    expect(result).not.toBeNull();
    const s = result.detail.sections[0];
    expect(s.elevator.raw).toBe("1대");
    expect(s.elevator.total).toBeNull();
    expect(s.elevator.accessible).toBe(1);
    expect(s.toilet).toBeNull(); // no toilet field
  });

  test("no parseError on successful parse", () => {
    const result = parseBarrierFree(DESC_600);
    expect(result.detail.parseError).toBeUndefined();
  });
});

// --- enrichBuilding tests ---

describe("enrichBuilding", () => {
  test("produces correct enriched fields from raw doc", () => {
    const rawDoc = {
      _id: 2,
      buildNo: "10302",
      campus: "hssc",
      name: { ko: "600주년기념관", en: "600th Anniversary Hall" },
      description: { ko: DESC_600, en: "English description" },
      location: { type: "Point", coordinates: [126.99, 37.58] },
      image: { url: "https://example.com/img.jpg", filename: "img.jpg" },
      attachments: [{ id: 1, url: "https://example.com/a.jpg", filename: "a.jpg", alt: "" }],
      accessibility: { elevator: true, toilet: true },
      skkuCreatedAt: "2024-01-01",
      skkuUpdatedAt: "2025-01-01",
    };

    const result = enrichBuilding(rawDoc);
    expect(result.displayNo).toBe("302");
    expect(result.type).toBe("building");
    expect(result.campus).toBe("hssc");
    expect(result["description.ko"]).not.toContain("배리어프리");
    expect(result["description.en"]).toBe("English description");
    expect(result["accessibility.elevator"]).toBe(true);
    expect(result["accessibility.toilet"]).toBe(true);
    expect(result["accessibility.detail"]).not.toBeNull();
    expect(result["accessibility.detail"].sections).toHaveLength(1);
    expect(result.enrichVersion).toBe(ENRICH_VERSION);
  });

  test("facility without buildNo", () => {
    const rawDoc = {
      _id: 1,
      buildNo: null,
      campus: "hssc",
      name: { ko: "정문", en: "Main Gate" },
      description: { ko: DESC_NO_BF, en: "" },
      location: { type: "Point", coordinates: [126.99, 37.58] },
      image: { url: null, filename: null },
      accessibility: { elevator: false, toilet: false },
    };

    const result = enrichBuilding(rawDoc);
    expect(result.displayNo).toBeNull();
    expect(result.type).toBe("facility");
    expect(result["accessibility.detail"]).toBeNull();
  });
});

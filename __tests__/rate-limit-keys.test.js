const { byUidOrIp, byIp } = require("../lib/rateLimitKeys");

// req.ip는 express의 `trust proxy` 설정으로 항상 string(IPv4 or IPv6)이라 가정.
// undefined 경우(trust proxy 오설정 등)는 ipKeyGenerator가 undefined 반환 —
// 라이브러리/Express 설정 책임 영역.

describe("byUidOrIp", () => {
  it("prefers uid when present", () => {
    expect(byUidOrIp({ uid: "u123", ip: "1.2.3.4" })).toBe("u123");
  });
  it("falls back to IP when uid undefined", () => {
    expect(byUidOrIp({ ip: "1.2.3.4" })).toBe("1.2.3.4");
  });
  it("falls back to IP when uid null", () => {
    expect(byUidOrIp({ uid: null, ip: "1.2.3.4" })).toBe("1.2.3.4");
  });
  it("falls back to IP when uid empty string", () => {
    expect(byUidOrIp({ uid: "", ip: "1.2.3.4" })).toBe("1.2.3.4");
  });
});

describe("byIp", () => {
  it("returns IPv4 as-is", () => {
    expect(byIp({ ip: "1.2.3.4" })).toBe("1.2.3.4");
  });
  it("delegates IPv6 to ipKeyGenerator (does not pass raw address through)", () => {
    // Spec: helper는 req.ip를 ipKeyGenerator에 통과시킨다.
    // ipKeyGenerator의 IPv6 변환 형식(현재 v8.5.2는 `2001:db8::/56` 같은
    // CIDR subnet)은 라이브러리 책임이므로 형식 단언 안 함 — raw IPv6를
    // 그대로 키로 쓰지 않는다는 것만 검증.
    const raw = "2001:db8::1";
    const key = byIp({ ip: raw });
    expect(typeof key).toBe("string");
    expect(key).not.toBe(raw);
  });
});

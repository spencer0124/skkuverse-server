# Notices API — 아키텍처 & 설계 결정 기록

- **도입일:** 2026-04-10
- **Feature:** `/notices/*` 읽기 전용 API (3 endpoints)
- **범위:** `skku_notices` MongoDB 컬렉션을 읽어 앱(SKKUverse / skkumap)에 144개 학과 공지 리스트 + 상세를 서빙
- **관련 repo:**
  - 이 서버 (`skkuverse-server`) — 읽기만, 이 문서의 주제
  - `skkuverse-crawler` (Python) — 공지 크롤링, 쓰기 소유
  - `skkuverse-ai` — 공지 AI 요약, `summary*` 필드 쓰기 소유

---

## 1. 요구사항 & 진짜 문제

### 1.1 사용자 관점 요구사항

사용자가 구독한 학과 목록에서 하나를 선택 → 해당 학과의 최신 공지 리스트 → 상세. 단순해 보이지만 캠퍼스 환경 특유의 제약이 있다.

- **144개 학과**, 전략(crawler strategy) 7종, 학과마다 파싱된 필드가 다름(`category`/`author`/`views`가 있거나 없음).
- **공지 본문은 시점에 따라 바뀐다** (크롤러가 tier1/tier2 변경 감지). 앱은 "수정됨"을 표시해야 한다.
- **요약은 비동기로 붙는다.** 크롤링 직후엔 `summaryAt: null`, 나중에 GPT 요약이 달림. 앱은 "요약 준비 중" 상태를 허용해야 한다.
- **본문이 없는 공지도 있다.** 상세 fetch 실패, 5MB 초과, 또는 영 404 — `content: null`일 수 있다. 앱은 이때 원본 링크로 fallback해야 한다.
- 캠퍼스 와이파이는 공유 IP. IP 기반 rate limit은 금방 한계.

### 1.2 서버 관점의 진짜 문제들

설계 단계에서 표면적 요구("리스트 만들어줘")를 넘어 실제로 머리를 쓴 지점들:

| # | 진짜 문제 | 왜 어려운가 |
|---|---|---|
| 1 | 리스트 payload가 쉽게 거대해진다 | `content`는 5MB까지 가능. 리스트에 실수로 포함하면 학과당 수백 KB·MB 응답. |
| 2 | 같은 `crawledAt`의 공지가 배치로 뭉쳐 있음 | 크롤러가 한 번에 수십 개를 `insert_many`하면 tiebreaker 없는 커서는 중복·스킵 발생. |
| 3 | 학과마다 메타데이터가 다름 | wordpress-api 전략은 `category`/`author`가 아예 빈 문자열. `if (item.category)`를 모든 뷰에서 쓸 수는 없음. |
| 4 | 크롤러/요약기가 DB에 계속 필드를 추가할 수 있음 | 서버가 exclusion projection을 쓰면 새 내부 필드가 자동 노출됨. |
| 5 | AI가 만드는 `summaryType`이 언젠가 확장될 수 있음 | 프롬프트가 변해 `"meeting"` 같은 새 값이 나오면 기존 앱이 깨질 수 있음. |
| 6 | 크롤러가 쓰는 인덱스와 서버가 필요한 인덱스가 겹침 | 중복 생성 시 `IndexOptionsConflict`, 소유권 불명확. |
| 7 | `departments.json` 같은 UX 메타는 크롤러 관심사가 아님 | 크롤러는 selector만 알고 "명륜/율전" 같은 에디토리얼 그룹핑은 모름. |
| 8 | 공유 IP 환경에서 rate limit | IP 기반 limit은 캠퍼스 공용 와이파이에서 전체가 한 유저처럼 취급됨. |
| 9 | 본문 HTML XSS 위험 | 크롤링한 HTML을 그대로 뿌리면 XSS 가능. 어디서 sanitize할지 책임 경계가 중요. |
| 10 | 커서가 stale해질 수 있음 | 필터(`type`)를 바꾸면 예전 커서는 의미가 달라짐. |

---

## 2. 아키텍처 한 눈

```
              ┌────────────────────┐
              │ skkuverse-crawler  │  (Python, 배치 주기 실행)
              │  - 공지 크롤       │
              │  - content nh3     │
              │  - unique index    │ articleNo_1_sourceDeptId_1
              └─────────┬──────────┘
                        │ write notices
                        ▼
              ┌────────────────────┐
              │     MongoDB        │
              │   skku_notices     │
              │   .notices         │
              └────────▲──┬────────┘
                       │  │ read
        write summary* │  │
                       │  │
              ┌────────┴──┴──────┐
              │  skkuverse-ai    │        ┌────────────────────────┐
              │ (요약 processor) │        │ skkuverse-server (이것) │
              └──────────────────┘        │                        │
                                          │ features/notices/       │
                                          │  routes → data → col    │
                                          │                        │
                                          │ ensureNoticeIndexes:    │
                                          │  sourceDeptId, date,    │
                                          │  crawledAt, _id          │
                                          └────────▲───────────────┘
                                                   │
                                          GET /notices/*
                                                   │
                                          ┌────────┴──────┐
                                          │  skkumap app  │
                                          │ (Flutter/RN)  │
                                          └───────────────┘
```

**핵심 원칙: 쓰기는 세 저장소가 각자 소유, 읽기는 서버가 전담.**

- 크롤러는 문서 자체와 unique 인덱스를 소유.
- AI 프로세서는 `summary*` 필드를 `$set`으로 소유.
- 서버는 **read-optimization 인덱스**만 추가 소유. 쓰기는 절대 안 함.

---

## 3. 주요 설계 결정 & 근거

### 3.1 응답 envelope: 기존 `{meta, data}` 유지

**문제:** 공지 API만 토스식 `{success, data}`로 바꿀 수도 있었다.

**결정:** 거절. 기존 `/ad`, `/bus`, `/search`, `/building` 전부가 `lib/responseHelper.js` 의 `res.success(data, meta)` → `{ meta: { lang, ...meta }, data }`를 쓴다. 새 엔드포인트만 다른 envelope을 쓰면 클라이언트가 두 형태를 모두 알아야 한다.

**왜 중요한가:** 일관성이 설계보다 이긴다. 이건 "한 프로젝트 안에서 한 가지 방식으로 하는 게 낫다"의 전형적인 적용.

### 3.2 커서: `(date, crawledAt, _id)` 트리플 + 인덱스 suffix에도 `_id`

**문제:** 원래 생각은 `(date, crawledAt)` 두 개로 tiebreak. 그런데 크롤러가 `insert_many`로 배치 삽입하면 같은 millisecond에 수십 개가 동일한 `crawledAt`을 가질 수 있다. 이 상황에서 두 개 튜플만으로는 커서 경계가 모호해 **페이지 경계에서 중복·스킵**이 발생한다.

**결정:** 커서에 `_id` ObjectId를 세 번째 키로 포함. 인덱스도 `{sourceDeptId:1, date:-1, crawledAt:-1, _id:-1}` 네 키로 구성. 이유:

- `_id`는 배치 내부에서도 고유하므로 tiebreak 100% 보장.
- 인덱스 suffix에 명시되어 있으면 Mongo가 `sort({date:-1, crawledAt:-1, _id:-1})` 를 **`SORT` 스테이지 없이 `IXSCAN`만으로 처리**. `limit(limit+1)` fetch가 진짜 O(limit).
- ObjectId는 12바이트 — 인덱스 크기 오버헤드 무시 가능.

**커서 필터 모양 (3-branch `$or`):**
```js
{
  $or: [
    { date: { $lt: d } },                                      // 이전 날짜 전부
    { date: d, crawledAt: { $lt: new Date(c) } },              // 같은 날짜, 더 이른 크롤
    { date: d, crawledAt: new Date(c), _id: { $lt: oid } },    // 같은 크롤 배치, 더 작은 _id
  ],
}
```

### 3.3 `$and` 래핑으로 `date` 필드 충돌 회피

**문제:** 서비스 시작일 필터 `date: {$gte: SERVICE_START_DATE}`와 커서의 `date: {$lt: d}` 가 동일 top-level 키이면 **후자가 전자를 덮는** 쿼리 바운싱이 생길 수 있다 (Mongo는 이런 경우 단순히 둘을 AND로 결합해주지만, explain plan이 읽기 힘들어지고 버그 여지가 생김).

**결정:** 항상 `$and` 배열로 감싸서 명시적 AND 표현. 의도가 쿼리 자체에 문서화됨.

```js
{
  sourceDeptId: deptId,
  isDeleted: { $ne: true },
  summaryType: type,  // optional
  $and: [
    { date: { $gte: config.notices.serviceStartDate } },
    buildCursorFilter(cursor),  // optional
  ],
}
```

### 3.4 Inclusion projection (화이트리스트)

**문제:** `{content: 0, cleanHtml: 0, ...}` 방식으로 제외하면, 크롤러가 미래에 `internalDebugField`를 추가할 때 자동으로 API에 노출된다.

**결정:** 리스트·상세 둘 다 **inclusion projection**을 `Object.freeze`로 상수화. 새 필드를 응답에 넣으려면 반드시 명시적으로 추가해야 한다. DB 스키마와 API 스키마가 코드상 분리된다.

```js
const LIST_PROJECTION = Object.freeze({
  _id: 1, sourceDeptId: 1, articleNo: 1, title: 1, ...
  // content, cleanHtml, contentText 의도적으로 제외
});
```

### 3.5 `summaryType` 서버측 화이트리스트 정규화

**문제:** AI 프롬프트가 `action_required | event | informational` 세 값을 강제하지만, 프롬프트는 시간이 지나면 바뀐다. 새 값(`meeting`, `deadline_extended`)이 나와도 클라이언트가 깨지면 안 된다.

**결정:** 서버에서 `VALID_SUMMARY_TYPES = new Set(["action_required", "event", "informational"])`로 화이트리스트. 알 수 없는 값은 `informational`로 coerce. `VALID_SUMMARY_TYPES`와 `normalizeSummaryType`은 `notices.transform.js` 단일 소스에서 export — 라우트 레이어도 import해서 쓴다 (중복 정의 방지).

**트레이드오프:** AI가 진짜로 유용한 새 type을 만들어도 서버가 `informational`로 짜부라뜨린다. 장점이 더 크다고 판단 — 새 type을 지원하고 싶으면 서버 한 줄만 추가하면 됨.

### 3.6 `contentHtml: null` fallback (빈 문자열 금지)

**문제:** 초기 설계는 `content || ""`. 그런데 이러면 `hasContent: true`인데 `contentHtml === ""`인 모순 상태가 가능.

**결정:** `content ?? null`. 클라이언트는 `contentHtml == null ? fallback : render(contentHtml)`로 명확히 분기.

### 3.7 상세에 `contentText` 포함, 리스트엔 제외

**문제:** HTML 렌더에 실패하거나 앱 일부 화면이 HTML 지원 안 될 수 있다.

**결정:**
- 상세 → `contentText` 포함 (HTML fallback)
- 리스트 → `contentText` 제외 (payload 최소화)

### 3.8 리스트 summary는 brief, 상세는 full

**문제:** 리스트 셀에 요약 전체를 넣으면 payload가 커진다. 리스트 셀은 한 줄 요약 + 마감 D-day 배지만 있으면 충분.

**결정:** `buildSummaryBrief` vs `buildSummaryFull` 두 함수로 분리.

- **Brief** (리스트용, 4 필드): `oneLiner`, `type`, `endDate`, `endTime`
- **Full** (상세용, 10 필드): 위 4개 + `text`, `startDate`, `startTime`, `details`, `model`, `generatedAt`

**키명 주의:** 요약 본문 키는 `text` (초기 draft의 `body` 아님). 설계 문서 v2와 클라이언트 `NoticeSummaryFull.text` 타입에 정합.

### 3.9 인덱스 소유권 분리: 서버는 read-only 인덱스만 만든다

**문제:** 크롤러가 `articleNo_1_sourceDeptId_1` unique 인덱스를 이미 만든다. 서버도 동일한 인덱스를 `createIndex`하면 `IndexOptionsConflict` 발생 가능. 또 소유권이 불명확해짐 — 크롤러가 삭제하면 서버가 다시 만들어 쓰기 성능을 망칠 수도.

**결정:**
- 크롤러가 만드는 unique 인덱스는 **서버가 건드리지 않는다**. 상세 조회(`findOne`)는 이 기존 인덱스를 그대로 히트.
- 서버가 만드는 건 **리스트 전용** 복합 인덱스 `sourceDeptId_1_date_-1_crawledAt_-1__id_-1` 하나뿐.
- startup에 `ensureNoticeIndexes()`를 idempotent하게 호출. `createIndex`는 이미 있으면 no-op.

### 3.10 Startup 인덱스 생성 실패 시 3회 재시도 + `logger.error`

**문제:** 기존 `ensureBuildingIndexes` 등은 실패 시 `logger.warn` 한 줄 찍고 끝. 근데 notices는 54MB+ 컬렉션이라 인덱스 없이 full collection scan이 돌면 DB 부하가 크다. warn은 운영 알람 룰에서 묵살되기 쉽다.

**결정:**
- 최대 3회 재시도 (1초, 2초 지수 백오프로 transient 네트워크 이슈 흡수).
- 최종 실패 시 `logger.error` — 기존 warn보다 한 단계 격상, 알람 룰이 잡도록.
- 서버는 계속 기동 (기존 패턴 유지). 단, "list queries will full-scan" 경고 메시지로 원인 명시.

### 3.11 Firebase Auth: optional, 기존 패턴 복제

**문제:** 공개 API인가, 인증 필수인가? 그리고 캠퍼스 공유 IP에서 rate limit 어떻게?

**결정:**
- `lib/authMiddleware.js` 의 `verifyToken`을 그대로 씀. 이 미들웨어는 **optional auth**:
  - 토큰 없으면 그냥 통과.
  - 토큰 있으면 Firebase Admin SDK로 verify, `req.uid` 세팅, 5분 캐시.
  - 검증 실패 시만 401.
- Rate limit은 `keyGenerator: (req) => req.uid || ipKeyGenerator(req.ip)`. 토큰 있는 사용자는 uid 기반 → 캠퍼스 공유 IP 문제 자연스럽게 해결.
- 마운트 방식은 `/ad`와 동일: `app.use("/notices", verifyToken, noticesLimiter, noticesRoute)`.

**왜 중요한가:** 기존 합의된 보안 모델을 재사용했기 때문에 별도의 보안 검토가 필요 없음. "다른 거 한 것처럼"이라는 사용자 요구사항을 정확히 반영.

### 3.12 `departments.json` 서버 소유 + sha256 version

**문제:** 크롤러에도 `departments.json`이 있다. 그런데 크롤러의 파일은 selector 설정용이라 `campus`(명륜/율전), `category`(대학공통/단과대학/기숙사) 같은 **UX 에디토리얼 메타**가 없다. 누가 이걸 관리하나?

**결정:**
- 서버가 별도 `features/notices/departments.json`을 vendor.
- 크롤러 config에서 `id`, `name`을 그대로 복사.
- `strategy` 값으로부터 `hasCategory`/`hasAuthor`를 자동 유도 (jq 스크립트 1회 실행).
- `campus`/`category`는 scaffold 시 `null`. 이후 수동으로 편집하며 점진 개선.
- `departments.js` loader가 파일을 읽어 **sha256 version hash**를 startup에 한 번 계산. `{list, version, map}`으로 export.
- 클라이언트는 `/notices/departments` 응답의 `version` 필드를 자신의 번들 fallback 버전과 비교해 교체 여부 판단 가능.
- ETag 헤더로 변경 없을 때 304.

**부수 효과:** `campus`/`category`를 나중에 채워도 **앱 재배포 불필요**. 서버 JSON 파일만 수정 → 다음 요청에서 version 해시 바뀜 → 앱이 자동으로 새 그룹핑 메타 받음.

**전략→flag 매트릭스 (scaffold 기준):**

| strategy | hasCategory | hasAuthor | 학과 수 |
|---|:-:|:-:|---:|
| skku-standard | ✓ | ✓ | 134 |
| gnuboard | ✗ | ✓ | 3 |
| custom-php | ✓ | ✗ | 2 |
| jsp-dorm | ✓ | ✗ | 2 |
| gnuboard-custom | ✗ | ✓ | 1 |
| skkumed-asp | ✗ | ✓ | 1 |
| wordpress-api | ✗ | ✗ | 1 |

### 3.13 HTML sanitize는 크롤러가 담당, 서버는 pass-through

**문제:** 어디서 XSS 방어를 해야 하나?

**결정:** 크롤러가 이미 `nh3` (Rust 기반 sanitize 라이브러리)로 5단계 파이프라인을 거친다. 허용 태그: p/br/div/span/h1-h4/strong/b/em/i/u/mark/ul/ol/li/table 계열/img/a/hr. 허용 스타일: color/background-color/text-align/text-decoration/font-weight/font-style. 허용 스킴: http/https/mailto/tel. 서버는 sanitize를 중복하지 않고 `content` → `contentHtml`로 이름만 바꿔 그대로 내려준다.

**문서화:** 이 가정은 `features/notices/README.md`에 명시. 크롤러가 sanitize 정책을 바꾸면 이 가정이 깨짐 — 두 repo가 합의해야 하는 경계.

### 3.14 ETag 체크는 `req.fresh` 사용

**문제:** 직접 `if (req.headers["if-none-match"] === etag)` 비교는 RFC 7232 준수 안 됨. 클라이언트는 `W/"..."` 약한 ETag, 콤마 구분 리스트, 중복 공백 등 여러 형태로 보낼 수 있다.

**결정:** Express 내장 `req.fresh`를 사용. 이 getter는 `res.get('ETag')`와 request의 `If-None-Match`를 RFC 7232에 맞게 비교. 단 **`res.setHeader('ETag', ...)` 이후에** 호출해야 한다 (fresh는 response headers를 읽음).

```js
res.setHeader("ETag", etag);
if (req.fresh) return res.status(304).end();
res.success({...});
```

### 3.15 `isDeleted` 처리: 리스트에서 숨기고 상세는 404

**문제:** 크롤러가 원본에서 사라진 공지를 `isDeleted: true`로 soft-delete한다. 앱은 이걸 어떻게 보여야 하나?

**고려 대안:** "tombstone" — 상세에서 캐시된 본문 + `{deleted: true}` 플래그로 "원본 삭제됨" 배지 렌더.

**결정:** 단순한 404. 리스트·상세 둘 다 `isDeleted: {$ne: true}` 필터. 이유:
- 클라이언트 캐시 무효화가 자연스러움 (404는 `queryClient.removeQueries`로 자동 대응).
- 복잡도 최소화. tombstone이 필요해지면 나중에 플래그로 추가.

### 3.16 Type 필터 + 커서 상호작용: 커서는 필터 무관

**문제:** 리스트에서 `type=event`로 페이지네이션하다가 사용자가 type 필터를 바꾸면 기존 커서는 어떻게 되나?

**고려 대안:** 커서에 type을 인코딩, 요청 type과 불일치하면 400.

**결정:** 커서는 filter-agnostic. `(date, crawledAt, _id)` 튜플만. type을 바꿔도 서버는 그대로 accept. 단점: 일부 아이템 skip 가능. 완화: 클라이언트가 type 변경 시 리스트 초기화하는 게 자연스럽다 (앱 UX상 필터 변경은 리스트 리셋이 관례).

---

## 4. 엔드포인트 스펙

### 4.1 `GET /notices/departments`

144개 학과 + version hash + ETag. `Cache-Control: public, max-age=300, stale-while-revalidate=3600`.

응답 예:
```jsonc
{
  "meta": { "lang": "ko", "count": 144 },
  "data": {
    "departments": [
      { "id": "skku-main", "name": "학부통합(학사)",
        "campus": null, "category": null,
        "hasCategory": true, "hasAuthor": true }
      // ... 143개 더
    ],
    "version": "00f484092d4ded0aa40ee451d42cecae3822a573e710294c284997f7e788b973"
  }
}
```

### 4.2 `GET /notices/dept/:deptId`

쿼리: `cursor` (base64url), `limit` (1~50, default 20), `type` (optional: `action_required | event | informational`).

응답 예:
```jsonc
{
  "meta": { "lang": "ko", "count": 2 },
  "data": {
    "notices": [
      {
        "id": "69d2024f8e7a44b79c89f936",
        "deptId": "skku-main",
        "articleNo": 136023,
        "title": "[모집] 2026 학생 창업유망팀 ...",
        "category": "행사/세미나",
        "author": "안찬웅",
        "department": "학부통합(학사)",
        "date": "2026-04-10",
        "views": 7865,
        "sourceUrl": "https://www.skku.edu/...",
        "hasContent": true,
        "hasAttachments": true,
        "isEdited": true,
        "summary": {
          "oneLiner": "2026-04-09까지 학생 창업유망팀 신청",
          "type": "action_required",
          "endDate": "2026-04-09",
          "endTime": null
        }
      }
    ],
    "nextCursor": "eyJkIjoi...",
    "hasMore": true
  }
}
```

### 4.3 `GET /notices/:deptId/:articleNo`

응답 예:
```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "...",
    "deptId": "skku-main",
    "articleNo": 136023,
    "title": "...",
    "contentHtml": "<p>...</p>",
    "contentText": "성균인 여러분...",
    "attachments": [{ "name": "...", "url": "..." }],
    "sourceUrl": "...",
    "editInfo": { "count": 2, "history": [...] },
    "summary": {
      "text": "성균관대학교 창업지원단에서 ...",
      "oneLiner": "...",
      "type": "action_required",
      "startDate": "2026-04-03",
      "endDate": "2026-04-09",
      "details": { "target": "...", "action": "...", "host": "...", ... },
      "model": "gpt-4.1-mini-2025-04-14",
      "generatedAt": "2026-04-09T11:52:02.769Z"
    }
  }
}
```

### 4.4 에러 코드

| HTTP | code | 상황 |
|---|---|---|
| 400 | `INVALID_DEPT_ID` | `departments.json`에 없는 deptId |
| 400 | `INVALID_PARAMS` | articleNo 숫자 아님, limit 범위 초과, 알 수 없는 type |
| 400 | `INVALID_CURSOR` | base64url 디코딩·JSON 파싱·shape 검증 실패 |
| 401 | `AUTH_INVALID` | 토큰 검증 실패 (optional auth — 토큰 없으면 401 아님) |
| 404 | `NOT_FOUND` | 존재하지 않거나 isDeleted |
| 429 | `RATE_LIMIT` | 120 req/min 초과 |

---

## 5. 파일 맵

```
features/notices/
├── notices.routes.js      # Express router, 3 endpoints
├── notices.data.js        # DB access, ensureNoticeIndexes, projections
├── notices.transform.js   # pure toListItem/toDetailItem, summary brief/full
├── notices.cursor.js      # encode/decode/buildCursorFilter + InvalidCursorError
├── departments.json       # 144 entries, scaffolded
├── departments.js         # loader + sha256 version + Map
└── README.md              # maintenance guide

__tests__/
├── notices-transform.test.js    # 28 tests — pure
├── notices-cursor.test.js       # 13 tests — pure
├── notices-departments.test.js  # 10 tests — loader
├── notices-data.test.js         # 15 tests — Mongo mocked
└── notices-routes.test.js       # 17 tests — supertest + all mocks

수정:
  lib/config.js       # config.notices + required
  index.js            # mount, noticesLimiter, startup retry ensure
  .env                # MONGO_NOTICES_DB_NAME, NOTICES_SERVICE_START_DATE
  swagger/swagger-output.json  # auto-regenerated
```

---

## 6. 개발 방법론 메모: TDD

이 기능은 TDD로 작성되었다. 각 사이클이 red → green을 거쳤고, 구현은 테스트의 기대를 정확히 만족시키는 최소 코드로 짜였다.

**사이클 순서 (안쪽 → 바깥쪽):**

1. `notices.transform.js` — 순수 함수. Mongo 의존성 없음. 28개 테스트 먼저 → 구현. 100% statement coverage.
2. `notices.cursor.js` — 순수 함수. ObjectId만 Mongo 의존. 13개 테스트 먼저 → 구현.
3. `departments.js` — 파일 로드 + 해시 계산. 10개 테스트.
4. `notices.data.js` — Mongo chain mock (`find().sort().limit().toArray()`). 15개 테스트. 100% coverage.
5. `notices.routes.js` — supertest + `lib/db`·`lib/firebase`·`features/notices/notices.data` 전부 mock. 17개 테스트. Express app 전체 startup 경로까지 커버.

**결과:** 전체 389개 테스트 green, lint 0 errors, swagger 자동 등록, 실서버 E2E smoke test (dev DB 대상) 전 경로 통과.

**TDD가 실제로 잡아낸 버그:**

- 커서 디코드 시 Node의 `Buffer.from(str, "base64url")`가 garbage 입력에 throw하지 않고 조용히 깨진 바이트를 반환하는 것. 테스트가 이 경로를 명시적으로 다뤄서 `JSON.parse` 단계에서 `InvalidCursorError`로 변환하는 구조가 자연스럽게 나옴.
- `hasMore` 계산 시 `slice(0, limit)` 이후 `items[items.length-1]`을 커서 시드로 쓰는 순서. 초기 구현에서 `docs[docs.length-1]` (잘라내기 전)을 쓸 뻔했는데, 테스트가 "cursor points to items[1] not docs[2]"를 명시해서 잡힘.
- `summary: null`이 `undefined`가 아니어야 한다는 invariant. transform 테스트가 `toBeNull()`로 명시.

---

## 7. 다음에 생각해 볼 것들 (현재 범위 밖)

구현하지 않았지만 운영 중 필요해질 수 있는 것들:

1. **전체 최신순 피드** (`/notices/feed`) — 학과 무관 최신순. 별도 `{date:-1, crawledAt:-1, _id:-1}` 인덱스 필요 (sourceDeptId 제외).
2. **검색** (`/notices/search?q=...`) — `title`, `contentText`에 text 인덱스 필요. 한국어 tokenization 고려.
3. **구독 알림** — 사용자별 구독 학과 정보를 서버에서 관리하고 새 공지 발행 시 FCM push. 크롤러와 이벤트 버스로 연결해야 함.
4. **`campus`/`category` 채우기** — 현재 144개 모두 null. 2박3일 정도 들여 학사 규정 확인하며 채워야 할 수 동 작업.
5. **크롤러 `isDeleted` tombstone UX** — 현재는 404로 숨김. 사용자가 "최근 봤던 공지가 사라졌어요" 같은 피드백을 주면 tombstone 전환 고려.
6. **상세 API prefetch 정책** — 현재는 클라이언트 결정. 서버는 무관. 앱에서 viewport 기반 prefetch를 켜면 DAU 800 기준으로도 상세 QPS가 수배 증가.
7. **전체 리스트 응답 압축** — `compression` 미들웨어 미설치. 본문을 내려주는 상세 응답이 커지면 검토.
8. **크롤러 `consecutiveFailures` 모니터링** — dev DB 샘플에서 `hasContent: false`가 꽤 보임. 상세 fetch가 실패 중인 학과를 주기적으로 확인하는 게 좋음 (서버 범위 밖, 운영 업무).

---

## 8. 검증 체크리스트 (PR 머지 전)

- [x] `npm run lint` — 0 errors
- [x] `npm test` — 전체 389/389 green
- [x] `npm run swagger` — 3개 라우트 자동 등록
- [x] 실서버 기동 → `GET /notices/departments` 144개 + version
- [x] `GET /notices/dept/skku-main?limit=2` + `cursor` round-trip 페이지네이션 동작
- [x] `GET /notices/:deptId/:articleNo` 실제 문서 상세 반환, `contentHtml`/`contentText` 모두 존재
- [x] 존재하지 않는 `articleNo` → 404
- [x] 알 수 없는 `deptId` → 400 (DB 호출 없이 즉시)
- [x] 알 수 없는 `type` → 400
- [x] 깨진 `cursor` → 400
- [x] ETag `If-None-Match` → 304
- [x] MongoDB MCP로 `sourceDeptId_1_date_-1_crawledAt_-1__id_-1` 인덱스 실제 생성 확인
- [x] 크롤러 소유 `articleNo_1_sourceDeptId_1` 인덱스 그대로 유지 (건드리지 않음)

---

## 9. 참고 링크

- 설계 대상 리뷰 문서: 토스 스타일 API 리뷰 (대화 내 인라인)
- Express `req.fresh`: https://expressjs.com/en/api.html#req.fresh
- nh3 sanitizer (크롤러 사용): https://pypi.org/project/nh3/
- 커서 기반 페이지네이션 원리: MongoDB docs → compound index + range query
- Plan file: `~/.claude/plans/cryptic-growing-octopus.md` (구현 착수 전 최종 승인된 플랜)

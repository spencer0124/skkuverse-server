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
| 11 | 환경변수 누락이 조용히 숨는다 | `lib/config.js`의 silent fallback이 dev·CI·prod 간 차이를 덮어 로컬에선 멀쩡해 보임. VM `.env`에 변수를 추가하는 걸 잊어도 며칠 뒤 "엉뚱한 DB에 데이터가 쌓였다"로 터짐. **2026-04-10 incident로 실제 발현 — §3.17·§10 참조.** |

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
  // content, cleanHtml, cleanMarkdown, contentText 의도적으로 제외
});
```

### 3.5 `summaryType` 서버측 화이트리스트 정규화

**문제:** AI 프롬프트가 `action_required | event | informational` 세 값을 강제하지만, 프롬프트는 시간이 지나면 바뀐다. 새 값(`meeting`, `deadline_extended`)이 나와도 클라이언트가 깨지면 안 된다.

**결정:** 서버에서 `VALID_SUMMARY_TYPES = new Set(["action_required", "event", "informational"])`로 화이트리스트. 알 수 없는 값은 `informational`로 coerce. `VALID_SUMMARY_TYPES`와 `normalizeSummaryType`은 `notices.transform.js` 단일 소스에서 export — 라우트 레이어도 import해서 쓴다 (중복 정의 방지).

**트레이드오프:** AI가 진짜로 유용한 새 type을 만들어도 서버가 `informational`로 짜부라뜨린다. 장점이 더 크다고 판단 — 새 type을 지원하고 싶으면 서버 한 줄만 추가하면 됨.

### 3.6 본문은 `contentMarkdown` 단일 경로 (`contentHtml` / `contentText` 제거)

**문제:** 초기 설계는 HTML (`contentHtml`) + plain text (`contentText`)를 병행 노출해 앱이 HTML 렌더 실패 시 plain으로 fallback 하게 했다. 그러나 앱이 네이티브 마크다운 렌더러로 전환하면서 HTML·plain 경로는 **dead weight**가 됐다.

**배경:** 크롤러가 `cleanHtml` → GFM 변환 파이프라인을 추가(`markdownify` + SKKU 특수 전처리: 1-cell layout table unwrap, bold 첫 행 `<thead>` 승격, table cell block flatten)하여 `cleanMarkdown` 필드를 MongoDB에 쓴다. prod 126건 전부 채워져 있고, 평균 1.2KB, max 6.3KB로 payload 부담이 작다.

**결정:**
- 상세 `DETAIL_PROJECTION`에 `cleanMarkdown: 1`만 포함. `content` / `contentText` / `cleanHtml` **모두 제거**
- `toDetailItem`에서 `cleanMarkdown` → **`contentMarkdown`** 으로 rename. 다른 본문 필드는 응답에 없음
- null fallback: `doc.cleanMarkdown ?? null` — 빈 문자열 금지. 클라이언트는 `contentMarkdown == null`이면 `sourceUrl` 외부 링크로 분기
- 리스트는 그대로 제외 (inclusion projection이라 자동 차단, 방어적 테스트로 pin)

**하위호환 포기의 이유:** 앱이 아직 HTML 경로를 쓰고 있다면 이 PR은 배포 전에 앱 릴리스와 조율돼야 한다. 장기 유지되는 이중 렌더 경로보다 한 번의 조율 비용이 싸다고 판단.

**크롤러와 coupling:** `cleanMarkdown`은 크롤러 소유 필드다. 변환 품질 이슈(bold 쪼개짐, GFM 테이블 misalign 등)는 서버가 아니라 크롤러 `markdown_converter.py`에서 해결한다.

### 3.7 `hasContent`는 유지

리스트 셀에서 "본문 있는 공지 vs 크롤 실패 공지"를 구분해 주는 신호로 `hasContent = contentHash != null`이 여전히 유용하다. 본문 필드 자체가 아니라 **존재 여부 flag**이므로 본문 경로 단일화와 무관하게 남겨 둔다.

### 3.8 리스트 summary는 brief, 상세는 full

**문제:** 리스트 셀에 요약 전체를 넣으면 payload가 커진다. 리스트 셀은 한 줄 요약 + 마감 D-day 배지만 있으면 충분.

**결정:** `buildSummaryBrief` vs `buildSummaryFull` 두 함수로 분리.

- **Brief** (리스트용, 3 필드): `oneLiner`, `type`, `endAt`
- **Full** (상세용, 9 필드): 위 3개 + `text`, `periods`, `locations`, `details`, `model`, `generatedAt`

**Brief `endAt` 파생 규칙:** `summaryPeriods[0]` (첫 번째 period)의 `endDate` / `endTime`로부터 `{ date, time } | null` 형태로 파생한다. 다중 phase 공지 (예: 등록금 1차/2차, 신입/인턴 모집)에서 `periods[0]`이 가장 이른 — 즉 사용자에게 가장 시급한 — 마감이므로 list cell의 D-day 배지는 항상 1차 기준으로 표시된다. `periods`가 비어있거나 `periods[0].endDate`와 `endTime`이 모두 null이면 `endAt: null`. Time-independent (now()에 의존하지 않음) → 결정론적, 캐시 가능. 1차가 지나면 클라이언트에서 자연스럽게 "지난 마감"으로 보여주고, 사용자는 상세 화면에서 `periods[]` 전체를 보고 2차를 확인한다.

**Full의 `periods` / `locations` 배열 통과:** AI 서버가 내려주는 배열을 그대로 pass-through한다. `label` 규칙 (원소 1개면 null, 2개 이상이면 LLM 생성 disambiguator) 도 그대로 유지. 빈 값은 `[]` (null 아님). `details`에서 `location` 키가 제거되어 있고 (`target`, `action`, `host`, `impact`만 남음) — `locations[]`가 그 자리를 대체한다.

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

**Post-launch 주의 (2026-04-10):** 이 retry 블록은 healthy path에서는 여전히 유효하지만, 실제 incident는 이 단계에 **도달하지도 못했다** — `lib/config.js`의 required 체크에서 `process.exit(1)`이 먼저 발동했기 때문. 즉 이 방어층은 "DB 네트워크 transient 이슈"를 막지만 "환경변수 미세팅"은 못 막는다. 후자는 §3.17이 담당.

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

### 3.13 본문 정제는 크롤러가 담당, 서버는 pass-through

**문제:** XSS·정제 책임을 어디에 둘 것인가?

**결정:** 크롤러가 `cleanHtml`을 `nh3`로 sanitize한 뒤 `markdownify`로 GFM `cleanMarkdown`까지 변환해 MongoDB에 저장한다. 서버는 `cleanMarkdown`을 `contentMarkdown`으로 rename만 하고 그대로 내려준다 (재정제·재변환 없음). HTML·plain 본문은 API에 노출되지 않으므로 서버 레이어의 XSS 공격 표면도 사라졌다 — 앱의 마크다운 렌더러가 자체 sanitize 책임을 진다.

**문서화:** 이 가정은 `features/notices/README.md`에 명시. 크롤러가 변환 정책을 바꾸면 이 가정이 깨짐 — 두 repo가 합의해야 하는 경계.

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

### 3.17 Strict config validation + pre-deploy dry-load (post-launch, 2026-04-10)

**배경:** §3.1~§3.16까지의 설계는 런치 시점까지 유효했지만, 2026-04-10 PR #43 머지 이후 배포가 실패하며 구조적 약점이 드러났다. 이 subsection은 incident 이후 추가된 방어층을 정리한다. 전체 incident retrospective는 §10 참조.

**진짜 문제:** `lib/config.js`에 두 가지 silent fallback이 있었다.
```js
// (1) 위험: MONGO_AD_DB_NAME이 없으면 광고가 버스 DB로 조용히 저장됨
dbName: devDbName(
  process.env.MONGO_AD_DB_NAME || process.env.MONGO_DB_NAME_BUS_CAMPUS,
),

// (2) 위험: 필터 경계가 조용히 하드코드된 날짜로 고정됨
serviceStartDate: process.env.NOTICES_SERVICE_START_DATE || "2026-03-09",
```
Dev·CI·prod 환경이 다르면 이런 fallback은 **차이를 은폐**한다. 로컬에서는 `.env`에 값이 있어 동작하고, CI에서는 fallback이 먹혀 통과하고, prod에서는 누군가가 VM `.env`에 변수를 추가하는 걸 잊어도 한동안 멀쩡해 보인다. 그러다가 몇 주 뒤 데이터가 엉뚱한 DB에 쌓인 걸 발견한다.

**결정 (PR #44 + #45로 분할):**

**(A) Strict validation — PR #44, `lib/config.js`**
- "DB/경계 redirect" 타입 fallback **전부 제거**. 누락 = loud crash.
- `required` 배열을 **3-tuple** `[configPath, value, envVarName]`로 확장.
- 에러 메시지가 **어떤 env var을 설정해야 하는지 직접 표기**:
  ```
  FATAL: Missing required config — set these env vars:
    ad.dbName (env: MONGO_AD_DB_NAME)
  ```
- 값 기본값(`port || 3000`, `MONGO_AD_COLLECTION || "ads"` 같은 collection 이름)은 **유지** — 이건 "데이터 리디렉션"이 아닌 단순 운영 기본값.
- `jest.setup.js` 신규 추가. CI처럼 `.env` 없는 환경에서도 baseline 값이 있어야 테스트가 동작. `if (!process.env[key])` 체크로 실제 env를 덮어쓰지 않음.
- `config-env.test.js`에 strict 검증 6개 테스트 추가 + `jest.mock("dotenv")`로 dotenv 재로딩 차단 + `NODE_ENV="production"` 명시 (test 모드의 `!isTest` 가드 우회).

**(B) Pre-deploy dry-load — PR #45, `.github/workflows/deploy.yml`**

`docker compose build` 직후, rolling update **이전에** throwaway 컨테이너로 config만 dry-load:
```bash
echo "=== Pre-deploy config validation ==="
if ! docker compose run --rm --no-deps -T api-1 \
     node -e "require('./lib/config'); console.log('config ok')"; then
  echo "ERROR: production config validation failed — aborting deploy."
  git checkout "$PREV_COMMIT"
  exit 1
fi
```
- **같은 이미지**, **같은 `.env`** (compose의 `env_file: - .env`로 상속), **같은 `NODE_ENV=production`** — 프로덕션 동작의 가장 이른 지점을 재현.
- `--rm --no-deps -T` + `node -e` 로 CMD override → 서버는 안 띄우고 config만 require → 포트 바인딩, Mongo 연결, poller 시작 등 부수효과 전무.
- 실패 시 `git checkout $PREV_COMMIT; exit 1` — **rolling update 전**에 abort하므로 running containers 안 건드림, 0 downtime.
- 기존 `rollback()` 함수는 그대로 유지 — rolling update 중 다른 이유(transient DB 등)로 실패할 때 여전히 보호.

**3단 방어층 완성:** 코드 strict (#44) + pre-deploy dry-load (#45) + 기존 auto-rollback (#42). 각각 **다른 실패 모드**를 커버하므로 중복이 아닌 **중첩 방어**.

| 실패 모드 | 잡는 층 |
|---|---|
| env var 누락 | #45 pre-deploy dry-load (2초) |
| transient DB 연결 실패 중 rolling update | #42 auto-rollback (60초) |
| 코드 버그로 startup 직후 죽음 | #42 auto-rollback |
| silent env var drift → 몇 주 뒤 데이터 오염 | #44 strict validation (원천 차단) |

**Before vs after (env var 누락 시):**
```
Before: rolling update → new container crash loop → 30초 health check timeout
        → rollback() → 세 컨테이너 재빌드·재시작 → ~60초 downtime risk → exit 1
After:  pre-deploy dry-load 2초 → non-zero exit → git revert → exit 1
        → running containers 안 건드림 → 0 downtime
```

**철학 전환:** "fallback으로 crash 회피" (fail-safe) → "fail-loud으로 drift 드러내기" (strict validation). Silent fallback은 편안해 보이지만 **카오스 딜레이 타이머** — 언젠가 터지고, 터질 때 원인 특정이 어렵다. strict는 불편하지만 **문제를 배포 전에 드러낸다**.

**의존 관계 주의:** `jest.setup.js`의 defaults, `.env.example`의 REQUIRED 섹션, `lib/config.js`의 `required` 배열 — 이 **세 파일이 동기화**되어야 한다. 새 required 변수를 추가할 때 한 곳만 건드리면 또 같은 종류의 drift가 생긴다.

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
          "endAt": { "date": "2026-04-09", "time": null }
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
    "contentMarkdown": "**[모집] 2026 학생 창업유망팀 300+ ...**\n\n성균인 여러분 ...",
    "attachments": [{ "name": "...", "url": "..." }],
    "sourceUrl": "...",
    "editInfo": { "count": 2, "history": [...] },
    "summary": {
      "text": "성균관대학교 창업지원단에서 ...",
      "oneLiner": "...",
      "type": "action_required",
      "periods": [
        { "label": null, "startDate": "2026-04-03", "startTime": "09:00", "endDate": "2026-04-09", "endTime": "18:00" }
      ],
      "locations": [
        { "label": null, "detail": "경영관 33101호" }
      ],
      "details": { "target": "...", "action": "...", "host": "...", "impact": null },
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
  lib/config.js       # config.notices + required (2026-04-10: strict, no fallback)
  index.js            # mount, noticesLimiter, startup retry ensure
  .env                # MONGO_NOTICES_DB_NAME, NOTICES_SERVICE_START_DATE
  swagger/swagger-output.json  # auto-regenerated
```

**Post-launch 추가 (2026-04-10 hardening — §3.17 참조):**
```
jest.setup.js          # NEW — baseline env vars for CI/test isolation
jest.config.js         # + setupFiles: ["<rootDir>/jest.setup.js"]
.env.example           # REQUIRED / OPTIONAL 섹션으로 재구성
.github/workflows/deploy.yml  # + pre-deploy config dry-load step
```

이 파일들은 §3.17의 "세 파일 동기화" 계약에 포함된다: `jest.setup.js`의 defaults / `.env.example`의 REQUIRED / `lib/config.js`의 required 배열. 새 required 변수를 추가할 때 세 곳 모두 갱신해야 drift가 안 생긴다.

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
- [x] `GET /notices/:deptId/:articleNo` 실제 문서 상세 반환, `contentMarkdown` 존재 (legacy HTML/text 필드 미노출)
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

**Post-launch (2026-04-10 incident & hardening):**
- PR #43: https://github.com/spencer0124/skkuverse-server/pull/43 — notices 최초 배포 (crash)
- PR #44: https://github.com/spencer0124/skkuverse-server/pull/44 — strict config validation (silent fallback 제거)
- PR #45: https://github.com/spencer0124/skkuverse-server/pull/45 — pre-deploy config dry-load
- Incident run: https://github.com/spencer0124/skkuverse-server/actions/runs/24230429834 (실패 → rollback → SSH hotfix → rerun → 성공)
- PR #42 (pre-existing): `ci/retry-and-auto-rollback` — rolling update 중 health check 실패 시 이전 커밋으로 자동 rollback (이번 incident에서 실제로 발동)

---

## 10. Post-launch 2026-04-10 incident & hardening retrospective

이 섹션은 notices 최초 배포 직후 일어난 crash incident와, 그 후속으로 추가된 3단 방어층의 전체 기록이다. 설계 결정 자체는 §3.17에 있고, 이 §10은 **"무슨 일이 있었나 / 왜 그렇게 대응했나"**의 서사.

### 10.1 Timeline

| 시각 (UTC) | 이벤트 |
|---|---|
| 06:36 | PR #43 생성 (dev → main, notices API 최초) |
| 06:48 | PR #43 main에 merge → CI/CD 자동 트리거 |
| 06:49 | test job 18초 success, deploy job 시작 |
| 06:49:22 | SSH 접속, `git pull origin main` (2b836e5..337a666 fast-forward), nginx config reload |
| 06:49:25.71 | **새 `api-1` 컨테이너 시작** |
| 06:49:25 ~ 55 | **30초간 `/health/ready` 6회 시도 모두 실패** (crash loop 중) |
| 06:49:55.79 | `rollback()` 함수 실행: `git checkout 2b836e5`, 세 컨테이너 재빌드·재시작 |
| 06:50:13.82 | rollback 컨테이너 healthy (`uptime: 15.69s`), 하지만 workflow는 원래 실패로 **exit 1** |
| 06:50~ | 프로덕션은 `2b836e5`(이전 커밋)에서 정상 동작, notices 엔드포인트는 없는 상태 |
| ~07:05 | 분석 시작 (사용자: "deploy fail인데 분석하고 계획 세워") |
| ~07:06 | `gh run view --log-failed`로 타임라인 확보 |
| ~07:07 | Root cause 특정: `lib/config.js`의 `required` 배열에 `notices.dbName` 추가했는데 VM `.env`에 `MONGO_NOTICES_DB_NAME` 없음 |
| 07:07 | `ssh oracle`로 접속 → VM `.env` 백업 (`.env.bak.1775804878`) → append `MONGO_NOTICES_DB_NAME=skku_notices`, `NOTICES_SERVICE_START_DATE=2026-03-09` |
| 07:07 | VM git state 정리: `detached HEAD 2b836e5` → `git checkout main && git pull` → `337a666` |
| 07:08 | `gh run rerun 24230429834 --failed` |
| 07:09 | **deploy GREEN (48초)**, 프로덕션에 notices 엔드포인트 live |
| 07:10 | smoke test 통과: `/health/ready`, `/notices/departments` (144), `/notices/dept/skku-main` (페이지네이션) |
| 07:42 | PR #44 (strict config) merge → deploy 53초 success |
| 07:53 | PR #45 (pre-deploy validation) merge → deploy 1분1초 success (새 validation step 첫 실행) |

### 10.2 Root cause

**한 줄:** `lib/config.js`의 `required` 배열에 `notices.dbName`을 추가했지만 VM `.env`에 대응 env var 미설정 → production container의 `process.exit(1)` crash loop → `/health/ready` 30초 timeout → auto-rollback.

**상세 실행 경로 (production container 안):**
1. `NODE_ENV=production`, `isDevelopment=false`, `isTest=false`
2. `process.env.MONGO_NOTICES_DB_NAME` → `undefined` (VM `.env`에 없음)
3. `devDbName(undefined)` → `undefined` (함수의 `if (!baseName) return baseName` 분기)
4. `config.notices.dbName` → `undefined`
5. `required.filter(([, v]) => !v)` → `[["notices.dbName", undefined]]`
6. `missing.length > 0` → `true`
7. `console.error("Missing required config: notices.dbName")`
8. `process.exit(1)` → **컨테이너 death**
9. Docker restart policy `unless-stopped` → 즉시 재시작 → 동일 지점에서 또 die → crash loop
10. 30초간 `/health/ready` 한 번도 응답 못 함
11. `ci/retry-and-auto-rollback` (PR #42)이 rollback 발동

### 10.3 왜 테스트·CI·로컬에서 안 잡혔나

이번 incident의 진짜 교훈은 **"어떻게 여러 단계의 안전망을 동시에 통과했는가"**다.

**로컬 실행 (세션 초반 smoke test):** 이 세션 초반에 로컬 `.env`에 `MONGO_NOTICES_DB_NAME=skku_notices`를 추가했고 그 상태로 `NODE_ENV=development PORT=3099 node index.js`로 smoke test했다 → 통과. 로컬 `.env`에 변수가 있었기 때문.

**CI test job:** `config.js`에 `if (!isTest) { process.exit(1); }` 가드가 있어 `NODE_ENV=test`에선 crash가 suppress된다. 테스트는 `console.error`만 찍히고 통과.

**`.env.example`:** `MONGO_NOTICES_DB_NAME`이 문서화되어 있지 않았음 → 다음 VM 셋업할 사람이 참조할 곳 없음.

**VM `.env`:** 수동 관리. 내가 로컬 `.env`에만 추가하고 VM은 건드리지 않았음. SSH 접근은 사용자 영역이라 자동화 없음.

이 다섯 단계 중 어느 한 곳이라도 "new required var이 선언됨"을 감지했다면 incident는 일어나지 않았다. 이게 바로 §3.17의 "세 파일 동기화 계약"이 생긴 이유다.

### 10.4 Immediate fix (SSH hotfix, 코드 변경 없음)

사용자 판단으로 **코드 수정 없이 VM `.env`만 업데이트**하기로 결정. 이유: 프로덕션 rollback 상태(`2b836e5`)가 안정적이고, 긴급 복구에 PR 절차를 거치는 것보다 SSH로 한 줄 추가하는 게 빠르고 리스크 작음.

실행 순서 (`ssh oracle`, 모두 append-only, `.env` 백업 후):
```bash
cd /home/ubuntu/skkumap-server-express
cp .env .env.bak.$(date +%s)
cat >> .env <<'ENV'

# 공지 DB (added 2026-04-10 after deploy fail hotfix)
MONGO_NOTICES_DB_NAME=skku_notices
NOTICES_SERVICE_START_DATE=2026-03-09
ENV
git checkout main  # detached HEAD → main
git pull origin main  # 2b836e5 → 337a666
```
그 후 로컬에서 `gh run rerun 24230429834 --failed` → 48초 만에 green → 프로덕션 live.

### 10.5 Long-term hardening (PR #44 + #45)

Immediate fix는 임시. 같은 class의 실수가 반복되지 않도록 **구조적 방어**를 추가할 필요가 있었다. 사용자가 철학 전환을 명시: "fallback 빼줘, 기존에 있던 fallback도 빼줘, 무조건 없으면 crash나게, 그래서 나중에 카오스 안 일어나게."

이 철학에 따라 두 PR로 분할 진행 (risk 격리):

1. **PR #44** — `lib/config.js` strict 전환. 상세는 §3.17 (A).
2. **PR #45** — `.github/workflows/deploy.yml` pre-deploy dry-load. 상세는 §3.17 (B).

두 PR 모두 merge 후 첫 배포가 **problem-free**하게 진행됐고, PR #45 merge 후 deploy 로그에서 새 validation step(`=== Pre-deploy config validation ===` → `config ok`)이 실제로 실행되는 걸 확인.

### 10.6 Lessons learned

**1. Silent fallback은 카오스 딜레이 타이머.** `ad.dbName`이 `MONGO_DB_NAME_BUS_CAMPUS`로 fallback한다는 건 "지금은 동작"처럼 보이지만, 누군가 `MONGO_AD_DB_NAME`을 잘못 설정하면 **광고가 몇 주 동안 버스 DB에 저장**된 뒤 발견된다. 그때는 복구가 훨씬 어렵다. Incident는 **몇 분짜리 crash loop**가 **며칠짜리 데이터 오염**보다 차라리 낫다.

**2. "테스트 통과"와 "안전"은 다르다.** `config-env.test.js`의 기존 `setBaseEnv()`는 `MONGO_BUILDING_DB_NAME`, `MONGO_NOTICES_DB_NAME` 같은 required 변수를 빠뜨리고 있었다. 테스트는 `process.exit` mock 덕에 조용히 통과했다. 즉 **테스트가 실제 required contract를 검증하지 않고 있었다**. 이번 hardening에서 `setBaseEnv`를 `required` 배열과 수동 sync하도록 고쳤지만, 궁극적으로는 코드 레벨에서 동기화를 강제할 방법(예: jsonschema + test runner assertion)이 있으면 더 좋다.

**3. Pre-deploy validation의 비용은 거의 0.** PR #45의 `docker compose run --rm --no-deps -T api-1 node -e "require('./lib/config')"`는 이미 빌드된 이미지를 throwaway로 잠깐 띄워 config만 로드한다. 배포 시간 증가는 2~3초 수준인데, "missing env var로 rolling update를 시작한 뒤 30초 timeout + rollback" 을 "배포 전 2초 fail-fast"로 바꾼다. **99%의 경우엔 낭비지만, 1%의 실수에서 치명상을 막는다**.

**4. Auto-rollback은 최후 방어층, 첫 방어층이 아니다.** PR #42의 `ci/retry-and-auto-rollback`이 이번 incident에서 프로덕션을 보호했다는 건 고마운 사실. 하지만 auto-rollback에 의존하면 "어떤 에러든 배포 중에 터질 수 있다"는 느슨함을 수용하게 된다. PR #45는 "미리 잡을 수 있는 건 미리 잡자"는 방향으로 rollback의 트리거 빈도를 줄인다. 이상적으로 auto-rollback은 **진짜로 예측 불가능한 실패**(transient DB / 3rd party API 등)에만 반응해야 한다.

**5. 문서화는 계약이다.** `.env.example`이 `MONGO_NOTICES_DB_NAME`을 빠뜨리고 있었던 건 단순한 실수가 아니라, **서버 팀과 VM 셋업 담당자 사이의 계약이 깨져있었다**는 의미다. 이번 hardening에서 `.env.example`을 REQUIRED/OPTIONAL로 재구성하고 새 변수를 모두 명시한 건 문서화를 넘어 **"이 파일이 진실이다"**라는 contract를 회복한 것.

### 10.7 Residual risk

완전 방어는 없다. 이 3단 방어층이 막지 못하는 시나리오:

- **VM `.env`가 PR 머지 **후**, 첫 배포가 돌기 **전**에 삭제됨** → pre-deploy validation이 잡음 (§3.17 (B))
- **런타임 중 Mongo 연결이 끊김** → auto-rollback 무관, `/health/ready` 뒤로 뜨는 문제 → 기존 monitoring 필요
- **프로덕션 데이터 자체 오염** → 방어 대상 아님, 이건 operational issue
- **pre-deploy validation step 자체가 버그** → 첫 배포 run을 모니터링해야 함 (PR #45 merge 후 확인됨)

### 10.8 Follow-up items

- [x] `.env.example` 문서화 (PR #44 포함)
- [x] strict config (PR #44)
- [x] pre-deploy validation (PR #45)
- [ ] (optional) POSTMORTEM 문서로 incident 분리 — 이 §10이 그 역할을 겸하고 있으므로 당분간 생략
- [ ] (optional) `.env.example` ↔ `lib/config.js` ↔ `jest.setup.js` drift detection을 CI 레벨에 추가 — 세 파일 sync를 수동으로 믿지 않도록. 과도한 복잡도라 당장은 생략
- [ ] (optional) 다른 feature의 required 변수들(Firebase, Naver)을 audit해서 같은 패턴 있으면 strict로 전환
- [ ] (optional) 크롤러 `consecutiveFailures` 모니터링 대시보드

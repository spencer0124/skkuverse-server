---
title: Notices API 아키텍처와 설계 근거
type: explanation
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# Notices API 아키텍처와 설계 근거

> `/notices/*`가 왜 지금의 모양인지 — 요구사항 뒤의 진짜 문제들과, 각 설계 결정의 근거. 엔드포인트 계약은 [reference/notices-api.md](../reference/notices-api.md), 구조적 결정은 [decisions/](../decisions/) ADR들 참조.

> [!NOTE]
> 이 문서는 2026-05-31 NestJS 이관 이후 기준으로 갱신됨. 파일명은 `src/notices/`가 SSOT이며, 여기 언급된 경로는 이해를 돕기 위한 것이지 박제된 진실이 아니다.

## 1. 요구사항과 진짜 문제

### 사용자 관점

사용자가 구독한 학과에서 하나 선택 → 최신 공지 리스트 → 상세. 단순해 보이지만 캠퍼스 환경 특유의 제약이 있다.

- **147개 소스**, crawler strategy 7종, 소스마다 파싱 필드가 다름(`category`/`author`/`views`가 있거나 없음).
- **공지 본문은 시점에 따라 바뀐다** (크롤러 tier1/tier2 변경 감지). 앱은 "수정됨"을 표시해야 한다.
- **요약은 비동기로 붙는다.** 크롤링 직후 `summaryAt: null`, 나중에 AI 요약이 달림. 앱은 "요약 준비 중"을 허용.
- **본문이 없는 공지도 있다.** 상세 fetch 실패, 5MB 초과, 404 → `content: null`. 앱은 원본 링크로 fallback.
- 캠퍼스 와이파이는 공유 IP. IP 기반 rate limit은 금방 한계.

### 서버 관점의 진짜 문제들

표면 요구("리스트 만들어줘")를 넘어 실제로 머리를 쓴 지점들:

| # | 진짜 문제 | 왜 어려운가 |
| --- | --- | --- |
| 1 | 리스트 payload가 쉽게 거대해진다 | `content`는 5MB까지. 리스트에 실수로 포함하면 학과당 수백 KB·MB 응답. |
| 2 | 같은 `crawledAt`의 공지가 배치로 뭉침 | 크롤러가 `insert_many`로 수십 개를 넣으면 tiebreaker 없는 커서는 중복·스킵. |
| 3 | 학과마다 메타데이터가 다름 | wordpress-api 전략은 `category`/`author`가 빈 문자열. `if (item.category)`를 모든 뷰에서 쓸 수 없음. |
| 4 | 크롤러/요약기가 DB에 계속 필드 추가 | 서버가 exclusion projection을 쓰면 새 내부 필드가 자동 노출. |
| 5 | AI `summaryType`이 확장될 수 있음 | 프롬프트가 변해 새 값이 나오면 기존 앱이 깨질 수 있음. |
| 6 | 크롤러 인덱스와 서버 인덱스가 겹침 | 중복 생성 시 `IndexOptionsConflict`, 소유권 불명확. |
| 7 | `sources.json` 같은 UX 메타는 크롤러 관심사 아님 | 크롤러는 selector만 알고 "명륜/율전" 에디토리얼 그룹핑은 모름. |
| 8 | 공유 IP 환경 rate limit | IP 기반은 캠퍼스 공용 와이파이에서 전체가 한 유저처럼 취급됨. |
| 9 | 본문 HTML XSS 위험 | 크롤링 HTML을 그대로 뿌리면 XSS. sanitize 책임 경계가 중요. |
| 10 | 커서가 stale해질 수 있음 | 필터(`type`)를 바꾸면 예전 커서 의미가 달라짐. |
| 11 | 환경변수 누락이 조용히 숨는다 | silent fallback이 dev·CI·prod 차이를 덮음 → 2026-04-10 incident로 실제 발현. [decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md), [internal/2026-04](../internal/2026-04-notices-config-incident.md) 참조. |

## 2. 아키텍처 한 눈

**핵심 원칙: 쓰기는 세 저장소가 각자 소유, 읽기는 서버가 전담.** (구조적 결정 → [decisions/0002](../decisions/0002-notices-read-only-ownership.md))

> 시스템 전체(레포 경계·쓰기 주체)의 canonical 다이어그램은 umbrella [container-view](https://github.com/spencer0124/skkuverse/blob/main/docs/architecture/container-view.md) · [notice-pipeline](https://github.com/spencer0124/skkuverse/blob/main/docs/flows/notice-pipeline.md). 아래는 **서버 읽기·디스패치 경로에 국한된 뷰**이며, upstream writer의 필드·인덱스 정의는 크롤러 [schema/notices.md](https://github.com/spencer0124/skkuverse-crawler/blob/main/docs/reference/schema/notices.md)가 소유한다.

```text
     upstream writers ─ skkuverse-crawler (크롤·정제) · skkuverse-ai (요약)
                        (필드·인덱스 정의는 크롤러 schema/notices.md — 위 링크)
          │ write notices / summary*
          ▼
        ┌──────────────────────────────────────────────┐
        │  MongoDB  skku_notices.notices                │
        └───────────────▲──────────────────────────────┘
                        │ read only
        ┌───────────────┴──────────────────────────────┐
        │  skkuverse-server (NestJS) — src/notices/     │
        │   controller → service → data                 │
        │   read-optimization 인덱스만 소유 (쓰기 X)     │
        │   ensureNoticeIndexes (onModuleInit, 3x retry) │
        └───────────────┬───────────────────▲──────────┘
              GET /notices/*                 │ POST /internal/notices/dispatch-pending
                        │                    │  (크롤러 cycle-end ping, X-Internal-Token)
                        ▼                    │
             skkuverse-app (RN+Expo)   notices-dispatcher.service
                                        → FCM Cloud Function → FCM v1 fan-out
```

- upstream writer(크롤러=문서·unique 인덱스, AI=`summary*` `$set`)의 필드·인덱스 정의는 크롤러 canonical [schema/notices.md](https://github.com/spencer0124/skkuverse-crawler/blob/main/docs/reference/schema/notices.md)가 소유 — 서버 문서는 복제하지 않는다.
- 서버는 **read-optimization 인덱스**만 추가 소유 (`notices-data.service.ts`의 `onModuleInit`에서 idempotent ensure). 쓰기는 절대 안 함.

## 3. 설계 결정의 근거 (미시 결정)

구조적 결정 3건은 ADR로 분리했다: 읽기전용 소유권([0002](../decisions/0002-notices-read-only-ownership.md)), FCM dispatch([0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md)), strict config([0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)). 아래는 나머지 실무 결정의 "왜".

### 응답 envelope: 공통 `{ meta, data }` 유지

공지 API만 다른 envelope으로 바꿀 수도 있었지만 거절. `/ad`, `/bus`, `/search`, `/building` 전부가 공통 응답 형태(`src/common/response.interceptor.ts` + `send-success.ts`)를 쓴다. 새 엔드포인트만 다르면 클라이언트가 두 형태를 알아야 한다. **일관성이 설계보다 이긴다.**

### 커서: `(date, crawledAt, _id)` 트리플

원래는 `(date, crawledAt)` 두 개로 tiebreak하려 했으나, `insert_many` 배치가 같은 millisecond `crawledAt`을 수십 개 만들면 페이지 경계에서 중복·스킵이 난다. `_id` ObjectId를 세 번째 키로:

- `_id`는 배치 내부에서도 고유 → tiebreak 100% 보장.
- 인덱스 suffix `{sourceId:1, date:-1, crawledAt:-1, _id:-1}`에 명시하면 Mongo가 `SORT` 스테이지 없이 `IXSCAN`만으로 처리 → `limit(limit+1)`이 진짜 O(limit).
- ObjectId 12바이트 → 인덱스 오버헤드 무시 가능.

커서 필터는 3-branch `$or`:

```js
{
  $or: [
    { date: { $lt: d } },                                   // 이전 날짜 전부
    { date: d, crawledAt: { $lt: new Date(c) } },           // 같은 날짜, 더 이른 크롤
    { date: d, crawledAt: new Date(c), _id: { $lt: oid } }, // 같은 크롤 배치, 더 작은 _id
  ],
}
```

### `$and` 래핑으로 `date` 충돌 회피

서비스 시작일 필터 `date: {$gte: serviceStartDate}`와 커서 `date: {$lt: d}`가 동일 top-level 키이면 explain plan이 읽기 힘들고 버그 여지가 생긴다. 항상 `$and` 배열로 감싸 명시적 AND — 의도가 쿼리 자체에 문서화됨.

### Inclusion projection (화이트리스트)

`{content: 0, ...}` 제외 방식은 크롤러가 미래에 `internalDebugField`를 추가하면 자동 노출된다. 리스트·상세 둘 다 **inclusion projection**을 `Object.freeze`로 상수화 → DB 스키마와 API 스키마가 코드상 분리. 새 필드 노출은 반드시 명시적 추가.

### `summaryType` 서버측 화이트리스트 정규화

AI 프롬프트는 `action_required | event | informational`을 강제하지만 프롬프트는 변한다. 서버에서 화이트리스트로 검증, 알 수 없는 값은 `informational`로 coerce. 정의는 `transform.service.ts`(순수 로직 `notices.transform.ts`) 단일 소스에서 export — 라우트도 import (중복 정의 방지). 트레이드오프: AI가 진짜 유용한 새 type을 만들어도 짜부라뜨림 — 지원하려면 서버 한 줄 추가.

### 본문은 `contentMarkdown` 단일 경로

초기엔 HTML + plain text를 병행 노출해 렌더 실패 시 fallback했지만, 앱이 네이티브 마크다운 렌더러로 전환하며 dead weight가 됐다. 크롤러가 `cleanHtml → GFM` 변환 파이프라인으로 `cleanMarkdown`을 MongoDB에 쓴다 (평균 1.2KB, max 6.3KB로 payload 부담 작음). 상세는 `cleanMarkdown → contentMarkdown` rename만; `content`/`contentText`/`cleanHtml` 모두 제거. null fallback은 `?? null`(빈 문자열 금지) → 클라이언트가 `sourceUrl`로 분기. **변환 품질 이슈는 서버가 아니라 크롤러가 해결** (크롤러 소유 필드).

### `hasContent` flag 유지

리스트 셀에서 "본문 있는 공지 vs 크롤 실패 공지"를 구분하는 `hasContent = contentHash != null` 신호는 여전히 유용. 본문 필드가 아니라 존재 여부 flag이므로 본문 경로 단일화와 무관하게 유지.

### 리스트 summary는 brief, 상세는 full

리스트 셀에 요약 전체를 넣으면 payload가 크다. `buildSummaryBrief`(3필드: `oneLiner`/`type`/`endAt`) vs `buildSummaryFull`(9필드). Brief `endAt`은 `periods[0]`(가장 이른, 즉 가장 시급한 마감)에서 파생 → list D-day 배지는 항상 1차 기준, 결정론적·캐시 가능. Full의 `periods`/`locations`는 AI 배열 그대로 pass-through (`label` 규칙 유지, 빈 값은 `[]`). 요약 본문 키는 `text`(초기 draft의 `body` 아님) — 클라이언트 타입과 정합.

### Startup 인덱스 생성: 3회 재시도 + `logger.error`

notices는 대형 컬렉션이라 인덱스 없이 full scan이 돌면 DB 부하가 크다. `notices-data.service.ts`의 `onModuleInit`이 최대 3회 재시도(지수 백오프로 transient 흡수), 최종 실패 시 `logger.warn`이 아닌 `logger.error`로 격상(알람 룰이 잡도록), 서버는 계속 기동. 단 이 방어층은 "DB transient"를 막지 startup 전 config crash는 못 막는다 — 후자는 [decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md).

### Firebase Auth는 optional — 그리고 왜 guard가 아니라 middleware인가

공개 API지만 토큰이 있으면 활용한다. optional auth: 토큰 없으면 통과, 있으면 verify + `req.uid` 세팅 + 캐시, 실패 시만 401. Rate limit key는 `req.uid || ip` → 토큰 사용자는 uid 기반이라 캠퍼스 공유 IP 문제 해결.

**NestJS 특유의 함정:** auth를 `@UseGuards`로 붙이면 안 된다. NestJS 실행 순서는 middleware → guards → interceptors → handler인데, rate limit은 express-rate-limit **미들웨어**다. guard는 미들웨어보다 **뒤**에 돌아서, limiter가 key를 만들 때 `req.uid`가 아직 없다 → 캠퍼스 NAT 유저가 한 버킷을 공유해 조기 429, bad-token 초과 요청이 401 대신 429. 그래서 `FirebaseAuthMiddleware`를 **미들웨어로**, `NoticesRateLimitMiddleware`보다 **먼저** 바인딩한다 (`notices.module.ts`의 `configure()`, `forRoutes("notices")`). 이는 Express `app.use("/notices", verifyToken, noticesLimiter, ...)`의 순서를 NestJS에서 재현한 것. `/internal/notices`에는 둘 다 바인딩 안 됨.

### `sources.json` 서버 소유 + UX 메타

크롤러에도 `sources.json`이 있지만 selector 설정용이라 `campus`(명륜/율전)·`category`(대학공통/단과대학/기숙사) 같은 UX 에디토리얼 메타가 없다. 서버가 별도 `src/notices/sources.json`을 vendor: 크롤러에서 `id`/`name` 복사, `strategy`로부터 `hasCategory`/`hasAuthor` 유도, `campus`/`category`는 scaffold 시 null → 이후 수동 개선. **부수 효과:** 이 메타를 채워도 앱 재배포 불필요 — 서버 JSON만 고치면 다음 요청에 반영. 로더는 `sources.service.ts`.

전략→flag 매트릭스 (scaffold 기준):

| strategy | hasCategory | hasAuthor | 학과 수 |
| --- | :-: | :-: | ---: |
| skku-standard | ✓ | ✓ | 134 |
| gnuboard | ✗ | ✓ | 3 |
| custom-php | ✓ | ✗ | 2 |
| jsp-dorm | ✓ | ✗ | 2 |
| gnuboard-custom | ✗ | ✓ | 1 |
| skkumed-asp | ✗ | ✓ | 1 |
| wordpress-api | ✗ | ✗ | 1 |

### ETag / 304

`If-None-Match` 비교는 RFC 7232 준수가 필요 — 클라이언트가 `W/"..."` 약한 ETag, 콤마 리스트, 중복 공백으로 보낼 수 있어 직접 문자열 비교는 부정확. 서버는 `ETag`를 세팅한 뒤 조건부 요청에 304. 정확한 구현은 컨트롤러 참조 (platform-express 기반).

### `isDeleted`: 리스트 숨김 + 상세 404

크롤러가 원본에서 사라진 공지를 `isDeleted: true`로 soft-delete. 리스트·상세 둘 다 `isDeleted: {$ne: true}` 필터 → 단순 404. 이유: 클라이언트 캐시 무효화가 자연스러움(404 → `removeQueries`), 복잡도 최소. tombstone(캐시 본문 + "삭제됨" 배지)은 필요해지면 나중에 flag로 추가.

### Type 필터와 커서: 커서는 필터 무관

`type=event`로 페이지네이션하다 필터를 바꾸면? 커서에 type을 인코딩해 불일치 시 400을 낼 수도 있었지만, 커서는 filter-agnostic으로 유지 — `(date, crawledAt, _id)`만. type을 바꿔도 accept(일부 skip 가능). 완화: 앱 UX상 필터 변경 = 리스트 리셋이 관례.

## 4. 개발 방법론: TDD

이 기능은 TDD로 작성됐다 (안쪽 순수 함수 → 바깥쪽 라우트 순서). transform/cursor 같은 순수 로직을 Mongo 의존 없이 먼저 테스트하고, data 레이어는 Mongo chain mock, 컨트롤러는 supertest로 커버. 현재 테스트 수·coverage threshold는 `jest.config.js`와 테스트 스위트가 SSOT (박제하지 않음).

**TDD가 실제로 잡은 버그:**

- `Buffer.from(str, "base64url")`가 garbage 입력에 throw하지 않고 깨진 바이트를 반환 → 테스트가 이 경로를 명시해 `JSON.parse` 단계에서 `InvalidCursorError`로 변환하는 구조가 자연스럽게 나옴.
- `hasMore` 계산 시 `slice(0, limit)` **이후**의 마지막 아이템을 커서 시드로 써야 함 → 테스트가 "cursor points to items[1] not docs[2]"를 명시해 잡음.
- `summary: null`이 `undefined`가 아니어야 한다는 invariant → transform 테스트가 `toBeNull()`로 명시.

## 5. 다음에 생각해 볼 것들 (현재 범위 밖)

1. **전체 최신순 피드** (`/notices/feed`) — 학과 무관. `{date:-1, crawledAt:-1, _id:-1}` 인덱스 필요.
2. **검색** (`?q=`) — `title`/`contentText` text 인덱스 + 한국어 tokenization. (검색 파라미터 검증은 `search.service.ts`에 이미 존재.)
3. **`campus`/`category` 채우기** — 일부 sources는 여전히 null. 수동 점진 작업.
4. **`isDeleted` tombstone UX** — 현재 404 숨김. 사용자 피드백 있으면 전환 고려.
5. **상세 prefetch 정책** — 앱이 viewport 기반 prefetch를 켜면 상세 QPS 수배 증가.
6. **응답 압축** — 상세 응답이 커지면 `compression` 검토.
7. **크롤러 `consecutiveFailures` 모니터링** — `hasContent: false` 학과 주기 확인 (운영 업무).

## 관련 문서

- [reference/notices-api.md](../reference/notices-api.md) — 엔드포인트 계약
- [decisions/0002](../decisions/0002-notices-read-only-ownership.md) · [0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) · [0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)
- [internal/2026-04-notices-config-incident.md](../internal/2026-04-notices-config-incident.md) — config crash 포스트모템

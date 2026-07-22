---
title: Notices API 계약
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# Notices API 계약

> `/notices/*` 읽기 전용 엔드포인트 + `/internal/notices/*` dispatch 트리거의 요청·응답 계약. 설계 근거는 [explanation/notices-architecture.md](../explanation/notices-architecture.md), FCM dispatch 결정은 [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) 참조.

> [!NOTE]
> 응답 envelope은 서버 공통 `{ meta, data }` 형태 (`src/common/response.interceptor.ts` + `src/common/send-success.ts`). 모든 엔드포인트가 이 형태를 공유한다.

## 요약

| Method | Path | 인증 | 용도 |
| --- | --- | --- | --- |
| GET | `/notices/tabs` | optional | 서버 주도 탭 구성 |
| GET | `/notices/source/:sourceId` | optional | 단일 소스 공지 리스트 (커서 페이지네이션) |
| GET | `/notices` | optional | 다중 소스 병합 리스트 (`?sourceIds=`) |
| GET | `/notices/proxy/attachment` | optional | 첨부파일 프록시 |
| GET | `/notices/:sourceId/:articleNo` | optional | 공지 상세 |
| POST | `/internal/notices/dispatch-pending` | X-Internal-Token | 크롤러 ping → FCM dispatch sweep |

정식 라우트 정의는 컨트롤러가 SSOT: `src/notices/notices.controller.ts` (`@Controller("notices")`), `src/notices/notices.internal.controller.ts` (`@Controller("internal/notices")`).

## 공통 규칙

- **인증:** optional Firebase auth. 토큰 없으면 통과, 있으면 verify 후 `req.uid` 세팅, 실패 시에만 401. `src/common/firebase-auth.middleware.ts`를 미들웨어로 `/notices` 경로에 바인딩 (rate-limit보다 먼저 — 근거는 explanation 참조). `/internal/notices`는 Firebase auth·rate limit 모두 없음.
- **Rate limit:** `keyGenerator = req.uid || ip`. 토큰 사용자는 uid 기반이라 캠퍼스 공유 IP 문제 회피. `src/notices/rate-limit/notices-rate-limit.middleware.ts`.
- **로컬라이즈:** `Accept-Language`로 `label` 등 로컬라이즈 (ko/en, zh → en fallback).

## GET /notices/tabs

서버 기반 탭 구성. 앱의 공지 탭 UI를 이 응답으로 렌더링. `categories.json` + `sources.json`(둘 다 `src/notices/`)을 조합.

- `Cache-Control: private, max-age=3600`
- 배열 순서 = 탭 표시 순서
- Tagged payload: `tabMode: "fixed"` → `fixed: { sourceId, name, campus }`, `tabMode: "picker"` → `picker: { sources, maxSelection, defaultIds, campusDefaultIds }`
- 앱이 모르는 `tabMode` → 해당 탭 skip (forward compat)
- `schemaVersion`으로 클라이언트가 스키마 호환성 판단

```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "schemaVersion": 1,
    "tabs": [
      {
        "key": "dept", "label": "학과", "tabMode": "picker",
        "picker": {
          "sources": [
            { "id": "arch", "name": "건축학과", "campus": "nsc", "college": "공과대학",
              "noticeAvailable": true, "excludeReason": null }
            // ... ~125개
          ],
          "maxSelection": 5,
          "defaultIds": [],
          "campusDefaultIds": {}
        }
      },
      {
        "key": "academic", "label": "학사", "tabMode": "fixed",
        "fixed": { "sourceId": "skku-notice02", "name": "성균관대_통합(학사)", "campus": "both" }
      }
      // ... 9개 탭 (categories.json: dept, academic, scholarship, career, recruitment, event, library, dorm, general)
    ]
  }
}
```

> [!NOTE]
> 구 `GET /notices/sources`는 2026-04-15 삭제. 학과 목록은 `/notices/tabs`의 picker 탭 `sources` 배열에 포함된다.

## GET /notices/source/:sourceId

쿼리: `cursor` (base64url), `limit` (1~50, default 20), `type` (optional: `action_required | event | informational`), `q` (optional 검색어).

```jsonc
{
  "meta": { "lang": "ko", "count": 2 },
  "data": {
    "notices": [
      {
        "id": "69d2024f8e7a44b79c89f936",
        "sourceId": "skku-main",
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

- **리스트 summary는 brief** (3필드: `oneLiner`, `type`, `endAt`). full summary는 상세에서만.
- **`endAt` 파생:** `summaryPeriods[0]`의 `endDate`/`endTime`에서 `{ date, time } | null`. 다중 phase 공지는 `periods[0]`(가장 이른 마감) 기준 D-day. 결정론적(now() 무의존).
- **커서는 filter-agnostic** — `(date, crawledAt, _id)` 트리플만 인코딩. `type`을 바꿔도 accept (일부 skip 가능 → 클라이언트가 필터 변경 시 리스트 리셋).

## GET /notices (다중 소스)

`?sourceIds=a,b,c` + 위와 동일한 `limit`/`type`/`cursor`/`q`. 여러 소스를 병합해 최신순 리스트 반환. 정식 파라미터·응답 shape은 `src/notices/notices.controller.ts`의 `@Get()` 핸들러가 SSOT.

## GET /notices/proxy/attachment

`?url=&referer=&mode=&name=` — 원본 첨부파일을 프록시. 정식 계약은 `notices.controller.ts`의 `@Get("proxy/attachment")` 참조.

## GET /notices/:sourceId/:articleNo

```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "...",
    "sourceId": "skku-main",
    "articleNo": 136023,
    "title": "...",
    "contentMarkdown": "**[모집] 2026 학생 창업유망팀 300+ ...**\n\n성균인 여러분 ...",
    "attachments": [{ "name": "...", "url": "..." }],
    "sourceUrl": "...",
    "editInfo": { "count": 2, "history": [] },
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

- **본문은 `contentMarkdown` 단일 경로.** `content`/`contentText`/`cleanHtml` 미노출. `contentMarkdown == null`이면 클라이언트는 `sourceUrl` 외부 링크로 fallback (빈 문자열 아님, `null`).
- **full summary는 9필드**: brief 3개 + `text`, `periods`, `locations`, `details`, `model`, `generatedAt`.
- **ETag/304:** `If-None-Match` 지원. 서버는 `ETag` 세팅 후 조건부 요청에 304.
- `isDeleted` 문서는 404.

## POST /internal/notices/dispatch-pending

크롤러가 크롤 cycle 끝에 호출하는 내부 엔드포인트. Firebase auth·rate limit 없이 `X-Internal-Token` 공유 비밀로 constant-time 검증 (`INTERNAL_DISPATCH_TOKEN`).

- **동작:** pending 공지를 sweep → claim-lease → FCM Cloud Function 호출로 fan-out. dispatch는 비동기 진행이라 응답이 빠르다.
- **응답:** sweep 결과 카운트 (`swept`/`dispatched`/`skipped` 계열). 정식 요청 body·응답 필드는 `src/notices/notices.internal.controller.ts`가 SSOT.
- dispatch 메커니즘(claim-lease, safety-net poller, retry/abandon)은 [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md).

## 에러 코드

| HTTP | code | 상황 |
| --- | --- | --- |
| 400 | `INVALID_SOURCE_ID` | `sources.json`에 없는 sourceId |
| 400 | `INVALID_PARAMS` | articleNo 숫자 아님, limit 범위 초과, 알 수 없는 type |
| 400 | `INVALID_CURSOR` | base64url 디코딩·JSON 파싱·shape 검증 실패 |
| 401 | `AUTH_INVALID` | 토큰 검증 실패 (optional auth — 토큰 없으면 401 아님) |
| 404 | `NOT_FOUND` | 존재하지 않거나 isDeleted |
| 429 | `RATE_LIMIT` | rate limit 초과 |

## 소스 오브 트루스 (파일 맵)

정확한 파일명·개수는 코드가 SSOT다 (값 복사 금지 규칙). notices feature는 `src/notices/` 아래 **NestJS 컨트롤러 + service 래퍼 + 순수 로직 모듈** 패턴:

| 책임 | 위치 |
| --- | --- |
| 클라이언트 라우트 | `notices.controller.ts` |
| 내부 dispatch 라우트 | `notices.internal.controller.ts` |
| DB 읽기·인덱스·프로젝션 | `notices-data.service.ts` |
| 리스트/상세 transform, summary brief/full | `transform.service.ts` (순수 로직 `notices.transform.ts`) |
| 커서 encode/decode/filter | `cursor.service.ts` (순수 로직 `notices.cursor.ts`) |
| FCM dispatch (sweep·claim·call) | `notices-dispatcher.service.ts` |
| dispatch safety-net cron | `notices-dispatch.poller.service.ts` |
| 탭 구성 로더 + startup 검증 | `tabconfig.service.ts` / `tabconfig.provider.ts` |
| 소스 레지스트리 + version | `sources.service.ts` / `sources.json` |
| 탭 카테고리 정의 | `categories.json` |
| DI 와이어링·미들웨어 바인딩 | `notices.module.ts` |

## 관련 문서

- [explanation/notices-architecture.md](../explanation/notices-architecture.md) — 설계 근거·아키텍처
- [decisions/0002](../decisions/0002-notices-read-only-ownership.md) — 읽기전용 소유권
- [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) — FCM dispatch
- [how-to/verify-notices-changes.md](../how-to/verify-notices-changes.md) — 변경 검증 체크리스트

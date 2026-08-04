---
title: Notices 변경 검증하기
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# Notices 변경 검증하기

> `/notices/*` 관련 코드를 고친 뒤 머지·배포 전에 돌리는 검증 절차. 계약은 [reference/notices-api.md](../reference/notices-api.md) 참조.

## 사전 준비

- 로컬 `.env`에 notices 관련 required 변수 세팅 (누락 시 strict config가 crash — [decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)). 목록은 `.env.example`의 REQUIRED 섹션이 SSOT.
- dev DB(`skku_notices_dev` 계열) 접근 가능.

## 정적 검증

```bash
npm run typecheck   # tsc --noEmit (src + test)
npm run lint        # eslint + markdownlint (lint:md 체인)
npm test            # jest — notices 스위트 포함
```

- 테스트는 transform/cursor/data/controller/dispatcher/tabConfig를 커버. 커서 round-trip, `InvalidCursorError`, `summary: null` invariant 등이 회귀 방지.
- coverage threshold는 `jest.config.js`가 SSOT.

## 런타임 스모크 (dev DB 대상)

서버 기동 후:

1. `GET /notices/tabs` — 9개 탭 + picker `sources` 반환, `Accept-Language` 로컬라이즈 확인.
2. `GET /notices/source/<sourceId>?limit=2` → `nextCursor` 받기 → 같은 커서로 재요청 → 중복·스킵 없이 다음 페이지.
3. `GET /notices/<sourceId>/<articleNo>` — `contentMarkdown` 존재, legacy `content`/`contentText`/`cleanHtml` **미노출**.
4. 에러 경로: 없는 `articleNo` → 404, 없는 `sourceId` → 400(DB 호출 없이 즉시), 알 수 없는 `type` → 400, 깨진 `cursor` → 400.
5. `If-None-Match`로 조건부 요청 → 304.

## 인덱스 소유권 확인

- 서버 read-only 인덱스 `sourceId_1_date_-1_crawledAt_-1__id_-1`가 실제 생성됐는지 (MongoDB 조회).
- 크롤러 소유 `articleNo_1_sourceId_1` unique 인덱스를 **건드리지 않았는지** — 서버는 이 인덱스에 손대면 안 된다 ([decisions/0002](../decisions/0002-notices-read-only-ownership.md)).

## dispatch 변경 시 추가 확인

`notices-dispatcher.service.ts` / poller / internal controller를 고쳤다면:

- `POST /internal/notices/dispatch-pending`에 `X-Internal-Token`으로 호출 → sweep 카운트 응답.
- claim-lease 동시성: 같은 후보를 두 번 sweep해도 두 번 발송 안 됨 (lease 유효).
- config 변경(dispatch 상수·FCM URL)이면 배포 전 pre-deploy dry-load가 잡는지 확인 ([decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)).

## 관련 문서

- [reference/notices-api.md](../reference/notices-api.md) — 엔드포인트 계약
- [explanation/notices-architecture.md](../explanation/notices-architecture.md) — 왜 이렇게 검증하는가

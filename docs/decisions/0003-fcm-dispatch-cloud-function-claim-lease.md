---
title: FCM Dispatch — Cloud Function 위임 + claim-lease
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# 0003. FCM Dispatch — Cloud Function 위임 + claim-lease

## Status

Accepted — 2026-05 (백필 문서화 2026-07-22)

## Context

새 공지 발생 시 구독자에게 push를 보내야 한다. 두 가지 옵션:

1. **서버가 직접 발송** — FCM Admin SDK로 device token 관리·batch 분할·error 분류·retry를 서버 안에서.
2. **서버는 trigger만, 발송은 다른 서비스** — 책임 분리.

추가 제약: 사용자 device token / 구독 / 알림 설정은 **이미 Firestore에 있고 앱이 직접 쓴다**. 그리고 api-1, api-2, poller 세 컨테이너가 동시에 같은 공지를 push할 수 있다 (특히 크롤러 ping이 두 API replica 모두에 도달 가능).

## Decision

**옵션 2 채택.** Firebase Cloud Function이 Firestore `devices`(`active=true` + `subscribedTopics`)를 조회해 FCM v1을 실제 발송한다. 서버는 *어떤 공지를 push할지*만 결정하고 HTTPS로 Cloud Function 호출(`FCM_FUNCTION_URL` + `FCM_API_KEY`).

**Trigger 경로 (2단):**

1. **Primary:** 크롤러가 cycle 끝(기본 30분)에 `POST /internal/notices/dispatch-pending`(`X-Internal-Token`) → `notices.internal.controller.ts` → `notices-dispatcher.service.ts`의 sweep.
2. **Safety net:** `notices-dispatch.poller.service.ts`가 env-gated(`DISPATCH_SWEEP_ENABLED`) cron으로 같은 sweep 실행 — 크롤러 ping 누락 대비. `@Global` SchedulingModule의 PollerRegistry에 등록.

**Claim-lease로 중복 발송 차단:** Mongo `claimedAt` 필드로 5분 lease. dispatcher가 후보를 가져올 때 `claimedAt` 미설정 또는 5분 경과분만 선택 후 곧장 자기 ID로 stamp. 다른 컨테이너가 같은 후보를 보면 lease 유효해 skip.

**Retry & 폐기:** `pushAttempts >= maxAttempts(5)` 필터로 5회 실패분 자동 제외. `maxAgeMs=24h` 넘은 공지는 통째 abandon(long outage 후 stale push 폭주 방지). `sweepBatchCap=200`으로 틱당 blast radius cap.

## Consequences

- (+) 서버는 stateless 유지 — push 실패가 서버 프로세스를 흔들지 않음.
- (+) Firestore 진실(token/구독)을 서버 MongoDB로 복제할 필요 없음 — 두 진실 동기화 부담 제거.
- (+) FCM batch 분할·retry·로깅이 Firebase 생태계 native.
- (+) claim-lease로 multi-replica·poller 동시성에서 중복 발송 방지.
- (−) 서버·Cloud Function·크롤러 3자에 dispatch 관심사가 분산 — 경로 추적이 한 파일에 없음.
- (−) `crawledAt` 같은 실제 doc 필드명에 의존(초기에 `createdAt`을 쿼리해 0건 나온 incident 있었음, commit `7c6944e`) — prod doc shape을 가정하지 말고 sample로 검증할 것.
- 설정 상수(`claimLeaseMs`, `maxAgeMs`, `maxAttempts`, `sweepBatchCap`, `sweepCronIntervalMs`)의 현재 값은 `src/config`의 notices dispatch 설정이 SSOT.
- FCM 아키텍처 전체(앱 측 device 등록, topic 파생)는 sibling 레포 `skkuverse-app`의 `docs/explanation/fcm-architecture.md` 참조.

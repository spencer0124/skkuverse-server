---
title: 교차 게시 공지는 회차 내 content 그룹으로 1회만 발송
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-04
audience: internal
---

# 0005. 교차 게시 공지는 회차 내 content 그룹으로 1회만 발송

## Status

Accepted — 2026-08-04 ([issue #75](https://github.com/spencer0124/skkuverse-server/issues/75)).

## Context

성균관대 CMS는 **하나의 글을 여러 게시판 뷰로 동시에 노출**한다. 크롤러가 소유한 `(articleNo, sourceId)` unique 인덱스([0002](0002-notices-read-only-ownership.md)) 때문에 그 글은 Mongo 문서 N개가 되고, dispatcher가 **문서 단위로** Cloud Function을 N번 호출했다. 두 게시판을 함께 구독한 유저는 같은 글 알림을 N번 받았다.

prod(`skku_notices.notices`, 6,868 docs) 실측(2026-08-04)으로 확인한 것:

- 교차 게시 계열이 **둘**이다. 이슈에 보고된 통합게시판 **8-way**(`skku-main` + `skku-notice02~08`)와, **이슈에 없던 단과대/학과 보드 16-way**(`art·sscience·scos·liberalarts·coe·ecostat·sport·cscience` × `undergrad`+`grad`). 예: articleNo 159941.
- 형제 문서는 `title`·`contentHash`가 **완전히 일치**한다. 같은 CMS의 필터 뷰라 HTML이 byte-identical이고 `contentHash`는 크롤러가 저장하는 그 HTML의 sha256이다.
- 형제는 5~15초 안에 함께 크롤된다 (같은 사이클).
- CF는 topic 목록으로 `devices.where('subscribedTopics','array-contains-any', topics)` **단일 쿼리**를 돌린다 — 기기가 여러 topic을 구독해도 1번만 반환된다. **즉 호출을 1회로 합치면 중복이 생길 자리가 없다.** 중복은 topic을 N번의 호출로 쪼갠 것이 원인이었다.

## Decision

**같은 sweep 회차 안에서 `title`(trim) + `contentHash`가 완전히 일치하는 문서를 한 그룹으로 묶어, topic union으로 CF를 1번만 호출한다.** (`src/notices/notices.dedup-key.ts` + `notices-dispatcher.service.ts`의 `dispatchGroup`)

- **content 기반이라 소스별 분기가 없다.** 8-way·16-way는 물론 내일 새로 생기는 교차 게시 보드도 코드 변경 없이 잡힌다. 크롤러 변경 0, 스키마·인덱스·필드 추가 0.
- **완전 일치만 병합한다.** 퍼지 매칭 없음. `contentHash`가 없으면(상세 fetch 실패) `_id` 기반 identity 키로 떨어져 1인 그룹이 된다 — 추측해서 병합하느니 병합을 포기한다. **오탐으로 정상 공지를 삼키는 것이 중복 알림보다 나쁘다.**
- sweep은 **claim을 모두 끝낸 뒤 그룹핑**한다. 기존처럼 한 건씩 claim→발송하면 형제를 보기 전에 이미 발송돼 병합이 불가능하다. `sweepBatchCap`은 여전히 **문서 수** 상한(그룹 수 아님)이라 blast radius는 그대로다.
- **`TOPIC_CAP` 10 → 30, CF `MAX_TOPICS` 10 → 30** (cross-repo 계약, 두 값은 항상 같아야 한다). 16-way 그룹의 union은 16 topics인데, 병합 전에는 문서마다 1-topic 호출이라 cap에 닿지 않았다. **병합이 이 문제를 새로 만든다** — 10에서 자르면 6개 학과 구독자가 조용히 누락되어, 중복 알림 버그가 미수신 버그로 바뀐다. 30은 Firestore `array-contains-any`의 실제 한도이며 기존 10은 CF 자신의 주석대로 "MVP conservative limit"이었다.

### 기각한 대안

| 대안 | 기각 사유 |
| --- | --- |
| `notice_dispatch_log` 이력 컬렉션 + canonical key | 회차 밖 형제까지 잡지만 새 컬렉션·마이그레이션·정합성 관리 비용이 증상 대비 과하다. 로그로 실측한 뒤 필요해지면 재검토 |
| 교차 게시 family를 상수로 하드코딩 | 보드가 늘 때마다 서버 배포가 필요하고, 16-way 계열처럼 아무도 모르던 family를 놓친다 |
| 크롤러가 canonical 문서 1개만 저장 | `(articleNo, sourceId)` 소유권([0002](0002-notices-read-only-ownership.md))과 소스별 탭 목록 기능을 동시에 깬다 |
| CF를 그대로 두고 topic을 ≤10씩 쪼개 여러 번 호출 | 쪼갠 호출이 곧 중복의 원인 — 16-way가 16번 대신 2번이 될 뿐 |

## Consequences

- (+) 8-way·16-way 교차 게시가 알림 **1건**으로 수렴. CF 호출 수도 같은 비율로 감소.
- (+) `skku-main`(topic 없음)이 형제 그룹에 자연 편입 — 별도 claim+skip 1회를 낭비하지 않는다.
- (+) 서버 단독 롤백 가능 (스키마·컬렉션·인덱스 변화 없음).
- (−) **배포 순서가 강제된다**: CF(`MAX_TOPICS` 30)를 **먼저** 배포해야 한다. 역순이면 >10 topic payload가 400을 받고 `pushAttempts` 5회까지 재시도 후 영구 실패한다.
- (−) **늦은 형제는 다시 발송된다** — 형제가 다음 회차에 도착하면(요약 실패 후 재시도, `sweepBatchCap` 분할, 며칠 뒤 추가 게시) 한 번 더 간다. 실측상 교차 게시 그룹의 **~30%**가 5분 초과 spread(6월 5/18, 7월 11/36). **N번 → 대부분 1번, 일부 2번**으로 개선되는 것이며, 영속 dedup은 의도적으로 미루었다.
- (−) **교차 replica sweep race**: ping(api replica)과 30분 poller cron이 겹치면 그룹이 쪼개질 수 있다. `sweepInFlight`는 프로세스 내부만 방어. 결과는 위 한계와 동일.
- (−) **딥링크는 대표 1개 소스를 가리킨다.** rep은 topic을 기여하는 member 중 sourceId 최소값이라, 다른 보드 구독자도 그 사본으로 열린다. 병합 조건이 hash 일치이므로 내용은 동일.
- (−) **CMS가 다른 재게시**(markup이 다른 경우)는 hash 불일치로 안 잡힌다. 완전 일치 원칙의 의도된 결과. 실측상 형제 hash 불일치는 504그룹 중 4건(0.8%, 게시 후 수정된 경우).

## 관측

`sweepPending` 요약에 additive 필드 2개를 추가했다 — 크롤러 `_extract_summary`는 `processed/sent/failed`만 읽으므로 호환된다.

- `cfCalls` — 실제 CF 호출 수
- `dedupedDocs` — 병합으로 절약한 호출 수 (`sent` − 발송 그룹 수)
- 병합 시 `[dispatch] group merged { memberCount, sourceIds, topicCount, title }` 로그

배포 후 이 값들로 실제 병합률과 "늦은 형제" 빈도를 측정하고, 예상(~30%)보다 나쁘면 영속 dedup을 별도 이슈로 올린다.

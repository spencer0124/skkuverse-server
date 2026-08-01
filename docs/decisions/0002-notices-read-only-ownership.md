---
title: Notices — 서버는 읽기 전용, 쓰기는 크롤러·AI 소유
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# 0002. Notices — 서버는 읽기 전용, 쓰기는 크롤러·AI가 소유

## Status

Accepted — 2026-04-10 (백필 문서화 2026-07-22)

## Context

`notices` MongoDB 컬렉션은 여러 서비스가 함께 만진다. 소유권이 불명확하면 두 종류의 사고가 난다:

- **인덱스 충돌:** 크롤러가 `articleNo_1_sourceId_1` unique 인덱스를 이미 만든다. 서버도 같은 인덱스를 `createIndex`하면 `IndexOptionsConflict`. 크롤러가 삭제하고 서버가 다시 만들면 크롤러 쓰기 성능을 망칠 수도.
- **XSS 책임 경계 모호:** 크롤링한 HTML을 어디서 sanitize할지 정하지 않으면, 서버가 재정제하거나 아무도 안 하거나 둘 다 하는 상황이 생긴다.

동시에 `content`는 5MB까지 가능하고, 크롤러·요약기가 언제든 새 필드를 추가할 수 있어, 서버가 컬렉션 스키마에 강결합되면 취약해진다.

## Decision

**쓰기는 세 저장소가 각자 소유, 읽기는 서버가 전담.**

- **크롤러**가 문서 자체와 unique 인덱스(`articleNo_1_sourceId_1`)를 소유. 서버는 이 인덱스를 건드리지 않고 상세 조회(`findOne`)에서 그대로 히트.
- **skkuverse-ai**가 `summary*` 필드를 `$set`으로 소유.
- **서버**는 **read-optimization 복합 인덱스**(`sourceId_1_date_-1_crawledAt_-1__id_-1`) 하나만 추가 소유. 컬렉션에 **절대 쓰지 않는다**. `src/notices/notices-data.service.ts`의 `onModuleInit`에서 idempotent하게 ensure.
- **정제(sanitize)는 크롤러 담당.** 크롤러가 `nh3`로 sanitize + GFM `cleanMarkdown`까지 변환해 저장하고, 서버는 `cleanMarkdown → contentMarkdown` rename만 하는 pass-through. HTML·plain 본문은 API에 노출하지 않으므로 서버 레이어의 XSS 공격 표면이 사라진다 — 앱의 마크다운 렌더러가 자체 sanitize 책임.

## Consequences

- (+) 인덱스 소유권이 명확 — 충돌 불가, 각자 자기 인덱스만 관리.
- (+) 서버가 stateless read-only라 배포·롤백이 안전 (쓰기 사이드이펙트 없음).
- (+) XSS 방어가 한 곳(크롤러)에 모여 감사 표면이 작다.
- (−) **크롤러와의 암묵 계약이 생긴다.** 크롤러가 `cleanMarkdown` 변환 정책·필드명을 바꾸면 서버 응답이 조용히 깨질 수 있다. 이 경계는 두 repo가 합의해야 하며, 변경 시 [reference/notices-api.md](../reference/notices-api.md)의 응답 계약과 대조 필요.
- (−) 본문 변환 품질 이슈(GFM 테이블 misalign 등)를 서버에서 못 고친다 — 크롤러에서만 수정.
- 관련 미시 결정(inclusion projection, `contentMarkdown` 단일 경로)은 [explanation/notices-architecture.md](../explanation/notices-architecture.md) 참조.

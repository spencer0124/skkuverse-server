---
title: Notices API 아키텍처 (분할됨)
type: explanation
status: superseded
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# Notices API 아키텍처 — 분할됨

> [!WARNING]
> 이 문서는 2026-07-22 Diátaxis 구조 도입([decisions/0001](decisions/0001-adopt-diataxis-docs-structure.md))으로 독자 니즈별 5개 문서로 분할됐다. 아래 매핑을 따라가라. 전체 원문은 git 히스토리에 보존.

이 파일(구 794줄)은 reference·explanation·ADR·how-to·postmortem을 한 곳에 섞고 있었고, 2026-05-31 NestJS 이관 이후 Express 레이아웃 drift가 누적되어 있었다. 다음으로 분할하며 drift를 함께 수정했다:

| 원래 섹션 | 이동한 곳 |
| --- | --- |
| §1 요구사항·진짜 문제, §2 아키텍처, §3 미시 설계결정, §6 TDD, §7 향후 | [explanation/notices-architecture.md](explanation/notices-architecture.md) |
| §4 엔드포인트 스펙, §4.5 에러 코드, §5 파일 맵 | [reference/notices-api.md](reference/notices-api.md) |
| §2 소유권 원칙 + §3.9 인덱스 + §3.13 정제 경계 | [decisions/0002-notices-read-only-ownership.md](decisions/0002-notices-read-only-ownership.md) |
| §3.18 FCM dispatch | [decisions/0003-fcm-dispatch-cloud-function-claim-lease.md](decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) |
| §3.17 strict config + pre-deploy | [decisions/0004-strict-config-pre-deploy-dry-load.md](decisions/0004-strict-config-pre-deploy-dry-load.md) |
| §8 검증 체크리스트 | [how-to/verify-notices-changes.md](how-to/verify-notices-changes.md) |
| §10 2026-04-10 incident retrospective | [internal/2026-04-notices-config-incident.md](internal/2026-04-notices-config-incident.md) |

전체 문서 인덱스는 [docs/README.md](README.md).

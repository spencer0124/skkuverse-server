---
title: 2026-04 Notices 최초 배포 config crash 포스트모템
type: postmortem
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# 2026-04-10 Notices 최초 배포 config crash 포스트모템

> notices API 최초 배포(PR #43)가 프로덕션에서 crash loop → auto-rollback으로 실패한 사건과 후속 hardening의 기록. 여기서 나온 구조적 결정은 [decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md).

> [!NOTE]
> 이 사건은 **Express 코드베이스**(2026-05-31 NestJS 이관 이전)에서 발생했다. 아래 파일 경로(`lib/config.js`, `index.js`, `devDbName` 등)와 엔드포인트(`/notices/sources`)는 **당시 기준**이며 의도적으로 역사 그대로 보존한다. 현행 config 검증은 `src/config/env.validation.ts` 계열로 이관됨.

| 항목 | 값 |
| --- | --- |
| Date | 2026-04-10 |
| Status | Resolved (당일 복구 + 구조적 hardening 완료) |
| Detection | CI/CD deploy job 실패 (auto-rollback 발동) |
| Trigger | PR #43 머지 → 배포 |
| Root Cause | `required` config에 `notices.dbName` 추가했으나 VM `.env`에 대응 env var 미설정 → `process.exit(1)` crash loop |

## TL;DR

`lib/config.js`의 `required` 배열에 `notices.dbName`을 추가했지만 프로덕션 VM `.env`에 `MONGO_NOTICES_DB_NAME`이 없었다. 프로덕션 컨테이너가 startup에서 `process.exit(1)` → crash loop → `/health/ready` 30초 timeout → auto-rollback(PR #42). 프로덕션은 이전 커밋으로 안전하게 되돌아갔고(notices 없는 상태), SSH로 VM `.env`에 변수 2개를 append + rerun하여 9분 만에 복구. 이후 PR #44(strict config) + #45(pre-deploy dry-load)로 같은 class의 실수를 구조적으로 차단.

## Impact

- 프로덕션 다운타임 없음 — auto-rollback이 이전 안정 커밋(`2b836e5`)을 유지.
- notices 엔드포인트가 최초 배포~복구(약 20분) 동안 프로덕션에 부재.
- 데이터 오염 없음 (crash가 쓰기 전에 발생).

## Timeline (UTC)

| 시각 | 이벤트 |
| --- | --- |
| 06:48 | PR #43 main에 merge → CI/CD 자동 트리거 |
| 06:49 | test 18초 success, deploy job 시작, 새 `api-1` 컨테이너 시작 |
| 06:49:25 ~ 55 | **30초간 `/health/ready` 6회 시도 모두 실패** (crash loop) |
| 06:49:55 | `rollback()`: `git checkout 2b836e5`, 세 컨테이너 재빌드·재시작 |
| 06:50:13 | rollback 컨테이너 healthy, 워크플로우는 원래 실패로 exit 1 |
| ~07:07 | Root cause 특정: `required`에 `notices.dbName` 추가했는데 VM `.env`에 `MONGO_NOTICES_DB_NAME` 없음 |
| 07:07 | `ssh oracle` → VM `.env` 백업 후 append (`MONGO_NOTICES_DB_NAME`, `NOTICES_SERVICE_START_DATE`) → git state 정리 |
| 07:08 | `gh run rerun --failed` |
| 07:09 | **deploy GREEN (48초)**, notices 엔드포인트 live |
| 07:10 | smoke test 통과 |
| 07:42 | PR #44 (strict config) merge → success |
| 07:53 | PR #45 (pre-deploy validation) merge → success (새 validation step 첫 실행 확인) |

## Root Cause — 실행 경로 (프로덕션 컨테이너 안)

1. `NODE_ENV=production`, `isDevelopment=false`, `isTest=false`
2. `process.env.MONGO_NOTICES_DB_NAME` → `undefined` (VM `.env`에 없음)
3. `devDbName(undefined)` → `undefined`
4. `config.notices.dbName` → `undefined`
5. `required.filter(([, v]) => !v)` → `[["notices.dbName", undefined]]`
6. `console.error("Missing required config: notices.dbName")` → `process.exit(1)` → 컨테이너 death
7. Docker `unless-stopped` → 즉시 재시작 → 동일 지점 die → crash loop
8. 30초간 `/health/ready` 무응답 → `ci/retry-and-auto-rollback`(PR #42) rollback 발동

## 왜 테스트·CI·로컬에서 안 잡혔나

다섯 단계의 안전망을 동시에 통과한 게 진짜 교훈:

- **로컬:** smoke test 전 로컬 `.env`에 `MONGO_NOTICES_DB_NAME`을 추가해 뒀음 → 통과.
- **CI test:** `if (!isTest) process.exit(1)` 가드로 `NODE_ENV=test`에선 crash가 suppress → `console.error`만 찍히고 통과.
- **`.env.example`:** `MONGO_NOTICES_DB_NAME`이 문서화 안 됨 → VM 셋업 참조처 부재.
- **VM `.env`:** 수동 관리. 로컬에만 추가하고 VM은 안 건드림.

이 중 어느 하나라도 "새 required var 선언됨"을 감지했다면 incident는 없었다. 이게 strict validation + 동기화 계약의 근거.

## Resolution

**Immediate (코드 변경 없음):** 프로덕션 rollback 상태가 안정적이라, PR 절차 대신 SSH로 VM `.env`에 변수 append(백업 후) + `gh run rerun --failed`. 긴급 복구엔 이게 빠르고 리스크 작다고 판단.

**Long-term:** [decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)의 3단 방어 — strict config(#44) + pre-deploy dry-load(#45) + 기존 auto-rollback(#42).

## What went well / wrong

**Well:** auto-rollback(PR #42)이 프로덕션을 보호. 복구가 20분 내. 데이터 오염 0.

**Wrong:** silent fallback이 dev·CI·prod 차이를 은폐. 테스트가 실제 required contract를 검증하지 않고 있었음. `.env.example`이 서버-팀 ↔ VM-셋업 담당 사이의 계약을 지키지 못함.

## Lessons

1. **Silent fallback은 카오스 딜레이 타이머.** 몇 분짜리 crash loop가 며칠짜리 데이터 오염보다 낫다.
2. **"테스트 통과"와 "안전"은 다르다.** `process.exit` mock 덕에 조용히 통과한 테스트는 계약을 검증하지 않았다.
3. **Pre-deploy validation 비용은 거의 0.** 배포 +2~3초로 "30초 timeout + rollback"을 없앤다.
4. **Auto-rollback은 최후 방어층, 첫 방어층이 아니다.** 예측 가능한 건 미리 잡아 rollback 트리거 빈도를 줄인다.
5. **문서화는 계약이다.** `.env.example`을 REQUIRED/OPTIONAL로 재구성한 건 "이 파일이 진실"이라는 계약 회복.

## Residual risk

- 런타임 중 Mongo 연결 끊김 → 방어층 무관, monitoring 필요.
- 프로덕션 데이터 자체 오염 → 방어 대상 아님 (operational).
- pre-deploy validation step 자체 버그 → 첫 배포 run 모니터링 (PR #45 merge 후 확인됨).

## Action items

- [x] `.env.example` REQUIRED/OPTIONAL 재구성 (PR #44)
- [x] strict config (PR #44)
- [x] pre-deploy validation (PR #45)
- [x] incident를 POSTMORTEM 문서로 분리 (이 문서 — 구 `notices-api-architecture.md §10`에서 추출)
- [ ] (optional) `.env.example` ↔ config schema drift detection을 CI에 추가
- [ ] (optional) 다른 feature의 required 변수 audit

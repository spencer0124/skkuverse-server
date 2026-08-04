---
title: Strict Config Validation + Pre-deploy Dry-load
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# 0004. Strict Config Validation + Pre-deploy Dry-load

## Status

Accepted — 2026-04-10 (PR #44 + #45). 백필 문서화 2026-07-22.

> [!NOTE]
> 이 결정은 Express 코드베이스(2026-05-31 NestJS 이관 이전)에서 내려졌다. 원래 구현은 `lib/config.js` + `.github/workflows/deploy.yml`. **결정과 철학은 현행에서도 유효**하며, config 검증은 이관 후 NestJS `@nestjs/config` 기반으로 옮겨졌다 (`src/config/config.module.ts`, `src/config/app-config.service.ts`, `src/config/env.validation.ts`). 정확한 현행 검증 로직은 이 파일들이 SSOT.

## Context

2026-04-10 notices 최초 배포(PR #43)가 프로덕션에서 crash loop → auto-rollback으로 실패했다. Root cause는 config의 **silent fallback**이었다. Express `lib/config.js`에 두 종류의 위험한 fallback이 있었다:

```js
// (1) MONGO_AD_DB_NAME이 없으면 광고가 버스 DB로 조용히 저장됨
dbName: devDbName(process.env.MONGO_AD_DB_NAME || process.env.MONGO_DB_NAME_BUS_CAMPUS),
// (2) 필터 경계가 조용히 하드코드 날짜로 고정됨
serviceStartDate: process.env.NOTICES_SERVICE_START_DATE || "2026-03-09",
```

이런 fallback은 dev·CI·prod 차이를 **은폐**한다. 로컬 `.env`엔 값이 있어 통과, CI는 fallback이 먹혀 통과, prod에선 VM `.env`에 변수 추가를 잊어도 한동안 멀쩡해 보이다가 몇 주 뒤 "엉뚱한 DB에 데이터가 쌓였다"로 터진다. 전체 incident 서사는 [internal/2026-04-notices-config-incident.md](../internal/2026-04-notices-config-incident.md).

## Decision

**철학 전환: "fallback으로 crash 회피"(fail-safe) → "fail-loud으로 drift 드러내기"(strict).**

**(A) Strict validation (PR #44)** — "DB/경계 redirect" 타입 fallback을 전부 제거. 누락 = loud crash. 에러 메시지가 **어떤 env var을 설정해야 하는지 직접 표기**. 단순 운영 기본값(`port || 3000`, collection 이름)은 유지 — 이건 데이터 리디렉션이 아니므로. (NestJS 이관 후 이 검증은 `env.validation.ts`의 스키마로 재구현됨.)

**(B) Pre-deploy dry-load (PR #45)** — `docker compose build` 직후, rolling update **이전에** throwaway 컨테이너로 config만 dry-load:

```bash
docker compose run --rm --no-deps -T api-1 node -e "require('./config'); console.log('config ok')"
```

같은 이미지·같은 `.env`·같은 `NODE_ENV=production`으로 프로덕션 동작의 가장 이른 지점을 재현. `--rm --no-deps -T` + `node -e`로 CMD override → 서버는 안 띄우고 config만 로드(포트 바인딩·Mongo 연결·poller 부수효과 전무). 실패 시 `git checkout $PREV_COMMIT; exit 1` — rolling update 전 abort라 0 downtime.

**3단 중첩 방어** (각각 다른 실패 모드):

| 실패 모드 | 잡는 층 |
| --- | --- |
| env var 누락 | pre-deploy dry-load (2초) |
| transient DB 실패 중 rolling update | auto-rollback (PR #42, 60초) |
| 코드 버그로 startup 직후 죽음 | auto-rollback |
| silent env var drift → 몇 주 뒤 데이터 오염 | strict validation (원천 차단) |

## Consequences

- (+) env var 미세팅이 "배포 후 30초 timeout + rollback"에서 "배포 전 2초 fail-fast"로 바뀜.
- (+) silent drift(광고가 버스 DB에 저장 등)가 원천 차단 — 몇 분짜리 crash가 며칠짜리 데이터 오염보다 낫다.
- (+) auto-rollback이 최후 방어층으로 격하 — 진짜 예측 불가 실패에만 반응.
- (−) **동기화 계약이 생긴다.** Express 시절엔 `jest.setup.js` defaults / `.env.example` REQUIRED / `lib/config.js` required 배열 세 파일이 sync돼야 했다. NestJS 이관 후엔 `env.validation.ts` 스키마 + `.env.example`로 수렴 — 새 required 변수 추가 시 함께 갱신 필요.
- (−) strict는 불편하다 (누락되면 바로 죽음). 그게 목적 — 문제를 배포 전에 드러낸다.
- **막지 못하는 것:** 런타임 중 Mongo 연결 끊김(→ monitoring 필요), 프로덕션 데이터 자체 오염(→ operational issue). [internal 포스트모템 §Residual risk](../internal/2026-04-notices-config-incident.md) 참조.

---
title: Adopt Diátaxis Docs Structure
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# 0001. Diátaxis 기반 문서 구조 채택

## Status

Accepted — 2026-07-22

## Context

`skkuverse-server/docs/`가 평면으로 쌓이며 세 가지 문제가 겹쳤다:

1. **거버넌스 부재** — sibling 레포 `skkuverse-app`이 이미 `docs/README.md`(규칙 SSOT) + frontmatter 스키마 + markdownlint 게이트를 갖춘 반면, 서버는 아무 규칙이 없었다. 유일한 조직 규칙은 `project-docs.md` 본문에 묻힌 prose "운영-진실 우선순위" 체인 하나뿐. frontmatter/상태/갱신일 메타데이터 없음.
2. **Express→NestJS drift** — 2026-05-31 NestJS 이관(Express `features/*.js` + `lib/*.js` + `index.js` 트리 삭제) 이후 문서가 갱신되지 않았다. `CLAUDE.md`·`project-docs.md`·`notices-api-architecture.md`가 전부 죽은 Express 레이아웃을 서술. **`README.md`만 현행**. 값 복사(파일 경로·개수 박제)가 staleness의 근본 원인이었다.
3. **메가 문서** — `notices-api-architecture.md`(794줄)와 `project-docs.md`(2106줄)가 reference·explanation·ADR·how-to·postmortem을 한 파일에 혼합. 정착한 스펙과 사후 기록을 경로만으로 구분할 수 없었다. `notices-api-architecture.md §10.8`은 "incident를 POSTMORTEM 문서로 분리"를 스스로 TODO로 남겨 두고 있었다.

## Decision

- **[Diátaxis](https://diataxis.fr/) 분류 폴더** (`how-to/`·`reference/`·`explanation/`) + 내부 전용 폴더 (`decisions/`·`internal/`) + 기존 `archive/`(historical) 채택. 분류 축은 주제가 아니라 **독자의 니즈**.
- 모든 문서에 **frontmatter** (`title/type/status/owner/last-updated/audience`) + H1 하나 + 한 줄 요약 골격 강제.
- **값 복사 금지 규칙**: 파일 경로·버전·개수·테스트 수를 문서에 하드코딩하지 않고 source-of-truth(코드)를 가리킨다. Express drift의 재발 방지.
- **markdownlint-cli2**를 루트에 도입 (`npm run lint:md`, `npm run lint`에 체인). 규칙은 `.markdownlint-cli2.jsonc` — `skkuverse-app`과 동일 설정을 이식.
- **Flagship-first 이관**: `notices` 문서를 먼저 완전 분할(reference/explanation/decisions/how-to/internal)하여 모범 사례로 삼고, `project-docs.md`·`CLAUDE.md` 전면 정리는 backlog로 매핑. 린터 globs는 이관 완료된 문서만 게이트하고 레거시 flat 문서는 `ignores`로 유예한다 (ignore 목록 = 이관 TODO).
- 파일명 kebab-case, ADR은 `NNNN-kebab-title.md` (MADR-lite: Context/Decision/Consequences), 포스트모템은 `YYYY-MM-topic.md`.

전체 규칙의 SSOT는 [docs/README.md](../README.md).

## Consequences

- (+) 문서의 목적이 경로만으로 드러남. 사후 기록(`internal/`)과 권위 계약(`reference/`)이 물리적으로 구분됨.
- (+) staleness의 주범이던 값·경로 박제가 컨벤션 + 린트로 차단됨. `last-updated`로 낡음이 가시화됨.
- (+) `notices-api-architecture.md`는 `status: superseded` 스텁으로 남아 기존 인바운드 링크(`README.md`, `CLAUDE.md`)가 5개 신규 문서로 안착.
- (−) 미이관 레거시 문서(`project-docs.md` 등)는 당분간 drift 배너를 단 채 남는다 — 인덱스에는 정직하게 표기하되 내용 분해는 후속 작업.
- (−) 이관 도중 `README.md`·`CLAUDE.md`의 구 경로 참조를 갱신해야 함 (이 ADR과 같은 브랜치에서 최소 조치).
- **NestJS 이관과의 관계:** 이 문서 구조 결정은 코드 구조가 아니라 문서 구조에 대한 것. Express→NestJS 코드 이관은 별개이며, 이 문서화 작업은 그 이관을 문서에 *반영*하는 성격이다.

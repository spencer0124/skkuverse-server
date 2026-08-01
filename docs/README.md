---
title: Docs Index & Conventions
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-07-22
audience: internal
---

# Docs Index & Conventions

> skkuverse-server 문서의 인덱스이자 문서 작성 규칙의 단일 진실 출처(SSOT). 새 문서를 쓰기 전에 이 파일을 읽는다. 채택 근거는 [decisions/0001](decisions/0001-adopt-diataxis-docs-structure.md).

## 진실의 우선순위 (문서가 충돌할 때)

`project-docs.md`에 흩어져 있던 규칙을 여기로 흡수한다. 문서 간·문서와 코드 간 내용이 어긋나면 아래 순서로 신뢰한다:

1. **코드 (`src/`)** — 파일명·상수·엔드포인트의 최종 진실. 문서는 값을 복사하지 말고 여기를 가리킨다.
2. **`README.md`** — 현행 스택·구조·실행. (2026-05-31 NestJS 이관 반영됨.)
3. **`docs/` (이 인덱스 기준)** — Diátaxis 문서. `status: accepted`가 권위, `draft`는 초안.
4. **`CLAUDE.md`** — 에이전트 가이드. 일부 Express drift 잔존 (backlog).
5. **레거시 flat 문서** (`project-docs.md` 등) — drift 배너가 붙은 미이관 문서. 최하 신뢰.

## 폴더 구조 (Diátaxis)

문서는 [Diátaxis](https://diataxis.fr/)로 나눈다. **분류 기준은 주제가 아니라 독자의 니즈**다.

| 폴더 | 니즈 | 내용 |
| --- | --- | --- |
| `how-to/` | 해내기 (작업) | 특정 목표를 달성하는 절차 런북 |
| `reference/` | 찾아보기 (정보) | API 계약·스펙·에러 코드의 권위 있는 사실 |
| `explanation/` | 이해하기 (맥락) | 왜 이렇게 되어 있는지, 설계 근거 |
| `decisions/` | — | ADR (`NNNN-kebab-title.md`) |
| `internal/` | — | 포스트모템·incident 기록 (`YYYY-MM-topic.md`) |
| `archive/` | — | historical 스냅샷 (superseded) |

**한 문서 = 한 니즈.** 절차와 배경이 섞이면 문서를 쪼개고 서로 링크한다.

## 문서 인덱스

### how-to (런북)

| 문서 | 요약 |
| --- | --- |
| [verify-notices-changes.md](how-to/verify-notices-changes.md) | `/notices/*` 변경 후 머지·배포 전 검증 절차 |

### reference (계약·스펙)

| 문서 | 요약 |
| --- | --- |
| [notices-api.md](reference/notices-api.md) | `/notices/*` + `/internal/notices/*` 요청·응답 계약, 에러 코드, 파일 맵 |

### explanation (메커니즘·배경)

| 문서 | 요약 |
| --- | --- |
| [notices-architecture.md](explanation/notices-architecture.md) | notices API가 왜 지금 모양인지 — 진짜 문제들과 미시 설계결정 |

### decisions (ADR)

| 문서 | 상태 |
| --- | --- |
| [0001-adopt-diataxis-docs-structure.md](decisions/0001-adopt-diataxis-docs-structure.md) | accepted |
| [0002-notices-read-only-ownership.md](decisions/0002-notices-read-only-ownership.md) | accepted (백필) |
| [0003-fcm-dispatch-cloud-function-claim-lease.md](decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) | accepted (백필) |
| [0004-strict-config-pre-deploy-dry-load.md](decisions/0004-strict-config-pre-deploy-dry-load.md) | accepted (백필) |

### internal (포스트모템)

| 문서 | 요약 |
| --- | --- |
| [2026-04-notices-config-incident.md](internal/2026-04-notices-config-incident.md) | notices 최초 배포 config crash + 3단 hardening |

### 미이관 (레거시 — drift 배너 부착, 분해 대기)

아래는 아직 Diátaxis로 분해되지 않은 문서다. drift 배너가 붙어 있고 린터 게이트에서 유예(`ignores`)된다. 분해 시 배너 제거 + 린터 ignore에서 제외.

| 문서 | 상태 |
| --- | --- |
| [notices-api-architecture.md](notices-api-architecture.md) | superseded — 위 5개 문서로 분할 완료. 포인터 스텁만 남음 |
| [project-docs.md](project-docs.md) | 미이관 — Oracle 배포 + Bus 시스템 + 외부 API + 건물. Express drift |
| [cicd-and-branch-protection.md](cicd-and-branch-protection.md) | 미이관 — CI/CD·브랜치 보호 |
| [skku-notice-sources.md](skku-notice-sources.md) | 미이관 — 크롤 소스 스냅샷 (SSOT는 `src/notices/sources.json`) |
| [skku-departments.md](skku-departments.md) | 미이관 — 학과 홈페이지 에디토리얼 참조 |

## 이관 backlog

flagship-first 원칙으로 notices만 먼저 완전 이관했다. 다음 이관 지도:

- **`project-docs.md`(대형) 분해:** Oracle 배포 → `how-to/deploy-oracle-cloud.md`; Bus Schedule System → `explanation/bus-schedule-architecture.md` + `reference/bus-api.md` + `how-to/add-bus-route.md`; 외부 API(HSSC·Jongro·Hyehwa·Quota·Map) → `reference/external-apis.md`; 건물 → `reference/building-api.md` + `explanation/building-data.md`. 전 구간 Express→NestJS drift 수정.
- **`CLAUDE.md`** 아키텍처 섹션 NestJS 전면 재작성 (현재 stale 배너만).
- **`skku-notice-sources.md` / `skku-departments.md`** → `reference/`로 분류 + staleness 정합.
- 각 문서를 분해할 때 `.markdownlint-cli2.jsonc`의 `ignores`에서 해당 줄 제거.

## 문서 작성 규칙

### 1. Frontmatter (필수)

모든 문서는 YAML frontmatter로 시작한다:

```yaml
---
title: <Title Case 제목>
type: how-to | reference | explanation | tutorial | adr | plan | postmortem
status: draft | accepted | superseded | deprecated
owner: zoyoong124@gmail.com
last-updated: YYYY-MM-DD
audience: internal | public
---
```

- `status: superseded/deprecated`일 때는 본문 첫머리에 현행 SSOT 링크를 남긴다.
- 문서 내용을 실질적으로 고칠 때마다 `last-updated`를 갱신한다.

### 2. 골격

frontmatter 다음은 반드시: `# H1`(문서당 하나) → `> 한 줄 요약`. 이후 `##` 섹션, 레벨 건너뛰기 금지. 새 문서는 [`_template.md`](_template.md)를 복사.

### 3. 값을 복사하지 말고 출처를 가리켜라

**파일 경로·버전·개수·테스트 수를 문서에 하드코딩하지 않는다.** 코드가 바뀌면 문서가 조용히 거짓말을 시작하는 게 이 레포 drift(Express 레이아웃 박제)의 근본 원인이었다.

- ❌ `notices 로직은 features/notices/notices.routes.js에 있다`
- ✅ `notices 라우트는 src/notices/notices.controller.ts (SSOT)`
- 예시 값이 필요하면 "작성 시점 기준" 명시 또는 `<placeholder>`.

### 4. 파일명

- **kebab-case, 소문자, `.md`**
- ADR: `NNNN-kebab-title.md` (0패딩 일련번호)
- 포스트모템: `YYYY-MM-topic.md`
- ALL-CAPS는 GitHub 특수 파일만 (`README`, `LICENSE`)

### 5. 서식

- 코드펜스는 **언어 태그 필수** (`bash`, `ts`, `js`, `json`, `jsonc`, `yaml`, `text`)
- 구조화된 사실(파라미터·경로·옵션)은 표로
- 주의·경고는 GitHub admonition: `> [!NOTE]`, `> [!WARNING]`
- 본문 언어는 한국어, 기술 용어는 영어 그대로
- 린트: `npm run lint:md` (markdownlint-cli2, 설정은 루트 `.markdownlint-cli2.jsonc`). globs는 이관된 문서만 게이트 — 레거시 flat 문서는 `ignores`로 유예.

### 6. 라이프사이클

- 레거시 문서를 Diátaxis로 분해하면: 정착 지식은 `reference/`/`explanation/`으로 옮기고, 원본은 `status: superseded` 스텁(포인터 표)으로 축소 — 삭제하지 않음(git 히스토리 + 인바운드 링크 보존).
- 구조적 결정을 내렸으면 `decisions/`에 ADR 한 편 (Context/Decision/Consequences).
- 문서가 코드와 어긋난 걸 발견하면 그 자리에서 고치거나 최소한 `> [!WARNING]` stale 배너를 남긴다.

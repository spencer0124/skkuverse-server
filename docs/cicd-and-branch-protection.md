# CI/CD 및 브랜치 보호 전략

## 워크플로우 구성

| 워크플로우 | 트리거 | 용도 |
|---|---|---|
| `ci.yml` | PR → main | test + lint 검증 |
| `deploy.yml` | main push | test → OCI 자동 배포 + auto rollback |
| `claude-code-review.yml` | PR 생성/업데이트 | 자동 코드 리뷰 |
| `claude.yml` | `@claude` 멘션 | 대화형 응답 |

---

## CI (`ci.yml`) — PR 단계

PR 생성 시 테스트/린트 통과 여부를 검증.

```
PR → main
  └→ test job
       ├→ npm ci
       ├→ npm test
       └→ npm run lint
```

## CD (`deploy.yml`) — 머지 후 배포

```
main push
  ├→ test job (npm ci → test → lint)
  └→ deploy job (test 통과 후, SSH → OCI)
       ├→ PREV_COMMIT 저장
       ├→ git pull origin main          ← VM 워킹트리 dirty 시 abort
       ├→ Nginx 설정 업데이트            ← (api.skkuverse.com 활성, api.skkuuniverse.com legacy copy)
       ├→ docker compose build
       ├→ Pre-deploy config validation  ← lib/config.js dry-load on the new image (2초)
       │    └→ 실패 시 git revert → exit 1 (running containers 안 건드림, 0 downtime)
       ├→ Rolling update (api-1 → api-2 → poller)
       │    └→ 각 서비스 health check retry (5초 × 6회)
       ├→ 성공 → 완료
       └→ 실패 → rollback() → 전체 복원 (자동 rollback)
```

3단 방어층 — 각각 다른 실패 모드 커버:

| 실패 모드 | 잡는 층 | 비용 |
|---|---|---|
| env var 누락 | pre-deploy config validation | ~2초, 0 downtime |
| transient DB 실패 등 rolling update 중 죽음 | health-check retry + auto-rollback | ~60초 |
| `git pull`이 거부 (VM 워킹트리 dirty) | 그 자리에서 abort (rollback 호출 안 됨) | — |

설계 근거는 `docs/notices-api-architecture.md` §3.17·§10 참조.

### Rolling Update 순서

1. `api-1` 재시작 → health check retry → 통과 시 다음
2. `api-2` 재시작 → health check retry → 통과 시 다음
3. `poller` 재시작 → 상태 확인

api-1, api-2가 순차 배포되므로 다운타임 없음. 어느 단계에서든 실패 시 전체 rollback.

### 배포 대상

| 항목 | 값 |
|---|---|
| 서버 | OCI ARM VM |
| 유저 | ubuntu |
| 경로 | `/home/ubuntu/skkumap-server-express` *(legacy folder name retained; matches `DEPLOY_PATH` secret. 변경 시 secret + 모든 컨테이너 재빌드 필요해 의도적으로 유지.)* |
| 활성 도메인 | `api.skkuverse.com` (Cloudflare → Nginx → Docker) |
| Legacy 도메인 | `api.skkuuniverse.com` (nginx config 파일은 여전히 copy되지만 symlink 안 됨, 비활성) |
| Docker 네트워크 | `skkuverse` (external, AI 서비스 공유) |

### 서비스 구성

| 서비스 | 포트 | 리소스 | 역할 |
|---|---|---|---|
| api-1 | 127.0.0.1:3001 | 384MB / 0.75 CPU | API (로드밸런싱) |
| api-2 | 127.0.0.1:3002 | 384MB / 0.75 CPU | API (로드밸런싱) |
| poller | — | 256MB / 0.5 CPU | 백그라운드 작업 |

### AI 서비스 연동

백엔드는 `skkuverse` Docker 네트워크를 통해 AI 서비스에 접근:
- `http://ai:4000/v1/chat/completions` — 범용 채팅
- `http://ai:4000/api/notices/summarize` — 공지 요약

### GitHub Secrets

| Secret | 용도 |
|---|---|
| `ORACLE_VM_HOST` | OCI 서버 IP |
| `ORACLE_VM_USER` | SSH 유저 |
| `SSH_PRIVATE_KEY` | SSH 개인키 |
| `DEPLOY_PATH` | 배포 경로 |

---

## 브랜치 보호 (GitHub Rulesets)

### 규칙

| 규칙 | 설명 |
|---|---|
| PR 필수 | main 직접 push 차단. PR → CI 통과 → 머지 |
| required_status_checks | `test` job 통과 필수 |
| non_fast_forward | force push 방지 |
| deletion | main 브랜치 삭제 방지 |

### Bypass

- **Repository Admin**: 긴급 시 직접 push 가능 (bypass_mode: always)

### PR 머지 흐름

```
feature branch 생성
  └→ 작업 & 커밋
       └→ PR 생성 (main ← feature)
            ├→ test check (npm test + lint)
            ├→ Claude Code Review (자동 코드 리뷰)
            └→ 둘 다 통과 → 머지 가능 → deploy 자동 실행
```

### 자동 Rollback

배포 스크립트에 자동 rollback 내장. rolling update 중 health check 실패 시:

1. 배포 전 커밋 해시 저장 (`PREV_COMMIT`)
2. api-1 또는 api-2 health check 30초간 retry (5초 × 6회)
3. 실패 시 `git checkout $PREV_COMMIT` → 이전 이미지로 api-1, api-2, poller 전체 복원
4. CI는 실패로 표시 (GitHub에서 확인 가능)

### 긴급 hotfix

Admin은 bypass 권한이 있으므로 main에 직접 push 가능. 단, 의도적으로만 사용할 것.

# Oracle Cloud VM 점검 대비 가이드

- **점검일:** 2026-04-13 15:57 UTC (한국시간 04-14 00:57)
- **대상:** instance-20260228-1548 (춘천 리전)
- **예상 다운타임:** ~20분 (VM 전원 OFF → ON)
- **REF:** COMPUTE-100847 / 73a0208f

---

## 사전 점검 결과 (2026-04-05 확인)

| 점검 항목 | 결과 |
|-----------|------|
| Docker 자동 시작 (`systemctl is-enabled docker`) | enabled |
| Nginx 자동 시작 (`systemctl is-enabled nginx`) | enabled |
| 컨테이너 restart 정책 | 4개 모두 `unless-stopped` |
| SSL 인증서 (Cloudflare Origin, 4개 파일) | 모두 존재 |
| api-1, api-2 `/health/ready` | 정상 |
| MongoDB | 외부 Atlas 사용 (VM 점검 영향 없음) |

---

## 결론

**별도 조치 없이 자동 복구됩니다.**

- Docker daemon과 Nginx 모두 `systemctl enable` 상태 → VM 부팅 시 자동 시작
- 모든 Docker 컨테이너 `restart: unless-stopped` → Docker 시작 시 자동 재시작
- MongoDB는 외부(Atlas) → VM 점검과 무관
- in-memory 캐시(버스 위치, 역 도착 정보)는 pollers가 10~40초 내 재수집

### 복구 타임라인 (예상)

| 시점 | 이벤트 |
|------|--------|
| T=0s | VM 부팅, OS 시작 |
| T=~30s | Docker daemon + Nginx 자동 시작 |
| T=~40s | 컨테이너 재시작 (poller, api-1, api-2, codepush-ota) |
| T=~50s | MongoDB Atlas 연결 성공 |
| T=~60s | api `/health/ready` 응답 시작 |
| T=~90s | 서비스 완전 복구 |

### 일시적 영향 (자동 해소)

- 복구 중 ~90초간 502 Bad Gateway 발생 가능 (Cloudflare 에러 페이지 표시)
- 버스/역 실시간 데이터가 poller 첫 실행까지 빈 값으로 응답 (10~40초)
- Firebase Auth 토큰 캐시 초기화 → 첫 요청 시 약간의 지연

---

## 재부팅 후 검증 체크리스트

VM이 다시 켜진 후 `ssh oracle` 접속하여 실행:

```bash
# 1. Docker 컨테이너 상태 확인
docker compose ps

# 2. running이 아닌 컨테이너 확인 (출력 없으면 정상)
docker compose ps --format '{{.Name}} {{.State}}' | grep -v running

# 3. API 헬스체크
curl -f http://localhost:3001/health/ready
curl -f http://localhost:3002/health/ready

# 4. Nginx 상태
sudo systemctl status nginx

# 5. 외부에서 API 확인
curl -f https://api.skkuverse.com/health/ready

# 6. 에러 로그 확인
docker compose logs --tail 50 poller | grep -i error
docker compose logs --tail 50 api-1 | grep -i error
docker compose logs --tail 50 api-2 | grep -i error
```

---

## 만약 자동 복구가 안 될 경우

```bash
# Docker 컨테이너 수동 시작
cd <DEPLOY_PATH>
docker compose up -d

# Nginx 수동 시작
sudo systemctl start nginx

# 그래도 안 되면 Nginx 설정 점검
sudo nginx -t
```

---

## 서버 구성 참고

- **Docker 서비스:** poller (데이터 수집), api-1 (:3001), api-2 (:3002), codepush-ota
- **Nginx:** api.skkuverse.com / api.skkuuniverse.com → upstream 3001, 3002
- **SSL:** Cloudflare Origin Certificate (`/etc/ssl/cloudflare/`)
- **MongoDB:** Atlas (외부)

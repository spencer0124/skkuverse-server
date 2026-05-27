# syntax=docker/dockerfile:1.7

# --- builder stage ---
# devDeps 포함 (tsc + scripts/copy-build-assets.js 필요).
# 이 stage의 산출물은 dist/ 디렉토리뿐 — runtime stage가 그것만 가져감.
FROM node:22-alpine AS builder
WORKDIR /app

# 패키지 매니페스트 + tsconfig만 먼저 복사 → npm ci 결과를 별도 layer로 캐시.
# source 변경 시 npm ci 재실행 없이 build만 다시 돌게 됨.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# 나머지 source 복사 후 빌드. .dockerignore가 dist/, node_modules/, __tests__/,
# __fixtures__/, scripts/, docs/ 등을 제외.
COPY . .
RUN npm run build

# --- runtime stage ---
# devDeps 없는 minimal 이미지. tsc/eslint/jest 등 빌드 도구는 ship되지 않음.
FROM node:22-alpine AS runtime
WORKDIR /app

# Production deps만 설치. node_modules 무게 절감 + 공격 표면 감소.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# builder의 dist/ 만 옮김. copy-build-assets.js가 JSON 자산을 dist/에 이미
# 복사해뒀고 __tests__를 strip했으므로 이 한 줄로 runtime 자산 완비.
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

# /health/ready: lib/db pingDb() + (role==="api" OR pollers.isReady()).
# docker-compose.yml의 api-1/api-2 healthcheck와 별개로 Dockerfile-level도 유지
# — `docker run` 단독 사용 시도 healthcheck 동작.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/ready || exit 1

# npm start의 prestart hook은 `npm run build`를 trigger하지만 runtime stage에
# tsc 없음 → 실패. 직접 node로 호출해 hook 우회.
CMD ["node", "dist/index.js"]

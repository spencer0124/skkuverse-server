# Phase 3 — Detailed Implementation Guide

**Date**: 2026-03-02
**Status**: Complete (all items 3-A through 3-H done)
**Prerequisites**: Oracle Cloud VM (bare, SSH verified), Cloudflare domain `skkuuniverse.com` (purchased), GitHub Secrets configured

---

## Overview

Phase 3 has 8 items split into two categories:

- **Code changes** (3-A through 3-D): committed to repo, tested locally
- **Server/external setup** (3-E through 3-H): manual one-time configuration

Do the code changes first (they can be tested and shipped independently), then set up the server.

---

## Code Changes

### 3-A: Docker Compose 2 API Replicas

**File**: `docker-compose.yml`

Split the single `api` service into `api-1` and `api-2` with separate localhost-only ports.

```yaml
services:
  poller:
    build: .
    env_file: .env
    environment:
      - NODE_ENV=production
      - ROLE=poller
    restart: unless-stopped
    mem_limit: 256m
    cpus: 0.5
    healthcheck:
      disable: true  # poller has no HTTP server
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  api-1:
    build: .
    ports:
      - "127.0.0.1:3001:3000"
    env_file: .env
    environment:
      - NODE_ENV=production
      - ROLE=api
    depends_on:
      - poller
    restart: unless-stopped
    mem_limit: 384m
    cpus: 0.75
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

  api-2:
    build: .
    ports:
      - "127.0.0.1:3002:3000"
    env_file: .env
    environment:
      - NODE_ENV=production
      - ROLE=api
    depends_on:
      - poller
    restart: unless-stopped
    mem_limit: 384m
    cpus: 0.75
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3
```

**Resource budget** (same total as before):

| Service | Memory | CPU |
|---------|--------|-----|
| poller  | 256m   | 0.5 |
| api-1   | 384m   | 0.75 |
| api-2   | 384m   | 0.75 |
| **Total** | **1024m** | **2.0** |

**Why `127.0.0.1` binding**: Ports 3001/3002 are only accessible from the host (where Nginx runs). No firewall changes needed — external traffic still enters on 80/443 through Nginx.

**Why `healthcheck: disable: true` on poller**: The Dockerfile has a HEALTHCHECK that hits `/health/ready`, which fails for the poller service (no HTTP server). Docker Compose overrides Dockerfile's healthcheck, so we explicitly disable it.

---

### 3-B: Nginx Upstream Config

**File**: `infra/nginx/api.skkuuniverse.com` (NEW — version-controlled)

```nginx
upstream skkubus_api {
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name api.skkuuniverse.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.skkuuniverse.com;

    # Cloudflare Origin Certificate (15-year, free)
    ssl_certificate /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin-key.pem;

    location / {
        proxy_pass http://skkubus_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Passive health check** (`max_fails=3 fail_timeout=30s`): If a backend fails 3 consecutive proxied requests, Nginx marks it unavailable for 30 seconds. Traffic routes to the healthy replica. Open-source Nginx only supports passive checks (active probing requires Nginx Plus).

**Why version-control this**: The deploy script (`3-D`) copies this file to `/etc/nginx/sites-available/` on each deploy, keeping server config in sync with the repo.

---

### 3-C: BetterStack Log Shipping

**Files**: `lib/logger.js` (modify), `package.json` (add dependency)

**Install**: `npm install @logtail/pino`

Must go in `dependencies` (not `devDependencies`) because the Dockerfile uses `npm ci --omit=dev`.

**Updated `lib/logger.js`**:

```javascript
const pino = require("pino");

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

function buildTransport() {
  if (isTest) return undefined;
  if (!isProduction) {
    return { target: "pino-pretty", options: { colorize: true } };
  }
  // Production: stdout + optional BetterStack
  if (process.env.LOGTAIL_TOKEN) {
    return {
      targets: [
        { target: "pino/file", options: { destination: 1 } },
        { target: "@logtail/pino", options: { sourceToken: process.env.LOGTAIL_TOKEN } },
      ],
    };
  }
  return undefined; // plain JSON to stdout
}

const transport = buildTransport();

const logger = pino({
  level: isTest ? "silent" : process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  ...(transport ? { transport } : {}),
});

module.exports = logger;
```

**Behavior matrix**:

| Environment | LOGTAIL_TOKEN | Transport | Output |
|-------------|---------------|-----------|--------|
| test        | any           | none      | silent |
| development | any           | pino-pretty | colored terminal |
| production  | not set       | none      | JSON to stdout (Docker captures) |
| production  | set           | multi     | JSON to stdout + BetterStack |

**Graceful degradation**: No `LOGTAIL_TOKEN` → no crash, no change from current behavior. Token can be added to `.env` whenever BetterStack account is ready.

---

### 3-D: GitHub Actions CI/CD

**File**: `.github/workflows/deploy.yml` (NEW)

```yaml
name: CI/CD

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run lint

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.ORACLE_VM_HOST }}
          username: ${{ secrets.ORACLE_VM_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ${{ secrets.DEPLOY_PATH }}
            git pull origin main

            # Update Nginx config if changed
            sudo cp infra/nginx/api.skkuuniverse.com /etc/nginx/sites-available/
            sudo nginx -t && sudo systemctl reload nginx

            # Build new images
            docker compose build

            # Rolling update: one replica at a time
            docker compose up -d --no-deps api-1
            sleep 15
            curl -f http://localhost:3001/health/ready || exit 1

            docker compose up -d --no-deps api-2
            sleep 15
            curl -f http://localhost:3002/health/ready || exit 1

            # Update poller last (no downtime impact)
            docker compose up -d --no-deps poller
```

**Required GitHub Secrets** (Settings → Secrets and variables → Actions):

| Secret | Value | Example |
|--------|-------|---------|
| `ORACLE_VM_HOST` | Oracle VM public IP | `129.154.xxx.xxx` |
| `ORACLE_VM_USER` | SSH username | `ubuntu` |
| `SSH_PRIVATE_KEY` | Private key (full PEM) | `-----BEGIN RSA PRIVATE KEY-----\n...` |
| `DEPLOY_PATH` | Project directory on VM | `/home/ubuntu/skkumap-server-express` |

**Rolling update flow**:
1. Build all images (shared cache, fast)
2. Restart `api-1` → wait 15s → health check passes → traffic confirmed
3. Restart `api-2` → wait 15s → health check passes
4. Restart `poller` (no HTTP traffic, safe to just restart)

During step 2, Nginx sends all traffic to `api-2` (still running old version). During step 3, Nginx sends all traffic to `api-1` (already running new version). **Zero user-visible downtime**.

---

## Server & External Setup

### 3-E: Oracle Cloud VM Setup

Follow `docs/docker-deploy.md` steps 1–3:

1. **Create ARM instance**: VM.Standard.A1.Flex (1 OCPU, 6GB RAM), Ubuntu 22.04/24.04
2. **Firewall** (three layers):
   - VCN Security List: Ingress TCP 80, 443 (source 0.0.0.0/0)
   - iptables: `sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT` (same for 443), then `sudo netfilter-persistent save`
   - Docker handles container ports automatically
3. **Install software**: Docker, Docker Compose plugin, Nginx, git

```bash
# Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER

# Nginx + git
sudo apt install -y nginx git
```

### 3-F: Cloudflare DNS + SSL

1. **DNS**: Add A record `api` → Oracle VM public IP, **Proxy ON** (orange cloud)
2. **SSL/TLS mode**: Full (Strict)
3. **Origin Certificate**: Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate
   - 15-year validity, free
   - Download `origin.pem` and `origin-key.pem`
   - Place on server: `sudo mkdir -p /etc/ssl/cloudflare && sudo cp origin.pem origin-key.pem /etc/ssl/cloudflare/`
4. **Settings**:
   - Always Use HTTPS: ON
   - Minimum TLS Version: 1.2
   - Auto Minify: OFF (API, not website)
   - Cache Rule: `api.skkuuniverse.com/*` → Bypass (no caching for API responses)

### 3-G: Initial Production Deployment

```bash
# On Oracle VM
git clone <repo-url> ~/skkumap-server-express
cd ~/skkumap-server-express

# Create .env with production values
nano .env
# (MONGO_URL, API keys, LOGTAIL_TOKEN if ready)

# Enable Nginx site
sudo cp infra/nginx/api.skkuuniverse.com /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/api.skkuuniverse.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Build and start
docker compose up -d --build

# Verify
docker compose ps
curl http://localhost:3001/health/ready
curl http://localhost:3002/health/ready
curl https://api.skkuuniverse.com/health
```

### 3-H: UptimeRobot Monitoring

1. Create free account at uptimerobot.com
2. Add monitor:
   - Type: **HTTP(s) - Keyword**
   - URL: `https://api.skkuuniverse.com/health/ready`
   - Keyword: `ready` (keyword exists = UP)
   - Monitoring interval: 5 minutes
3. Alert contact: email address
4. Verify: trigger a test alert

---

## Verification Checklist

### After code changes (local)

- [x] `npm test` — all 142 tests pass (logger silent in test mode)
- [x] `npm run lint` — 0 errors
- [x] `docker compose config` — validates new multi-service YAML
- [x] `NODE_ENV=production node -e "require('./lib/logger').info('test')"` — JSON to stdout, no crash

### After server deployment

- [x] `docker compose ps` — 3 containers running (poller, api-1, api-2)
- [x] `curl http://localhost:3001/health/ready` → `{"status":"ready"}`
- [x] `curl http://localhost:3002/health/ready` → `{"status":"ready"}`
- [x] `curl https://api.skkuuniverse.com/health` → `{"status":"ok"}`
- [x] `curl -vI https://api.skkuuniverse.com` — SSL valid, TLS 1.3, Cloudflare headers present
- [x] Push a commit to `main` → GitHub Actions runs → deploys automatically (rolling update confirmed)
- [x] UptimeRobot dashboard shows UP status

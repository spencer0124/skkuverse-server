# Pro-Level Distribution Architecture Plan

**Date**: 2026-03-02
**Status**: Phase 3 complete

---

## Diagnosis: Current State vs Gaps

| Layer | Before Phase 1 | After Phase 2 | After Phase 3 |
|---|---|---|---|
| **Compute** | 1 container, 1 CPU, 512MB | poller + api (single) | poller + api-1 + api-2 (2 replicas) ✓ |
| **Polling** | `setInterval` → in-memory only | Pollers → MongoDB TTL `bus_cache` | Solved ✓ |
| **DB** | No pool config | `maxPoolSize: 5`, `minPoolSize: 1` | Solved ✓ |
| **HTTP** | Stateful (in-process data) | Stateless (`cachedRead` → MongoDB → fallback) | Solved ✓ |
| **Proxy** | Nginx → single container | Nginx → single container | Nginx upstream → 2 replicas ✓ |
| **CI/CD** | Manual `git pull + docker compose` | Manual (same) | GitHub Actions → rolling deploy ✓ |
| **Observability** | `console.log` | `pino` structured JSON + `/health/ready` | BetterStack + UptimeRobot ✓ |

---

## Core Architectural Challenge: Polling + Horizontal Scaling

The background pollers (`setInterval`) keep bus data in **process-local memory**. This is fine for a single process, but horizontal scaling is broken by design — each new replica polls the external APIs independently (N × API calls) and maintains its own isolated in-memory state.

**Resolution (Phase 2)**: Make pollers write to a MongoDB TTL collection. HTTP handlers read from MongoDB. The HTTP layer becomes stateless.

---

## Architecture Decision Record

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Polling data store | MongoDB TTL collection | Redis | Redis costs money; MongoDB already present |
| Proxy approach | Nginx + Cloudflare DNS | Cloudflare Tunnel | 2–8ms vs 15–45ms latency; critical for 10s bus polling |
| HTTP scaling | Docker Compose services (2 replicas) | Kubernetes/K3s | K8s overhead not justified; free tier K8s is brittle |
| Process manager | Docker (`restart: unless-stopped`) | PM2 inside Docker | Docker is the process manager; PM2+Docker is redundant |
| Log shipping | pino + BetterStack | ELK stack | ELK requires separate VMs; BetterStack free tier sufficient |
| CI/CD | GitHub Actions SSH deploy | Docker Hub + watchtower | Simpler, no registry cost, direct control |

---

## Phase 1 — Maximize the Single Instance

**Goal**: Fully utilize available resources, close P2 audit items, establish production-grade observability.

```
Client → Cloudflare (DNS Proxy, DDoS, SSL) → Nginx (host) → Docker (Express, 2 CPU, 1GB RAM)
                                                                       │
                                                              MongoDB Atlas (cloud)
```

### Items

| # | Item | File(s) | Status |
|---|------|---------|--------|
| 1-A | Structured logging (`pino` + `pino-http`) | `lib/logger.js` (new), `index.js`, all fetchers | DONE |
| 1-B | MongoDB connection pool (`maxPoolSize: 5`) | `lib/db.js` | DONE |
| 1-C | Poller in-flight guard | `lib/pollers.js` | DONE |
| 1-D | `/health/ready` readiness probe | `index.js` | DONE |
| 1-E | Docker resource increase (2 CPU, 1GB) | `docker-compose.yml` | DONE |
| 1-F | Fix ESLint `no-unused-vars` warnings | `eslint.config.js` | DONE |

---

## Phase 2 — Solve the Polling/Scaling Problem

**Goal**: Decouple polling from HTTP serving. Make the HTTP layer stateless.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Oracle Cloud ARM VM                          │
│                                                                 │
│  ┌─────────────────┐    writes     ┌──────────────────────────┐│
│  │  Poller Service │ ──────────►  │   MongoDB Atlas (cloud)  ││
│  │  (1 replica)    │              │   bus_cache collection   ││
│  │  HSSC: 10s      │              │   TTL index: 60s         ││
│  │  Jongro: 15s    │              └──────────────────────────┘│
│  │  Station: 15s   │                         ▲                │
│  └─────────────────┘                         │ reads           │
│                                              │                 │
│  ┌─────────────────┐                ┌────────┴─────────────┐  │
│  │  API Service    │ ◄── Nginx ◄── │  API Service         │  │
│  │  (replica 1)    │               │  (replica 2, future) │  │
│  └─────────────────┘               └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Items

| # | Item | Notes | Status |
|---|------|-------|--------|
| 2-A | Add `bus_cache` MongoDB collection | TTL index `expireAfterSeconds: 60` on `_updatedAt` | DONE |
| 2-B | Pollers write to `bus_cache` | After each fetch: upsert `{ _id: "hssc", data, _updatedAt }` | DONE |
| 2-C | Route handlers read from `bus_cache` | `cachedRead()` with 5s in-memory layer + in-process fallback | DONE |
| 2-D | Split into two Docker Compose services | `poller` (1 replica, 256MB) + `api` (HTTP only, 768MB) | DONE |
| 2-E | Atlas connection pool per service | `poller: maxPoolSize: 2`, `api: maxPoolSize: 5` | (config-ready, same pool) |

---

## Phase 3 — Infrastructure, CI/CD & Observability

**Goal**: Deploy to production. Automate future deployments. Add log aggregation and uptime monitoring.

**Starting point**: Oracle Cloud VM (bare, no config) + Cloudflare domain `skkuuniverse.com` (purchased, not configured).

```
Client → Cloudflare (DNS Proxy, DDoS, SSL) → Oracle VM → Nginx (host)
                                                              │
                                            ┌─────────────────┼─────────────────┐
                                            ▼                                   ▼
                                     Docker api-1                        Docker api-2
                                   (127.0.0.1:3001)                   (127.0.0.1:3002)
                                            │                                   │
                                            └───────────┬───────────────────────┘
                                                        ▼
                                             MongoDB Atlas (cloud)
                                                        ▲
                                                        │
                                                 Docker poller
                                                (1 replica, writes)
```

### Items

| # | Item | Type | File(s) / Where | Status |
|---|------|------|-----------------|--------|
| 3-A | Docker Compose 2 API replicas | Code | `docker-compose.yml` | DONE |
| 3-B | Nginx upstream + passive health check | Code + Server | `infra/nginx/api.skkuuniverse.com` (new) | DONE |
| 3-C | BetterStack log shipping (pino multi-transport) | Code | `lib/logger.js`, `package.json` | DONE |
| 3-D | GitHub Actions CI/CD (test → rolling deploy) | Code | `.github/workflows/deploy.yml` (new) | DONE |
| 3-E | Oracle Cloud VM setup | Server | `docs/docker-deploy.md` (reference) | DONE |
| 3-F | Cloudflare DNS + SSL | External | Cloudflare dashboard | DONE |
| 3-G | Initial production deployment | Server | SSH to Oracle VM | DONE |
| 3-H | UptimeRobot monitoring | External | UptimeRobot dashboard | DONE |

### Execution Order

```
Code changes (local, commit to repo):
  3-A  Docker Compose split → api-1/api-2
  3-B  Nginx config with upstream block
  3-C  BetterStack pino transport
  3-D  GitHub Actions workflow

Server + external setup (manual, one-time):
  3-E  Oracle VM: Docker, Nginx, git, firewall
  3-F  Cloudflare: DNS A record, SSL Full (Strict), Origin Certificate
  3-G  First deploy: git clone, .env, docker compose up, nginx enable
  3-H  UptimeRobot: monitor https://api.skkuuniverse.com/health/ready
```

### Observability Stack (all free tier)

| Tool | Purpose | Tier |
|------|---------|------|
| pino → BetterStack Logtail | Structured log aggregation, search, alerts | Free: 1GB/month |
| UptimeRobot | `/health/ready` monitoring, email alerts | Free: 5-min intervals |
| Cloudflare Analytics | Request volume, error rates | Free (included) |
| MongoDB Atlas Monitoring | Connection count, query performance | Free (built in) |

### Infrastructure Notes

**Oracle Cloud firewall**: No new ports needed beyond 80/443 (already in `docs/docker-deploy.md`). API replicas bind to `127.0.0.1:3001/3002` — localhost only, invisible from outside. Nginx on the host connects to them directly.

**Cloudflare**: DNS A record `api` → Oracle VM public IP (proxy ON). SSL mode Full (Strict) with free Origin Certificate. Cache bypass rule for API responses.

**Rolling deploy**: Deploy script updates one API replica at a time — Nginx `max_fails=3 fail_timeout=30s` routes traffic to the healthy replica while the other restarts.

---

## Phased Roadmap Summary

```
Phase 1 (done ✓)       Phase 2 (done ✓)        Phase 3 (done ✓)
─────────────          ──────────────          ────────────────
✓ P0/P1 audit done     ✓ bus_cache collection  ✓ Docker 2 API replicas
✓ pino logging         ✓ Pollers → MongoDB     ✓ Nginx upstream + health
✓ Pool config          ✓ Routes ← MongoDB      ✓ BetterStack log shipping
✓ Poller guard         ✓ 5s in-memory layer    ✓ GitHub Actions CI/CD
✓ Docker 2CPU/1GB      ✓ Poller/API split      ✓ Oracle VM + Cloudflare setup
✓ ESLint 0 warnings    ✓ Stateless HTTP layer  ✓ Initial production deploy
✓ /health/ready                                 ✓ UptimeRobot monitoring
```

---

## References

- [Oracle ARM Free Tier](https://topuser.pro/free-oracle-cloud-services-guide-oracle-cloud-free-tier-2025/)
- [Cloudflare Tunnel vs Nginx Latency](https://onidel.com/blog/tailscale-cloudflare-nginx-vps-2025)
- [MongoDB Atlas Service Limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)
- [Node.js Cluster Shared State](https://nodejs.org/api/cluster.html)
- [PM2 vs Docker](https://leapcell.io/blog/pm2-and-docker-choosing-the-right-process-manager-for-node-js-in-production)

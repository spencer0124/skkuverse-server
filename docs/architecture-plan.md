# Pro-Level Distribution Architecture Plan

**Date**: 2026-03-02
**Status**: Phase 1 complete ✓

---

## Diagnosis: Current State vs Gaps

| Layer | Current State | Gap |
|---|---|---|
| **Compute** | 1 Docker container, 1 CPU, 512MB | 3 OCPUs + 23.5GB unused on ARM VM |
| **Polling** | In-process `setInterval` → in-memory cache | Blocks horizontal scaling |
| **DB** | MongoDB Atlas, no pool config | Risk of connection exhaustion |
| **Proxy** | Nginx → Docker (correct) | No request logging, no rate limit at Nginx layer |
| **CI/CD** | Manual `git pull + docker compose` | No automation, no rollback |
| **Observability** | `console.log` + Docker logs | No structured logs, no uptime monitoring |
| **Pending P2** | Items 13–20 from pre-production-audit.md | ESLint warnings, pool config, poller overlap guard |

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

| # | Item | Notes |
|---|------|-------|
| 2-A | Add `bus_cache` MongoDB collection | TTL index `expireAfterSeconds: 60` on `_updatedAt` |
| 2-B | Pollers write to `bus_cache` | After each fetch: upsert `{ _id: "hssc", data, _updatedAt }` |
| 2-C | Route handlers read from `bus_cache` | Thin in-memory 5s cache layer over MongoDB reads |
| 2-D | Split into two Docker Compose services | `poller` (1 replica) + `api` (scalable replicas) |
| 2-E | Atlas connection pool per service | `poller: maxPoolSize: 2`, `api: maxPoolSize: 5` |

---

## Phase 3 — CI/CD + Observability

**Goal**: Automate deployments. Add structured log aggregation and uptime monitoring.

```
GitHub (push to main)
        │
        ▼
GitHub Actions Workflow
  ├── npm ci + npm test
  ├── npm run lint
  ├── SSH to Oracle VM
  └── docker compose pull && docker compose up -d --build
              │
              ▼
        Zero-downtime deploy (health check confirms before traffic)
```

### Observability Stack (all free tier)

| Tool | Purpose | Tier |
|------|---------|------|
| pino → BetterStack Logtail | Structured log aggregation, search, alerts | Free: 1GB/month |
| UptimeRobot | `/health/ready` monitoring, email alerts | Free: 5-min intervals |
| Cloudflare Analytics | Request volume, error rates | Free (already active) |
| MongoDB Atlas Monitoring | Connection count, query performance | Free (built in) |

---

## Phased Roadmap Summary

```
Phase 1 (done ✓)       Phase 2 (next)          Phase 3 (launch)
─────────────          ──────────────          ────────────────
✓ P0/P1 audit done     Polling → MongoDB       GitHub Actions CI/CD
✓ pino logging         /health/ready update    BetterStack log shipping
✓ Pool config          Bus cache TTL coll.     UptimeRobot
✓ Poller guard         Poller service split    Nginx upstream health
✓ Docker 2CPU/1GB      2 API replicas          Zero-downtime deploys
✓ ESLint 0 warnings    Stateless HTTP layer
✓ /health/ready
```

---

## References

- [Oracle ARM Free Tier](https://topuser.pro/free-oracle-cloud-services-guide-oracle-cloud-free-tier-2025/)
- [Cloudflare Tunnel vs Nginx Latency](https://onidel.com/blog/tailscale-cloudflare-nginx-vps-2025)
- [MongoDB Atlas Service Limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)
- [Node.js Cluster Shared State](https://nodejs.org/api/cluster.html)
- [PM2 vs Docker](https://leapcell.io/blog/pm2-and-docker-choosing-the-right-process-manager-for-node-js-in-production)

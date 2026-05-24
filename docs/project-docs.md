# skkuverse-server 프로젝트 문서

> 운영 중인 deployment / external API / building data 가이드의 통합 인덱스. 원본은 15개 개별 문서를 2026-03-28에 한 파일로 통합한 것.
>
> **이 문서의 범위 (live)**:
> - **Part 1: Server & Deployment** — OCI VM setup, bus schedule system architecture
> - **Part 2: External APIs** — HSSC / Jongro / Station / SKKU Map API 응답 모양·쿼터
> - **Part 5: Building Data** — connections schema, investigation reports
>
> **분리된 historical 섹션 (`docs/archive/`)**:
> - `docs/archive/api-v2-migration-2026-03.md` — 2026-03 envelope 통일 + v2 라우트 정리의 마이그레이션 기록
> - `docs/archive/flutter-client-guides-2026-03.md` — 2026-03 당시 Flutter 클라이언트용 통합 가이드 모음 (현재 클라이언트는 `skkuverse-app` = RN + Expo + TS)
>
> **운영 진실의 우선순위**: `CLAUDE.md` > `README.md` > `features/<feature>/README.md` > `docs/notices-api-architecture.md` > `docs/cicd-and-branch-protection.md` > 본 문서. 충돌 시 위쪽이 이긴다.

---

# Part 1: Server & Deployment

# Deployment Guide: skkuverse-server → Oracle Cloud Free Tier

## Context

Deploy the Express API server to Oracle Cloud Free Tier with domain `api.skkuverse.com` (Cloudflare DNS). The project already has production-ready Docker config (Dockerfile, docker-compose.yml, health checks, graceful shutdown, non-root user, resource limits).

---

## Recommended Architecture

```
Client → Cloudflare (DNS proxy, SSL, DDoS) → Oracle Cloud ARM VM → Nginx → Docker (Express :3000)
```

### Why this stack (not Cloudflare Tunnel)

| Approach | Pros | Cons |
|----------|------|------|
| **Nginx + Cloudflare DNS Proxy** (recommended) | Full control, lower latency for API, standard setup, easy debugging | Need to open ports 80/443 on OCI |
| Cloudflare Tunnel | No open ports, simpler firewall | Extra hop adds latency (bad for real-time bus API), `cloudflared` daemon uses memory, harder to debug |

For a real-time bus tracking API with 10-15s polling intervals, minimizing latency matters. Nginx + Cloudflare DNS Proxy is the better fit.

---

## Step-by-Step Preparation Checklist

### 1. Oracle Cloud Setup

- [ ] Create OCI account (free tier)
- [ ] Create ARM instance: **VM.Standard.A1.Flex** (1 OCPU, 6GB RAM is plenty)
  - OS: **Ubuntu 22.04** (or 24.04) — better Docker support than Oracle Linux
  - Boot volume: 50GB (free tier allows up to 200GB total)
- [ ] Download SSH key pair during instance creation
- [ ] Note the public IP address

### 2. OCI Networking (CRITICAL — most common blocker)

Three layers of firewall must ALL allow traffic:

#### Layer 1: VCN Security List (OCI Console)
- Add **Ingress Rules** for TCP ports 80 and 443 (source: 0.0.0.0/0)
- SSH (port 22) is already open by default

#### Layer 2: OS-level firewall (iptables)
```bash
# Ubuntu on OCI comes with restrictive iptables
# IMPORTANT: Insert rules BEFORE the REJECT rule, not after
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

#### Layer 3: Docker handles container port mapping automatically

### 3. Server Software Installation

```bash
# Install Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg
# Add Docker's official GPG key and repository
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
```

### 4. Nginx Reverse Proxy (on host, outside Docker)

Install Nginx on the host to handle SSL termination and proxying:

```bash
sudo apt install -y nginx
```

Nginx config is version-controlled at `infra/nginx/api.skkuverse.com` in the repo. Copy it to the server:

```bash
sudo cp infra/nginx/api.skkuverse.com /etc/nginx/sites-available/
```

The config uses an upstream block with passive health checks for load balancing between two API replicas. See `infra/nginx/api.skkuverse.com` for the full config.

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/api.skkuverse.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Cloudflare Configuration

#### DNS Records
- **A Record**: `api` → Oracle VM public IP, **Proxy ON** (orange cloud)

#### SSL/TLS Settings
- SSL mode: **Full (Strict)**
- Generate **Origin Certificate** (Cloudflare dashboard → SSL/TLS → Origin Server)
  - 15-year validity, free
  - Download `.pem` and `-key.pem`, place on server at `/etc/ssl/cloudflare/`

#### Recommended Cloudflare Settings
- **Always Use HTTPS**: ON
- **Minimum TLS Version**: 1.2
- **Auto Minify**: OFF (it's an API, not a website)
- **Caching**: Create a Cache Rule for `api.skkuverse.com/*` → Cache Level: Bypass
  - API responses should NOT be cached by Cloudflare

### 6. Deploy the Application

```bash
# On the Oracle VM
git clone <your-repo> ~/skkuverse-server
cd ~/skkuverse-server

# Create .env with production values
nano .env

# Build and start
docker compose up -d --build

# Verify
docker compose ps
curl http://localhost:3001/health/ready
curl http://localhost:3002/health/ready
```

### 7. docker-compose.yml Port Binding

The docker-compose.yml runs two API replicas with localhost-only ports (Nginx handles external traffic):

```yaml
# api-1
ports:
  - "127.0.0.1:3001:3000"

# api-2
ports:
  - "127.0.0.1:3002:3000"
```

This prevents direct access to the Express app, forcing all traffic through Nginx. The Nginx upstream block load-balances between the two replicas.

### 8. Swagger URL Update

Set in `.env`:
```
SWAGGER_SERVER_URL=https://api.skkuverse.com
```

Note: Swagger UI is disabled in production mode per current config, so this is only relevant if you re-enable it.

---

## MongoDB Atlas Configuration

MongoDB is hosted on Atlas (cloud). No need to run MongoDB on the Oracle VM.

- [ ] **Allowlist Oracle VM's public IP** in Atlas → Network Access → IP Access List
- [ ] Verify `MONGO_URL` in `.env` points to Atlas cluster
- [ ] Test connectivity from VM: `docker compose exec api-1 wget -qO- --timeout=5 https://cloud.mongodb.com` (basic DNS check)
- [ ] Consider: allowlist `0.0.0.0/0` temporarily during setup, then restrict to VM IP only

---

## Security Hardening

- [ ] SSH key-only auth (disable password login)
- [ ] `fail2ban` for SSH brute-force protection
- [ ] Firewall only allows 22, 80, 443
- [ ] Docker port bound to 127.0.0.1 only
- [ ] Cloudflare Origin Certificate for encrypted origin traffic
- [ ] Consider: Cloudflare "Authenticated Origin Pulls" to ensure only Cloudflare can reach your Nginx

---

## Monitoring & Maintenance

- [ ] `docker compose logs -f` for app logs
- [ ] Nginx access/error logs: `/var/log/nginx/`
- [ ] Set up auto-restart: Docker `unless-stopped` already configured
- [ ] OS auto-updates: `sudo apt install unattended-upgrades`
- [ ] Disk monitoring: free tier has limited storage

---

## Cost Analysis

| Resource | Free Tier Allowance | Your Usage |
|----------|-------------------|------------|
| ARM Compute | 4 OCPU, 24GB RAM | 1 OCPU, 6GB RAM |
| Boot Volume | 200GB total | 50GB |
| Outbound Data | 10TB/month | Minimal (API JSON) |
| Public IP | 1 per instance | 1 |
| **Cloudflare** | Free plan | DNS, proxy, SSL |
| **MongoDB Atlas** | Free tier (512MB) | Already using Atlas |

**Total monthly cost: $0**

---

## Verification

1. `curl https://api.skkuverse.com/health` → `{"status":"ok","uptime":...}`
2. Test from Flutter app by updating base URL
3. Check Cloudflare Analytics for traffic flow
4. Verify SSL with `curl -vI https://api.skkuverse.com`

---

# Bus Schedule System — Server Architecture

## Overview

The bus schedule system serves campus shuttle timetables through a **Server-Driven UI (SDUI)** approach. The client fetches a config describing all bus groups, then fetches weekly schedule data per service. The server resolves schedules through a 3-step engine that combines recurring patterns, date-specific overrides, and static fallback config.

Two types of buses exist in the system:

| Type | Data source | Example |
|------|-------------|---------|
| **realtime** | External API polling (10-15s) | HSSC shuttle, Jongro 02/07 |
| **schedule** | MongoDB collections | Campus INJA/JAIN, Fasttrack |

This document covers the **schedule** type only.

---

## System Diagram

```
Client
  │
  ├── GET /ui/home/buslist     → SDUI card list (derived from getBusGroups, visibility-filtered)
  ├── GET /bus/config          → all groups[] (backward compat)
  ├── GET /bus/config/:groupId → single group config (on-demand)
  │
  ├── GET /bus/schedule/data/:serviceId/smart     ← 메인 (auto-select + status)
  └── GET /bus/schedule/data/:serviceId/week      ← deprecated (raw 7-day)

Server
  │
  ├── bus-config.data.js       → getBusGroups() — SSOT for all bus groups
  │     ├── ui.buslist.js      → reads getBusGroups(), filters visibility, maps to cards
  │     └── bus-config.routes  → serves full group(s) with ETag/304
  ├── service.config.js        → per-service operational defaults + suspend config
  ├── schedule.data.js         → resolveWeek() + resolveSmartSchedule() — resolution engine
  └── schedule.routes.js       → HTTP handler + ETag caching + i18n message injection

MongoDB (bus_campus_dev / bus_campus)
  │
  ├── bus_schedules            → recurring weekly patterns
  └── bus_overrides            → date-specific overrides (holidays, events)
```

---

## File Map

| File | Role |
|------|------|
| `features/bus/bus-config.data.js` | `getBusGroups(lang)` — SSOT for all bus groups (includes stations for realtime); `getGroupById()`, `computeGroupEtag()` |
| `features/bus/bus-config.routes.js` | `GET /bus/config` — all groups; `GET /bus/config/:groupId` — single group with ETag/304 |
| `features/bus/realtime.routes.js` | `GET /bus/realtime/data/:groupId` — live bus positions + stationEtas |
| `features/bus/service.config.js` | Static config: serviceId → `{ nonOperatingDayDisplay, notices, suspend }` |
| `features/bus/schedule.data.js` | `resolveWeek()` + `resolveSmartSchedule()` — resolution engine |
| `features/bus/schedule.routes.js` | `/smart` (main) + `/week` (deprecated) — HTTP handlers |
| `features/bus/schedule-db.js` | `ensureScheduleIndexes()` — creates DB indexes at startup |
| `features/bus/campus-eta.routes.js` | `GET /bus/campus/eta` — driving ETA between campuses (separate) |
| `lib/i18n.js` | Translation keys for group labels, service tabs, badges |

---

## 1. Bus Config (`/bus/config`, `/bus/config/:groupId`)

`getBusGroups()` is the **Single Source of Truth (SSOT)** for all bus groups. Both the SDUI buslist (`/ui/home/buslist`) and the config endpoints read from this function. Adding a new group to `getBusGroups()` automatically makes it appear in the buslist and available via the config endpoint.

### What it returns

**All groups** — `GET /bus/config`:

```
GET /bus/config
Accept-Language: ko

→ 200 OK
{
  "meta": { "lang": "ko" },
  "data": {
    "groups": [
      { id: "hssc",      screenType: "realtime",  ... },
      { id: "campus",    screenType: "schedule",  ... },
      { id: "fasttrack", screenType: "schedule",  ... },
      { id: "jongro02",  screenType: "realtime",  ... },
      { id: "jongro07",  screenType: "realtime",  ... }
    ]
  }
}
```

**Single group** — `GET /bus/config/:groupId`:

```
GET /bus/config/campus
Accept-Language: ko

→ 200 OK
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "campus",
    "screenType": "schedule",
    "label": "인자셔틀",
    "visibility": { "type": "always" },
    "card": { ... },
    "screen": { ... }
  }
}

GET /bus/config/unknown → 404 { meta: { error: "GROUP_NOT_FOUND" }, data: null }
```

### Group shape

```js
{
  id: "campus",                          // unique identifier
  screenType: "schedule",                // "realtime" | "schedule"
  label: "인자셔틀",                       // i18n display name
  visibility: { type: "always" },        // when to show this group
  card: {                                // bus list card appearance
    themeColor: "003626",                // hex color (no #)
    iconType: "shuttle",                 // "shuttle" | "village"
    busTypeText: "성대",                  // badge text on card
  },
  screen: { ... }                        // screen-type-specific data (see below)
}
```

### Screen types

**realtime** — the client polls for live bus positions:
```js
screen: {
  dataEndpoint: "/bus/realtime/data/hssc",  // polled at refreshInterval
  refreshInterval: 10,                      // seconds between polls
  lastStationIndex: 10,                     // last valid station index
  stations: [                               // static station list (fetched once with config)
    { index: 0, name: "농구장", stationNumber: null, isFirstStation: true, ... },
    // ...
  ],
  routeOverlay: null,                       // or { routeId, endpoint } for Jongro
  features: []
}
```

**schedule** — the client renders a weekly timetable:
```js
screen: {
  defaultServiceId: "campus-inja",       // which tab is selected first
  services: [                            // tabs the user can switch between
    {
      serviceId: "campus-inja",
      label: "인사캠 → 자과캠",
      endpoint: "/bus/schedule/data/campus-inja/smart"
    },
    {
      serviceId: "campus-jain",
      label: "자과캠 → 인사캠",
      endpoint: "/bus/schedule/data/campus-jain/smart"
    }
  ],
  heroCard: {                            // optional — real-time ETA card above schedule
    etaEndpoint: "/bus/campus/eta",
    showUntilMinutesBefore: 0
  },
  routeBadges: [                         // color-coded route type labels
    { id: "regular", label: "일반", color: "003626" },
    { id: "hakbu", label: "학부대학", color: "1565C0" }
  ],
  features: [                            // optional action buttons
    { type: "info", url: "https://..." }
  ]
}
```

### Visibility

Controls whether the group appears in the client's bus list:

| Type | Behavior |
|------|----------|
| `{ type: "always" }` | Always visible |
| `{ type: "dateRange", from: "YYYY-MM-DD", until: "YYYY-MM-DD" }` | Visible only within the date range (inclusive, KST) |

Fasttrack uses `dateRange` because it only runs during events (e.g., ESKARA).

### ETag caching

- **All groups**: `computeEtag(lang)` → MD5 of `JSON.stringify(getBusGroups(lang))`, cached per language
- **Single group**: `computeGroupEtag(id, lang)` → MD5 of `JSON.stringify(group)`, cached per `id:lang`
- Since bus-config.data.js is static (no DB reads), ETags never change unless the server restarts with code changes
- `If-None-Match` → `304 Not Modified` (both endpoints)
- `Cache-Control: public, max-age=300` (5 min)

---

## 2. Service Config (`service.config.js`)

A static JS object that maps every known `serviceId` to its operational defaults. This is the **single source of truth** for which services exist.

```js
module.exports = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "info", text: "25년도 2학기 인자셔틀 시간표 업데이트" }
    ],
    suspend: null,                          // null = 운행 중
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [],
    suspend: null,
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "warning", text: "ESKARA 기간 한정 운행" }
    ],
    suspend: null,
  },
};
```

### `nonOperatingDayDisplay`

When the resolution engine finds no pattern and no override for a given day:

| Value | Client behavior |
|-------|----------------|
| `"noService"` | Show the day with a "운행 없음" (no service) message |
| `"hidden"` | Completely hide the day from the schedule view |

All current services use `"hidden"` (Sat/Sun or non-event days are hidden from the schedule chip bar).

### `notices`

Array of persistent notices attached to every day that has `display: "schedule"`. Each notice has:
- `style`: `"info"` | `"warning"` — determines visual styling
- `text`: notice message

These get tagged with `source: "service"` in the resolved output (see resolution engine).

### `suspend`

Controls service-wide suspension (e.g., vacation periods). When set, `resolveSmartSchedule` returns immediately with `status: "suspended"` — **zero DB queries**.

| Value | Meaning |
|-------|---------|
| `null` | Normal operation |
| `{ from: "YYYY-MM-DD", until: "YYYY-MM-DD" }` | Suspended during this period (both inclusive) |

Example — summer vacation:
```js
suspend: { from: "2026-06-21", until: "2026-08-31" }
// → resumeDate auto-calculated: "2026-09-01" (until + 1 day)
```

**Validation**: At runtime, `resolveSmartSchedule` checks `moment.isValid()` and `from <= until`. Invalid config is ignored with `logger.warn` — fail-open to prevent config typos from breaking the entire service.

**Boundary behavior**: `moment.isBetween(from, until, 'day', '[]')` — both `from` and `until` days are inclusive. On `until` day 23:59 KST the service is still suspended; at `until + 1` day 00:00 KST it becomes active.

---

## 3. MongoDB Schema

### Database

Uses `config.mongo.dbName` from `lib/config.js`:
- Development: `bus_campus_dev`
- Production: `bus_campus`

### `bus_schedules` collection

Stores recurring weekly patterns. Each document is one pattern for one service.

```js
{
  serviceId: "campus-inja",     // which service this belongs to
  patternId: "weekday",         // human-readable pattern name
  days: [1, 2, 3, 4],           // ISO weekday numbers (1=Mon, 7=Sun)
  entries: [
    { index: 1, time: "08:00", routeType: "regular", busCount: 3, notes: null },
    { index: 2, time: "08:30", routeType: "hakbu",   busCount: 1, notes: null },
    // ...
  ]
}
```

**Index**: `{ serviceId: 1, patternId: 1 }` unique

A service can have multiple patterns (e.g., `weekday` for Mon-Thu, `friday` for Fri). Days without any matching pattern fall through to `nonOperatingDayDisplay`.

### `bus_overrides` collection

Date-specific overrides that take priority over patterns. Used for holidays, special events, or temporary schedule changes.

```js
// Holiday — no service
{
  serviceId: "campus-inja",
  date: "2026-03-01",            // YYYY-MM-DD
  type: "noService",
  label: "삼일절",
  notices: [],
  entries: []
}

// Event — replace schedule
{
  serviceId: "fasttrack-inja",
  date: "2026-03-09",
  type: "replace",
  label: "ESKARA 1일차",
  notices: [
    { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" }
  ],
  entries: [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
    // ...
  ]
}
```

**Index**: `{ serviceId: 1, date: 1 }` unique

**Override types**:

| `type` | Effect |
|--------|--------|
| `"replace"` | Use `entries` from override instead of pattern. `display: "schedule"` |
| `"noService"` | No buses run. `display: "noService"`, empty entries |

---

## 4. Resolution Engine (`resolveWeek`)

The core function in `schedule.data.js`. Given a `serviceId` and optional `from` date, it returns a 7-day resolved schedule.

### Algorithm

For each day (Monday → Sunday):

```
Step 1: Check bus_overrides for { serviceId, date }
  ├── type: "replace"
  │     → display: "schedule"
  │     → schedule = override.entries
  │     → notices = [...service notices, ...override notices]
  │     → label = override.label
  │
  ├── type: "noService"
  │     → display: "noService"
  │     → schedule = [], notices = []
  │     → label = override.label
  │
  └── not found → Step 2

Step 2: Check bus_schedules for pattern where days[] contains dayOfWeek
  ├── found
  │     → display: "schedule"
  │     → schedule = pattern.entries
  │     → notices = [...service notices]
  │     → label = null
  │
  └── not found → Step 3

Step 3: Use serviceConfig.nonOperatingDayDisplay
  ├── "noService" → display: "noService", empty schedule/notices
  └── "hidden"   → display: "hidden", empty schedule/notices
```

### `from` date normalization

- Any date is normalized to that week's Monday (ISO weekday)
- If omitted, defaults to current Monday (Asia/Seoul timezone)
- Both `requestedFrom` (original client value or null) and `from` (normalized Monday) are in the response

### DB queries

Only **2 queries** per resolution, regardless of how many days have overrides:

1. `bus_overrides.find({ serviceId, date: { $gte: monday, $lte: sunday } })` — batch all 7 days
2. `bus_schedules.find({ serviceId })` — all patterns for this service

Pattern matching (which days[] array contains the day) is done in-memory.

### Notice source tagging

Notices in the response are tagged with their origin:

```js
{ style: "info", text: "...", source: "service" }   // from service.config.js
{ style: "info", text: "...", source: "override" }   // from bus_overrides document
```

Service notices appear on every `display: "schedule"` day. Override notices only appear on override days (type: "replace").

### Response shape

```js
{
  serviceId: "campus-inja",
  requestedFrom: "2026-03-12",    // original client value (null if omitted)
  from: "2026-03-09",             // normalized to Monday
  days: [
    {
      date: "2026-03-09",
      dayOfWeek: 1,               // 1=Mon, 7=Sun (ISO)
      display: "schedule",        // "schedule" | "noService" | "hidden"
      label: null,                // string from override, or null
      notices: [
        { style: "info", text: "...", source: "service" }
      ],
      schedule: [
        { index: 1, time: "08:00", routeType: "regular", busCount: 3, notes: null },
        // ...
      ]
    },
    // ... 7 days total (Mon-Sun)
  ]
}
```

---

## 5. Smart Schedule Engine (`resolveSmartSchedule`)

Wraps `resolveWeek` to provide a client-ready response with auto-selected date and status field.

### Algorithm

```
1. Check suspend config
   ├── svcCfg.suspend exists AND today ∈ [from, until] (inclusive)
   │     → return { status: "suspended", resumeDate: until+1, days: [] }
   │     → 0 DB queries
   ├── invalid suspend config (bad dates, from > until)
   │     → logger.warn, ignore suspend, continue
   └── suspend null or outside range → continue

2. Scan this week (resolveWeek with this Monday)
   └── From today's index to Sunday, find first display:"schedule" day

3. If not found, scan next week (resolveWeek with next Monday)
   └── From Monday to Sunday, find first display:"schedule" day

4. Result:
   ├── selectedDate found → status: "active"
   │     filter out hidden days → return visibleDays
   └── selectedDate null → status: "noData"
         logger.warn, return { days: [] }
```

### Response shapes

**`status: "active"`** — normal operation:
```json
{
  "serviceId": "campus-inja",
  "status": "active",
  "from": "2026-03-16",
  "selectedDate": "2026-03-16",
  "days": [...]
}
```

**`status: "suspended"`** — within suspend period:
```json
{
  "serviceId": "campus-inja",
  "status": "suspended",
  "resumeDate": "2026-09-01",
  "from": null,
  "selectedDate": null,
  "days": []
}
```

**`status: "noData"`** — no schedule found within 2 weeks (data gap):
```json
{
  "serviceId": "campus-inja",
  "status": "noData",
  "from": null,
  "selectedDate": null,
  "days": []
}
```

### Status semantics

| Status | When | DB queries | Logger | Client behavior |
|--------|------|-----------|--------|-----------------|
| `active` | Schedule found | 2-4 (1-2 weeks) | — | Render timetable |
| `suspended` | Today ∈ suspend range | 0 | — | Show empty state + message + resumeDate |
| `noData` | No suspend, no schedule in 2 weeks | 4 | `logger.warn` | Show empty state + message |

### Message injection (route layer)

`resolveSmartSchedule` returns raw status without message. The route handler adds i18n messages:

```js
const data = result.status === "active"
  ? { ...result }
  : { ...result, message: t(`schedule.${result.status}`, req.lang) };
```

| Key | ko | en | zh |
|-----|----|----|-----|
| `schedule.suspended` | 운휴 기간입니다 | Service is suspended | 停运期间 |
| `schedule.noData` | 시간표 정보를 준비 중입니다 | Schedule information is being prepared | 正在准备时刻表信息 |

`active` responses do **not** include a `message` field.

---

## 6. Schedule Routes (`/bus/schedule/data/:serviceId/...`)

### `GET /data/:serviceId/smart` — Main endpoint

Returns the most relevant week with auto-selected date and status field. Hidden days are filtered out.

```
GET /bus/schedule/data/campus-inja/smart
Accept-Language: ko|en|zh
```

**Active response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "status": "active",
    "from": "2026-03-16",
    "selectedDate": "2026-03-16",
    "days": [
      {
        "date": "2026-03-16", "dayOfWeek": 1, "display": "schedule",
        "label": null,
        "notices": [{ "style": "info", "text": "...", "source": "service" }],
        "schedule": [{ "index": 1, "time": "08:00", "routeType": "regular", "busCount": 1, "notes": null }]
      }
    ]
  }
}
```

**Suspended response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "status": "suspended",
    "resumeDate": "2026-09-01",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "운휴 기간입니다"
  }
}
```

**NoData response:**
```json
{
  "meta": { "lang": "en" },
  "data": {
    "serviceId": "campus-inja",
    "status": "noData",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "Schedule information is being prepared"
  }
}
```

### ETag (smart)

Format varies by status:

| Status | ETag format |
|--------|-------------|
| `active` | `"smart-{serviceId}-{from}-{md5}"` |
| `suspended` | `"smart-{serviceId}-suspended-{md5}"` |
| `noData` | `"smart-{serviceId}-noData-{md5}"` |

Implementation: `data.from || data.status` — uses `from` when present, falls back to `status` when `from` is null.

- `If-None-Match` → `304 Not Modified`
- `Cache-Control: public, max-age=300` (5 min)

### `GET /data/:serviceId/week` — Deprecated

Raw 7-day resolved schedule. Logs `req.log.warn("deprecated: /week endpoint called, use /smart")` on every call.

```
GET /bus/schedule/data/campus-inja/week?from=2026-03-09
```

Still returns the same response shape as before (no `status` field). Maintained for backward compatibility during app update transition.

### Validation (both endpoints)

| Condition | Response |
|-----------|----------|
| `from` provided but not `YYYY-MM-DD` (week only) | `400 { meta: { error: "INVALID_DATE_FORMAT" } }` |
| `serviceId` not in service.config.js | `404 { meta: { error: "SERVICE_NOT_FOUND" } }` |

### Error format

Schedule endpoints use a different error format from the global `res.error()`:

```js
// Schedule errors
{ meta: { error: "CODE", message: "..." }, data: null }

// Global errors (everywhere else)
{ error: { code: "CODE", message: "..." } }
```

---

## 7. Caching

### Schedule data cache (in-memory)

| Property | Value |
|----------|-------|
| Location | `schedule.data.js` — `Map` instance |
| Key | `{serviceId}:{from}` (e.g., `campus-inja:2026-03-09`) |
| TTL | 1 hour |
| Invalidation | `clearCache()` — clear all, `clearCacheForService(serviceId)` — clear one service |

The cache stores the resolved week data. On cache hit, only `requestedFrom` is replaced (since it varies per call but the schedule data is the same).

**When to invalidate**: After inserting/updating documents in `bus_schedules` or `bus_overrides`. Currently manual (call `clearCache()` or `clearCacheForService()` from a management endpoint or script). No automatic invalidation.

### Bus config ETag cache (in-memory)

| Property | Value |
|----------|-------|
| Location | `bus-config.data.js` — `Map` instance |
| Key | language code (`"ko"`, `"en"`, `"zh"`) |
| TTL | Forever (until server restart) |

Since bus config is static code (no DB reads), the ETag only changes on deployment. The client uses `If-None-Match` to avoid re-downloading unchanged config.

### HTTP-level caching

Both schedule/config endpoints set `Cache-Control: public, max-age=300`, allowing CDN/browser caching for 5 minutes. Combined with ETag, clients get fast 304 responses after the cache expires.

### Realtime data caching

| Property | Value |
|----------|-------|
| Location | `realtime.routes.js` — no server cache |
| HTTP | `Cache-Control: no-store` |
| Client | Polls at `refreshInterval` from config (10s for HSSC, 40s for Jongro) |

Realtime data is always fresh — the server reads from in-memory fetcher state (or busCache fallback) on every request.

---

## 8. How to Add a New Schedule-Type Bus

Step-by-step guide to adding a new bus service (e.g., a new shuttle route "nsc-express").

### Step 1: Add service config

**File**: `features/bus/service.config.js`

```js
module.exports = {
  // ... existing services ...
  "nsc-express": {
    nonOperatingDayDisplay: "noService",  // or "hidden" for event-only
    notices: [],                          // persistent notices, or leave empty
    suspend: null,                        // null = operating, or { from, until }
  },
};
```

This is the **minimum requirement** for the resolution engine to recognize the service.

### Step 2: Add schedule data to MongoDB

Insert patterns into `bus_schedules`:

```js
// Runs every weekday
db.bus_schedules.insertOne({
  serviceId: "nsc-express",
  patternId: "weekday",
  days: [1, 2, 3, 4, 5],
  entries: [
    { index: 1, time: "09:00", routeType: "express", busCount: 1, notes: null },
    { index: 2, time: "12:00", routeType: "express", busCount: 1, notes: null },
    { index: 3, time: "18:00", routeType: "express", busCount: 1, notes: null },
  ]
});
```

Optionally add overrides for specific dates:

```js
// Holiday override
db.bus_overrides.insertOne({
  serviceId: "nsc-express",
  date: "2026-05-05",
  type: "noService",
  label: "어린이날",
  notices: [],
  entries: []
});
```

At this point, `GET /bus/schedule/data/nsc-express/smart` already works. The service config + DB data is all the resolution engine needs.

### Step 3: Add i18n keys

**File**: `lib/i18n.js`

```js
"busconfig.label.nsc-express": {
  ko: "자과캠 급행",
  en: "NSC Express",
  zh: "自然校区快速",
},
"busconfig.service.nsc-express": {
  ko: "자과캠 급행",
  en: "NSC Express",
  zh: "自然校区快速",
},
"busconfig.badge.express": {
  ko: "급행",
  en: "Express",
  zh: "快速",
},
```

### Step 4: Add group to bus config (SSOT)

**File**: `features/bus/bus-config.data.js`

Add a new entry to the array inside `getBusGroups()`. This is the **only place** you need to add it — the SDUI buslist (`/ui/home/buslist`) automatically derives its cards from this array, and the per-group config endpoint (`/bus/config/:groupId`) serves the full group data.

```js
{
  id: "nsc-express",
  screenType: "schedule",
  label: t("busconfig.label.nsc-express", lang),
  visibility: { type: "always" },  // or dateRange for event-only
  card: {
    themeColor: "1565C0",
    iconType: "shuttle",
    busTypeText: t("busconfig.badge.express", lang),
  },
  screen: {
    defaultServiceId: "nsc-express",
    services: [
      {
        serviceId: "nsc-express",
        label: t("busconfig.service.nsc-express", lang),
        endpoint: "/bus/schedule/data/nsc-express/smart",
      },
    ],
    heroCard: null,
    routeBadges: [
      { id: "express", label: t("busconfig.badge.express", lang), color: "1565C0" },
    ],
    features: [],
  },
},
```

**Position matters** — the array order is the display order in the client's bus list.

**No separate buslist entry needed** — `ui.buslist.js` reads from `getBusGroups()` and applies visibility filtering automatically.

### Step 5: Add tests

- `__tests__/bus-config.test.js` — update group count assertion, add shape checks for the new group
- `__tests__/service-config.test.js` — add the new serviceId to the known services list

### Summary checklist

| Step | File | Required? |
|------|------|-----------|
| 1. Service config | `service.config.js` | Yes — engine won't recognize the service without it |
| 2. MongoDB data | `bus_schedules` + `bus_overrides` | Yes — without patterns, all days fall to `nonOperatingDayDisplay` |
| 3. i18n keys | `lib/i18n.js` | Yes — labels appear as raw keys without translations |
| 4. Bus config group | `bus-config.data.js` | Yes — client won't show the bus without a group entry |
| 5. Tests | `__tests__/*.test.js` | Recommended |

No route changes needed — `schedule.routes.js` handles any serviceId dynamically.

---

## 9. How to Add Overrides (Holidays, Events)

### Holiday (no service)

Insert a `noService` override for each affected service:

```js
db.bus_overrides.insertMany([
  {
    serviceId: "campus-inja",
    date: "2026-06-06",
    type: "noService",
    label: "현충일",
    notices: [],
    entries: []
  },
  {
    serviceId: "campus-jain",
    date: "2026-06-06",
    type: "noService",
    label: "현충일",
    notices: [],
    entries: []
  }
]);
```

### Temporary event (replace schedule)

Insert a `replace` override with custom entries and notices:

```js
db.bus_overrides.insertOne({
  serviceId: "fasttrack-inja",
  date: "2026-09-11",
  type: "replace",
  label: "ESKARA 1일차",
  notices: [
    { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" }
  ],
  entries: [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
  ]
});
```

### After inserting overrides

If the server is running, the in-memory cache may still serve stale data (up to 1 hour). Options:

1. **Wait** — cache expires after 1 hour TTL
2. **Restart server** — clears all caches
3. **Call cache invalidation** — if you have a management endpoint that calls `clearCacheForService(serviceId)`

---

## 10. Entry Shape Reference

Every schedule entry (in both `bus_schedules` and `bus_overrides`) has:

```js
{
  index: 1,                    // display order (1-based)
  time: "08:00",               // departure time (HH:mm, 24h, KST)
  routeType: "regular",        // matches a routeBadge.id in bus-config
  busCount: 3,                 // number of buses at this time
  notes: null                  // optional text (e.g., "비천당 앞 출발")
}
```

`routeType` values are defined per group's `routeBadges` array in bus-config:
- campus: `"regular"`, `"hakbu"`
- fasttrack: `"fasttrack"`
- Custom services can define their own

---

## 11. Testing

### Running tests

```bash
npm test                                        # all tests with coverage
npx jest __tests__/schedule-data.test.js         # resolution engine only
npx jest __tests__/schedule-routes.test.js       # route handler only
npx jest __tests__/bus-config.test.js            # bus config only
npx jest __tests__/service-config.test.js        # service config only
```

### Test architecture

Tests mock MongoDB via `jest.mock("../../lib/db")` and inject fake data. No real DB connection needed.

Key test files:
- `__tests__/schedule-data.test.js` — 25 tests: resolveWeek (14) + resolveSmartSchedule (10, incl. suspend/noData/boundary) + cache (1)
- `__tests__/schedule-routes.test.js` — 19 tests: /week (8) + /smart (11, incl. status/message/ETag/i18n)
- `__tests__/bus-config.test.js` — 19 tests for group structure, i18n, ETag, per-group lookup
- `__tests__/bus-config-routes.test.js` — 6 tests for per-group HTTP endpoint (200/404/304, ETag)
- `__tests__/service-config.test.js` — 11 tests for config shape validation (incl. suspend field)

### What's mocked in test files that load `index.js`

Any test that `require("../index")` (e.g., `route-responses.test.js`, `app-config.test.js`) must mock:

```js
jest.mock("../features/bus/schedule.data", () => ({
  resolveWeek: jest.fn().mockResolvedValue(null),
  resolveSmartSchedule: jest.fn().mockResolvedValue(null),
  clearCache: jest.fn(),
  clearCacheForService: jest.fn(),
}));
jest.mock("../features/bus/schedule-db", () => ({
  ensureScheduleIndexes: jest.fn().mockResolvedValue(),
}));
jest.mock("../features/bus/campus-eta.data", () => ({
  getEtaData: jest.fn().mockResolvedValue({ inja: null, jain: null }),
  clearCache: jest.fn(),
}));
```

---

## 12. Scripts

### `scripts/archive/`

완료된 1회성 마이그레이션 보존 위치. 운영 코드는 새 스키마를 가정하므로 재실행은 보통 불필요(모두 idempotent하게 작성되어 있어 다시 돌려도 no-op). 어떤 변경이 적용됐는지 추적할 때 참고용으로 남겨둔다. 재실행이 필요해진 경우 git history(특히 첨부된 fix 커밋들)도 같이 확인할 것.

- `migrate-building-two-layer.js` — 빌딩 데이터 raw/enriched 2-layer 분리 (feat `d2723a5`)
- `migrate-inja-schedule.js` — INJA/JAIN 스케줄에 `routeType` 추가 (feat `ae6ec3a`)
- `migrate-schedules.js` — 구 per-collection 포맷 → 통합 `bus_schedules` 이전 (feat `d5271f0`)
- `migrate-source-dept-id.js` — `sourceDeptId` → `sourceId` 필드 rename (refactor `70923f6`, 후속 fix `8c62055`)

### `scripts/seed-eskara.js`

Seeds ESKARA fasttrack-inja test data into the dev DB.

- **Writes to**: `bus_campus_dev.bus_overrides`
- **Creates**: 2 override documents (2026-03-09 with 4 entries, 2026-03-10 with 9 entries)

```bash
node scripts/seed-eskara.js
```

---

## 13. Endpoint Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/bus/config` | GET | Bus groups array (SDUI config) |
| `/bus/config/:groupId` | GET | Single group config (on-demand, includes stations for realtime) |
| `/bus/realtime/data/:groupId` | GET | Realtime bus positions + stationEtas (polled) |
| `/bus/schedule/data/:serviceId/smart` | GET | **Main** — Smart schedule with status + auto-selected date |
| `/bus/schedule/data/:serviceId/week` | GET | **Deprecated** — Raw 7-day resolved schedule |
| `/bus/schedule/data/:serviceId/week?from=YYYY-MM-DD` | GET | **Deprecated** — 7-day schedule for specific week |
| `/bus/campus/eta` | GET | Driving ETA between campuses |

### Headers

**Request**:
- `Accept-Language: ko|en|zh` — determines i18n language (default: ko)
- `If-None-Match: "etag"` — conditional GET for 304

**Response**:
- `ETag: "..."` — for conditional requests
- `Cache-Control: public, max-age=300` — 5-minute browser/CDN cache
- `X-Response-Time: 1.23ms` — server processing time
- `X-Request-Id: uuid` — request correlation

---

## 14. Dependency Policy

TypeScript 전환을 앞두고 (2026-05-24) 모든 의존성을 정확 버전으로 lock. TS 마이그레이션 중 "에러가 TS 문법 때문인지 패키지 버전 변화 때문인지" 분간 불가능한 사태를 방지하기 위함.

### 규칙

- **`package.json`의 모든 deps/devDeps는 정확 버전** (`^`, `~` 금지). `.npmrc`의 `save-exact=true`가 신규 install을 자동으로 정확 버전으로 저장.
- **`engine-strict=true`** — `engines.node` 위반 시 install 실패. Dockerfile이 `node:22-alpine`이므로 macOS 로컬 + Docker 일관성 유지.
- **업데이트 절차**:
  1. 단일 PR에 단일 패키지 bump (`npm install foo@X.Y.Z`).
  2. `npm test` + `npm run lint` + `npm run knip` + `npm run depcheck` 모두 통과.
  3. 메이저 bump는 사용처 영향 분석 commit 메시지에 명시.
- **TS 전환 기간 중에는 패키지 추가/변경 동결.** 신규 의존성이 필요하면 별도 PR로 lock 정책에 맞춰 추가.

### Deferred majors (TS 전환 후 처리)

| 패키지 | 현재 | 최신 | 이유 |
|---|---|---|---|
| `express` | 4.22.2 | 5.x | 16개 route + 미들웨어 chain refactor 필요. 단독 PR로 진행. |
| `dotenv` | 16.6.1 | 17.x | 단순 `require("dotenv").config()` 패턴만 사용하나 보수적으로 16에 머무름. TS 후 평가. |
| `axios` | 1.13.6 | 1.16.x | 이전 maintainer 패턴 따라 의도적으로 정확 핀. 명시적 업데이트 결정 필요. |

### 도구

- `npm run knip` — 미사용 파일/의존성 audit (exports check off; `knip.json` 참고)
- `npm run depcheck` — 미사용 의존성 audit (`@logtail/pino`, `pino-pretty`, `node-cron` ignore — 동적/CLI 로드)

### Node runtime

**Node 22 LTS lock.** `package.json`의 `engines.node`가 `>=22.0.0`이고 `.npmrc`의 `engine-strict=true`가 install 시 자동 차단. 프로젝트 루트 `.nvmrc`(내용: `22`)로 `nvm use` 한 번에 자동 정렬.

선택 이유:
- **Node 20 LTS는 2026-04-30 EOL** — 오늘(2026-05-24) 이미 만료. Dockerfile도 `node:20-alpine` → `node:22-alpine`로 동시 bump.
- **Node 24는 macOS + OpenSSL 3.4 환경에서 외부 TLS 시나리오 회귀 보고** ([nodejs/node#61448](https://github.com/nodejs/node/issues/61448) — MongoDB SRV connection fails in v24.13). 우리 환경(macOS arm64 + Atlas mongodb+srv)에서도 `SSL alert number 80` 증상을 재현했었음.
- **Node 22 LTS는 2027-04-30 EOL** — TS 전환 작업 기간 내내 안전 + mongo driver v7 호환 (driver 최소 요구 Node 20.19+).

#### Node 24 회귀 incident 참고 (2026-05-24)

dev 서버 부팅이 stuck처럼 보였던 별개 incident가 있었음. 원인은 **Atlas Network Access List에 현재 공용 IP가 등록되지 않음** (mongosh도 동일 SSL alert 80로 reject되며 명시 진단). Node 22 다운그레이드로는 해결되지 않으며, Atlas dashboard → Network Access → IP Access List에서 IP 추가 필요. Node 24 회귀 위험과 Atlas IP allowlist는 별개 이슈지만 증상이 같은 SSL alert 80이라 혼동 위험이 있음 — 비슷한 증상 재발 시 먼저 IP allowlist를 확인할 것.

---

## Appendix: Realtime vs Schedule Architecture

```
┌──────────────────────────────────────────────────────┐
│                    /bus/config                        │
│            groups[] (5 bus services)                  │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   hssc   │  │  campus  │  │fasttrack │  ...       │
│  │ realtime │  │ schedule │  │ schedule │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                 │
│       ▼              ▼              ▼                 │
│  /bus/realtime  /bus/schedule   /bus/schedule         │
│  /data/hssc    /data/campus-   /data/fasttrack-      │
│                 inja/smart      inja/smart            │
│       │              │              │                 │
│       │         ┌────┴────┐    ┌────┴────┐           │
│       │         │ suspend │    │ suspend │           │
│       │         │ check   │    │ check   │           │
│       │         └────┬────┘    └────┬────┘           │
│       │              │              │                 │
│       ▼              ▼              ▼                 │
│  External API   MongoDB         MongoDB              │
│  (polling)      bus_schedules   bus_overrides         │
│                 bus_overrides                         │
└──────────────────────────────────────────────────────┘
```

**Realtime buses** (hssc, jongro02, jongro07): Config (stations, refreshInterval, routeOverlay) is served via `/bus/config/:groupId` — fetched once and ETag-cached. Dynamic data (bus positions, stationEtas) is served via `/bus/realtime/data/:groupId` — polled at `refreshInterval` (10-40s) with `Cache-Control: no-store`. No MongoDB involvement; data comes from external APIs.

**Schedule buses** (campus, fasttrack): Data comes from MongoDB collections via `/smart` endpoint. The server auto-selects the best week and date, returns a status field (`active`/`suspended`/`noData`), and filters out hidden days. Suspend periods skip DB entirely. Supports offline viewing since the full week is downloaded at once.

---

# Part 2: External APIs

# HSSC (인사캠 셔틀버스) API

> External API → `config.api.hsscNew`
> Polling: 10초 간격 (`hssc.fetcher.js`)

## 정상 작동 패턴

- 응답: JSON 배열 (각 항목에 `stop_name`, `seq`, `get_date`, `line_no`, `stop_no`)
- `get_date` 형식: `"YYYY-MM-DD a h:mm:ss"` (한국어 locale, 예: `"2025-03-03 오후 3:30:00"`)
- 운행 중: `get_date`가 현재 시간 기준 10분 이내 (농구장 정류소는 3분 이내)
- `seq`는 circular route index (0–10) → `toLinearSequence()`로 linear 1–11로 변환

## 비운행 시간 / 휴일 패턴

- **빈 배열을 반환하지 않음** — 항상 6개 항목이 오지만 `get_date`가 마지막 운행 시간으로 고정
- 야간/휴일: `get_date`가 수시간~수일 전 값 → stale data filter가 전부 제거 → 빈 배열 반환
- 매우 오래된 ghost bus 사례 확인 (fixture에서 `get_date`가 2주 전인 데이터 발견)

## 서버 처리

| 상황 | 처리 |
|---|---|
| 정상 응답 (배열) | `stopNameMapping`으로 역명 변환, stale data 필터링, busCache 저장 |
| 비배열 응답 (HTML, 객체 등) | `if (!Array.isArray(apiData)) return;` — early return, 이전 데이터 유지 |
| API 에러 / 타임아웃 | catch 블록 → 로그, 이전 데이터 유지 |
| 전체 stale 데이터 | 시간 필터링 후 빈 배열 → 앱에 빈 목록 전달 |

## Stale 데이터 필터링

- 기본: `eventDate`가 현재 기준 **10분** 초과 시 제거
- 농구장 (터미널): **3분** 초과 시 제거 (회차 지점이라 더 엄격)
- 기준: `STALE_MINUTES_DEFAULT = 10`, `STALE_MINUTES_TURNAROUND = 3`

## 테스트 커버리지

- `edge-cases.test.js`: stale data → empty, API error → 이전 데이터 유지, 비배열 응답 guard
- `hssc-transform.test.js`: stopNameMapping, sequence 변환, 시간 필터링
- `route-responses.test.js`: HTTP 응답 스키마 (meta, data 구조)

## 라우트 (`/bus/realtime/data/hssc`)

- `realtime.routes.js`에서 통합 제공 (buses + stationEtas)
- `mapBuses()`: fetcher의 1-based `sequence` → 0-based `stationIndex` 변환
- stations는 `/bus/config/hssc` 응답에 포함 (config/data 분리)

## 수정 이력

- **2025-03 비배열 응답 guard 추가** (`hssc.fetcher.js` line 43): `if (!Array.isArray(apiData)) return;`
  - 원인: API가 HTML 에러 페이지나 객체를 반환할 경우 `.map()` 크래시 방지
  - 테스트: `edge-cases.test.js` — "non-array response" 2건 추가, 통과 확인
- **2026-03 config/data 분리**: `hssc.routes.js` + `jongro.routes.js` → `realtime.routes.js` 통합. stations는 `bus-config.data.js`로 이동.

---

# Jongro (종로02, 종로07) API

> External API → `config.api.jongro07List`, `jongro07Loc`, `jongro02List`, `jongro02Loc`
> Polling: 40초 간격 (`jongro.fetcher.js`)

## API 종류

| API | 용도 | 응답 구조 |
|---|---|---|
| `jongroXXList` | 각 정류장별 도착 정보 | `msgBody.itemList[]` — stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 |
| `jongroXXLoc` | 버스 GPS 실시간 위치 | `msgBody.itemList[]` — lastStnId, tmX, tmY, plainNo |

## 정상 작동 패턴

### _list (정류장 도착 정보)
- `headerCd: "0"` — 항상 전체 정류장 목록 반환 (운행 여부 무관)
- `arrmsg1`: 운행 중이면 `"3분12초후[2번째 전]"`, 비운행 시 `"출발대기"` 또는 `"운행종료"`
- `plainNo1`: 운행 중이면 차량 번호 (예: `"서울74사5537"`), 비운행 시 `" "` (공백 1자)

### _loc (GPS 위치)
- 운행 중: `headerCd: "0"`, `itemList`에 현재 위치 데이터
- 비운행 / 휴일: `headerCd: "4"`, `itemList: null` — 버스 없음

## 비운행 시간 / 휴일 패턴

- **종로07**: 마을버스 — 주말/공휴일 미운행. `_loc`은 `itemList: null`, `_list`는 전 정류장 `"출발대기"`
- **종로02**: 일반 시내버스 — 주말/공휴일에도 운행. 휴일에도 정상 데이터 확인
- 심야: 두 노선 모두 `arrmsg1: "운행종료"`, `_loc`은 `itemList: null`
- `firstTm`/`lastTm` 필드: 종로02에서 비정상 값 (`"135900/135900"`) 확인 — 서버에서 사용하지 않으므로 영향 없음

## 서버 처리

| 상황 | _list 처리 | _loc 처리 |
|---|---|---|
| 정상 응답 | 전체 매핑, busCache 저장 | station mapping 후 매핑, busCache 저장 |
| `itemList: null` | early return (`if (!apiData) return;`), 이전 데이터 유지 | 동일 |
| API 에러 | catch → 로그, 이전 데이터 유지 | 동일 |
| 미매핑 정류장 ID | N/A | `logger.debug`로 기록, 해당 항목 null → filter(Boolean) 제거 |

## 차량 번호 (carNumber) 처리

### _list: `plainNo1`
- 정상: `"서울74사5537"` → `.slice(-4)` → `"5537"`
- 비운행: `" "` (공백) 또는 `null` → `(plainNo1 || "").trim().slice(-4) || "----"` → `"----"`

### _loc: `plainNo`
- 정상: `"서울75사2009"` → `.slice(-4)` → `"2009"`
- null/빈값 방어: `(plainNo || "").trim().slice(-4) || "----"` → `"----"`
- 비운행 시에는 `itemList: null` → early return이므로 `plainNo` 처리까지 도달하지 않지만, 일관성을 위해 동일한 guard 적용

## 테스트 커버리지

- `edge-cases.test.js`: 빈 itemList → 빈 배열, API error → 크래시 없음, plainNo1 공백/null → "----", plainNo null → "----"
- `jongro-transform.test.js`: bus list 매핑, carNumber 추출, location 매핑
- `route-responses.test.js`: HTTP 응답 스키마, station/location 라우트

## 수정 이력

- **2025-03 plainNo1 빈 값 처리** (`updateJongroBusList`, line 94): `plainNo1.slice(-4)` → `(plainNo1 || "").trim().slice(-4) || "----"`
  - 원인: 비운행 시 `plainNo1 = " "` → `" ".slice(-4)` = `" "` (공백 반환), null이면 크래시
  - 테스트: `edge-cases.test.js` — plainNo1 공백/null 2건 추가, 통과 확인
- **2025-03 plainNo 빈 값 처리** (`updateJongroBusLocation`, line 63): `plainNo.slice(-4)` → `(plainNo || "").trim().slice(-4) || "----"`
  - 원인: _list의 plainNo1과 동일한 패턴 누락. 일관성 및 방어적 코딩
  - 테스트: `edge-cases.test.js` — plainNo null 1건 추가, 통과 확인
- **2025-03 미매핑 정류장 로깅 추가**: unmapped lastStnId에 `logger.debug` 추가 (line 38)

---

# Station Hyehwa (혜화역 종로07 도착 정보) API

> External API → `config.api.stationHyehwa`
> Polling: 40초 간격 (`station.fetcher.js`)

## 정상 작동 패턴

- 응답: `msgBody.itemList[0].arrmsg1` — 도착 예정 메시지 (예: `"3분후[1번째 전]"`, `"곧 도착"`)
- 빈 `itemList` (길이 0): 버스 없음 → `"정보 없음"` 으로 설정

## 비운행 시간 / 휴일 패턴

- `headerCd: "4"`, `itemList: null` (결과 없음)
- **현재 상태 (2025-02-28 ~ 2025-03-04 수집)**: 198개 fixture 파일 전부 `headerCd: "4"`, `itemList: null`
  - 평일 출퇴근 시간 포함 전 시간대에서 동일
  - API 엔드포인트 또는 정류장 ID 설정 문제로 추정
  - 서버는 graceful하게 처리: `"정보 없음"` 기본값 유지

## 서버 처리

| 상황 | 처리 |
|---|---|
| 정상 응답 (`itemList` 있음) | `arrmsg1` 값 저장, busCache 기록 |
| 빈 `itemList` (길이 0) | `"정보 없음"` 설정 (ghost data 방지) |
| `itemList: null` / `msgBody` 없음 | `response.data?.msgBody?.itemList` → undefined → early return, 이전 데이터 유지 |
| `response.data` 자체가 null | optional chaining → undefined → early return |
| API 에러 / 타임아웃 | catch → 로그, 이전 데이터 유지 |

## Ghost Data 방지

빈 `itemList`가 오면 반드시 `"정보 없음"`으로 리셋:
- 시나리오: 이전 폴링에서 `"3분후 도착"` → 다음 폴링에서 빈 응답 → 오래된 도착 정보를 계속 보여주면 안 됨
- `station.fetcher.js:14`: `arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0].arrmsg1;`

## 라우트 (`/bus/station/01592`)

- 종로07 도착 정보 + 인사캠 셔틀(HSSC) ETA를 합쳐서 반환
- HSSC ETA는 `station.data.js`의 `computeAllStationEtas()`로 계산
- 혜화역(승차장) 정류장의 ETA → `hsscEta`로 반환

## ETA 계산 (`station.data.js`)

- `computeEta(station, busData)`: busData가 null/undefined일 때 `"도착 정보 없음"` 반환 (배열 guard 추가)
- `computeAllStationEtas()`: 각 정류장별 ETA 계산, 원본 배열 mutation 없음

## 테스트 커버리지

- `edge-cases.test.js`: API error → `"정보 없음"`, 정상 업데이트, 빈 itemList → 리셋, 네트워크 에러 → 이전 상태 유지, malformed response (missing msgBody), null response.data
- `station-eta.test.js`: `computeEta` 순수 함수 테스트 (stale bus, terminal skip, fallback, null/undefined busData)
- `route-responses.test.js`: `/bus/station/01592` 응답 스키마

## 수정 이력

- **2025-03 optional chaining 추가** (`station.fetcher.js` line 12): `response.data.msgBody.itemList` → `response.data?.msgBody?.itemList`
  - 원인: `msgBody`가 없을 때 TypeError 발생 가능 (jongro fetcher는 이미 `?.` 사용 중이었음)
  - 테스트: `edge-cases.test.js` — malformed response/null data 2건 추가, 통과 확인
- **2025-03 computeEta 배열 guard 추가** (`station.data.js` line 33): `if (!Array.isArray(busData)) return NO_INFO;`
  - 원인: 호출 체인상 항상 배열이 들어오지만, 만약 busData가 null이면 `.filter()` 크래시
  - 테스트: `station-eta.test.js` — null/undefined busData 2건 추가, 통과 확인

## 참고: API 엔드포인트 점검 필요

수집 데이터 기준 (2025-02-28 ~ 2025-03-04) 전 시간대 `headerCd: "4"` 응답.
정류장 ID 또는 노선 설정 확인 필요. 현재 서버는 문제없이 fallback 처리 중.

---

# External API Usage & Quota Analysis

**Date**: 2026-03-02
**Context**: Old server (`ec2-snapshot` branch, 15s intervals) and new server (`main` branch, 40s intervals) running simultaneously.

---

## 공공데이터포털 (Seoul Open Data) APIs

### Subscribed Services

**1. 정류소 도착예정정보 조회 서비스** (Bus Arrival Info)

| # | Function | Description | Daily Quota |
|---|----------|-------------|-------------|
| 1 | `getArrInfoByRouteAllList` | 경유노선 전체 정류소 도착예정정보 | 20,000 |
| 2 | `getArrInfoByRouteList` | 한 정류소의 특정노선 도착예정정보 | 20,000 |
| 3 | `getLowArrInfoByStIdList` | 정류소ID로 저상버스 도착예정정보 | 20,000 |
| 4 | `getLowArrInfoByRouteList` | 한 정류소의 특정노선 저상버스 도착예정정보 | 20,000 |

**2. 버스위치정보 조회 서비스** (Bus Position Info)

| # | Function | Description | Daily Quota |
|---|----------|-------------|-------------|
| 1 | `getBusPosByRouteStList` | 노선ID와 구간정보로 차량 위치 | 20,000 |
| 2 | `getBusPosByRtidList` | 노선ID로 차량 위치 | 20,000 |
| 3 | `getBusPosByVehIdItem` | 차량ID로 위치 | 20,000 |
| 4 | `getLowBusPosByRtidList` | 노선ID로 저상버스 위치 | 20,000 |
| 5 | `getLowBusPosByRouteStList` | 노선ID와 구간정보로 저상차량 위치 | 20,000 |

### Endpoints We Use

| # | Env Var | Purpose | Old Server (ec2-snapshot) | New Server (main) |
|---|---------|---------|--------------------------|-------------------|
| 1 | `API_JONGRO07_LIST_PROD` | Jongro 07 arrival info (all stops) | 15s | 40s |
| 2 | `API_JONGRO02_LIST_PROD` | Jongro 02 arrival info (all stops) | 15s | 40s |
| 3 | `API_JONGRO07_LOC_PROD` | Jongro 07 bus GPS positions | 15s | 40s |
| 4 | `API_JONGRO02_LOC_PROD` | Jongro 02 bus GPS positions | 15s | 40s |
| 5 | `API_STATION_HEWA` | Hyehwa station bus arrival | 15s | 40s |

### Daily Usage Calculation

Formula: `86,400 seconds/day ÷ interval = calls/day`

| API Endpoint | Old Server (15s) | New Server (40s) | Combined |
|---|---|---|---|
| Jongro 07 List | 5,760 | 2,160 | **7,920** |
| Jongro 02 List | 5,760 | 2,160 | **7,920** |
| Jongro 07 Loc | 5,760 | 2,160 | **7,920** |
| Jongro 02 Loc | 5,760 | 2,160 | **7,920** |
| Station Hyehwa | 5,760 | 2,160 | **7,920** |

### Quota Check (Both Servers Running)

Quota is per-function. Endpoints using the same function share its 20,000/day limit.

| 공공데이터포털 Function | Used By | Combined Calls/Day | Quota | Usage |
|---|---|---|---|---|
| `getArrInfoByRouteAllList` | Jongro 07 List + Jongro 02 List | 7,920 + 7,920 = **15,840** | 20,000 | **79% — Safe** |
| `getArrInfoByRouteList` | Station Hyehwa | **7,920** | 20,000 | **40% — Safe** |
| `getBusPosByRtidList` | Jongro 07 Loc + Jongro 02 Loc | 7,920 + 7,920 = **15,840** | 20,000 | **79% — Safe** |

### Single-Server Scenarios

| Scenario | Interval | Calls/Function/Day | Usage |
|---|---|---|---|
| Old server only (15s) | 15s | 11,520 | 58% |
| New server only (40s) | 40s | 4,320 | 22% |
| New server only (15s) | 15s | 5,760 | 29% |
| Both servers (current) | 15s + 40s | 15,840 | 79% |

> When the old server is retired, the new server interval can be reduced back to 15s (29% usage — plenty of headroom).

---

## Non-공공데이터포털 APIs

### Polled (Background)

| # | Source | Env Var | Purpose | Interval | Quota |
|---|--------|---------|---------|----------|-------|
| 1 | SKKU shuttle system | `API_HSSC_NEW_PROD` / `_DEV` | HSSC campus shuttle bus positions | 10s | None (SKKU internal) |
| 2 | skku.edu | Hardcoded URL | Building/space data sync (3-phase: buildList→buildInfo→spaceList) | 7 days | None (SKKU public) |

> **Building sync** moved from on-demand (per user request) to weekly background sync in `building.sync.js`. Data is stored in MongoDB (`skkubus_building`/`_dev` DB per `MONGO_BUILDING_DB_NAME`) and served via `/building/*` routes. See the Building API section below for endpoint details.

### Old Server Only (ec2-snapshot, not in new server)

| # | Source | URL | Purpose | Interval |
|---|--------|-----|---------|----------|
| 5 | hc-ping.com | `https://hc-ping.com/...` | External healthcheck ping | 10s |
| 6 | vote-hub.app | `https://vote-hub.app/api/voter` | Poll voter key fetch | 1 hour cron |

### Internal Services

| # | Service | Purpose |
|---|---------|---------|
| 7 | MongoDB Atlas | Database reads/writes (ads, bus_cache, schedules) |

---

## Notes

- The HSSC shuttle API (`API_HSSC_NEW`) is SKKU's own system with no public quota.
- 공공데이터포털 quota is **per function per API key per day**, not per URL.
- Jongro 07 and 02 List endpoints call the same `getArrInfoByRouteAllList` function with different route parameters — they share one 20,000 pool.
- `API_STATION_HEWA` has no PROD/DEV split (single env var). All other polled APIs use `apiUrl()` for environment selection.
- The `skku.edu` building sync URLs are hardcoded (not env-var-configured). No known rate limits. Sync runs once per 7 days (~4 calls per sync: 2×buildList + 59×buildInfo + 2×spaceList = 63 total).

---

# SKKU Campus Map API

> External API: `https://www.skku.edu/skku/about/campusInfo/campusMap.do`
> Public endpoint, no auth required. Hardcoded URLs (not in .env).

SKKU 공식 캠퍼스맵에서 제공하는 건물/시설 데이터 API. `mode` 파라미터로 3가지 기능 구분.

## API Modes

### 1. `buildList` — 건물 목록

```
GET campusMap.do?mode=buildList&mode=list&srSearchValue={query}&campusCd={1|2}
```

- `srSearchValue`: 검색어 (빈 문자열이면 전체 반환)
- `campusCd`: 1=인사캠(HSSC), 2=자과캠(NSC)

**응답**: `{ buildItems: [...] }`

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `id` | int | SKKU 내부 PK (전체 unique) | `27` |
| `buildNo` | string \| null | 건물 코드 (건물만 있음, 시설은 null) | `"248"` |
| `buildNumber` | string \| undefined | 별도 건물 번호 (대부분 undefined) | |
| `campusCd` | string | 캠퍼스 코드 | `"2"` |
| `buildNm` | string | 한글 이름 | `"삼성학술정보관"` |
| `buildNmEng` | string | 영문 이름 | `"Samsung Library"` |
| `latitude` | **string** | 위도 | `"37.293885"` |
| `longtitude` | **string** | 경도 (오타 그대로) | `"126.974906"` |
| `krText` | string | 한글 설명 (장애인 편의정보 포함) | |
| `enText` | string | 영문 설명 | |
| `handicappedElevatorYn` | string | 장애인 엘리베이터 | `"Y"` / `"N"` |
| `handicappedToiletYn` | string | 장애인 화장실 | `"Y"` / `"N"` |
| `filePath` | string | 이미지 경로 | `"/_attach/image/2018/07/"` |
| `encodeNm` | string | 이미지 파일명 | `"LSHRXXTOWcbuUlegcgZV.jpg"` |
| `writerId` | string | 작성자 | `"andwise"` |
| `createDt` | string | 생성일 (ISO 8601) | |
| `updateDt` | string | 수정일 (ISO 8601) | |

이미지 전체 URL: `https://www.skku.edu{filePath}{encodeNm}`

**주의**: 좌표가 **string** 타입. `parseFloat()` 필수.

---

### 2. `buildInfo` — 건물 상세 (층별 공간 + 첨부파일)

```
GET campusMap.do?mode=buildInfo&buildNo={buildNo}&id={id}
```

- `buildNo`: buildList의 buildNo
- `id`: buildList의 id (skkuId)

**응답**: `{ item: {...}, floorItem: [...], attachItem: [...] }`

#### `item` — 건물 메타

필드명이 buildList와 다름 (snake_case):
`build_nm`, `build_nm_eng`, `build_no`, `campus_cd`, `id`, `latitude`, `longtitude`, `kr_text`, `en_text`, `handicapped_elevator_yn`, `handicapped_toilet_yn`, `create_dt`, `update_dt`

#### `floorItem[]` — 층별 공간

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `floor` | string | 층 코드 | `"01"`, `"B1"`, `"B2"` |
| `floor_nm` | string | 한글 층명 | `"1층"`, `"지하1층"` |
| `floor_nm_eng` | string | 영문 층명 | `"1F"`, `"B1"` |
| `space_cd` | string | 공간 코드 | `"480102"` |
| `spcae_nm` | string | 한글 공간명 (오타 주의: spcae) | `"컴넷"` |
| `spcae_nm_eng` | string | 영문 공간명 | `"Computer Zone"` |

- 건물에 따라 0~51+개 (600주년기념관: 0개, 삼성학술정보관: 51개)
- 좌표 없음 (건물 좌표를 상속해서 사용)

#### `attachItem[]` — 첨부 이미지

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | int | 첨부 ID |
| `map_id` | int | 건물 ID (= skkuId) |
| `file_nm` | string | 원본 파일명 |
| `encode_nm` | string | 인코딩 파일명 |
| `file_path` | string | 저장 경로 |
| `file_ty` | string | 파일 타입 (`"I"` = image) |
| `image_alt` | string | alt 텍스트 |

---

### 3. `spaceList` — 시설/공간 목록

```
GET campusMap.do?mode=spaceList&mode=spaceList&srSearchValue={query}&campusCd={1|2}
```

**응답**: `{ items: [...], count: N }`

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `spaceCd` | string | 공간 코드 | `"480102"` |
| `buildNo` | string | 건물 코드 | `"248"` |
| `buildNm` | string | 한글 건물명 | `"삼성학술정보관"` |
| `buildNmEng` | string | 영문 건물명 | `"Samsung Library"` |
| `floorNm` | string | 한글 층명 | `"1층"` |
| `floorNmEng` | string | 영문 층명 | `"1F"` |
| `spcaeNm` | string | 한글 공간명 (오타) | `"컴넷"` |
| `spcaeNmEng` | string | 영문 공간명 | `"Computer Zone"` |
| `latitude` | **number** | 위도 | `37.293885` |
| `longtitude` | **number** | 경도 (오타) | `126.974906` |
| `m` | int | 상태/타입 표시자 | |
| `conspaceCd` | string \| null | 연결 공간 코드 | |

**주의**: 좌표가 **number** 타입 (buildList의 string과 다름).

---

## API 간 필드명 불일치

SKKU API 내부에서 동일 데이터를 다른 네이밍으로 반환:

| 데이터 | buildList | buildInfo | spaceList |
|--------|-----------|-----------|-----------|
| 건물명(한) | `buildNm` | `build_nm` | `buildNm` |
| 건물코드 | `buildNo` | `build_no` | `buildNo` |
| 캠퍼스 | `campusCd` | `campus_cd` | (없음, 요청 파라미터) |
| 좌표 | **string** | string | **number** |
| 공간명 | — | `spcae_nm` | `spcaeNm` |
| casing | camelCase | snake_case | camelCase |

---

## 알려진 이슈

- `longtitude`: longitude의 오타. 3개 API 모두 동일.
- `spcae_nm` / `spcaeNm`: space의 오타. buildInfo와 spaceList 모두.
- 좌표 타입 불일치: buildList는 string, spaceList는 number. 비교 시 `parseFloat()` 필수.
- 일부 `spcae_nm_eng` 값이 `"undefined"` 문자열 (null이 아닌 리터럴 "undefined").

---

# Part 5: Building Data

# Building Connections (건물 연결통로)

> **Date**: 2026-03-16
> **Status**: Server-side complete. Flutter integration pending.
> **Context**: 인사캠 건물 간 연결통로 데이터를 `connections` 컬렉션에 저장하고, `GET /building/:skkuId` 응답에 포함.

---

## 개요

인사캠(hssc) 건물들 사이에는 특정 층끼리 연결통로가 있다 (예: 법학관 2층 ↔ 수선관 3층). 이 데이터는 기존에 웹뷰 `AvailableLines.js`에 하드코딩되어 있었으나, 이제 서버 DB에 저장되고 API로 제공된다.

**핵심 설계:**
- 연결은 **양방향** — DB에는 한 번만 저장하고, 쿼리 시 방향을 정규화해서 반환
- 건물 이름/번호는 connections에 저장하지 않음 — 쿼리 시 `buildings` 컬렉션에서 lookup
- 연결 없는 건물은 `connections: []` (빈 배열)

---

## API 응답

### `GET /building/:skkuId`

기존 `building`, `floors`에 더해 `connections` 배열이 추가되었다.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "building": { "_id": 12, "name": { "ko": "경영관", "en": "Business School" }, "..." : "..." },
    "floors": [ "..." ],
    "connections": [
      {
        "targetSkkuId": 11,
        "targetBuildNo": "132",
        "targetDisplayNo": "32",
        "targetName": { "ko": "다산경제관", "en": "Dasan Hall of Economics" },
        "fromFloor": { "ko": "4층", "en": "4F" },
        "toFloor": { "ko": "2층", "en": "2F" }
      },
      {
        "targetSkkuId": 11,
        "targetBuildNo": "132",
        "targetDisplayNo": "32",
        "targetName": { "ko": "다산경제관", "en": "Dasan Hall of Economics" },
        "fromFloor": { "ko": "3층", "en": "3F" },
        "toFloor": { "ko": "1층", "en": "1F" }
      }
    ]
  }
}
```

### Connection 객체 필드

| Field | Type | 설명 |
|-------|------|------|
| `targetSkkuId` | `number` | 연결 대상 건물의 skkuId (`_id`) |
| `targetBuildNo` | `string?` | 대상 건물의 buildNo (SKKU 내부 코드) |
| `targetDisplayNo` | `string?` | 대상 건물의 표시 번호 (지도 마커용) |
| `targetName` | `{ ko, en }` | 대상 건물 이름 |
| `fromFloor` | `{ ko, en }` | **현재 건물** 쪽 연결 층 |
| `toFloor` | `{ ko, en }` | **대상 건물** 쪽 연결 층 |

### 방향 정규화

DB에 `법학관(A) 2층 ↔ 수선관(B) 3층` 한 건만 저장되어 있어도:

- `GET /building/3` (법학관) → `fromFloor: 2층, toFloor: 3층, target: 수선관`
- `GET /building/13` (수선관) → `fromFloor: 3층, toFloor: 2층, target: 법학관`

항상 **"내 건물 층 → 상대 건물 층"** 방향으로 반환된다.

---

## 현재 연결 데이터 (11개)

| # | 건물 A | 층 | 건물 B | 층 |
|---|--------|-----|--------|-----|
| 1 | 법학관 | 2층 | 수선관 | 3층 |
| 2 | 수선관 | 1층 | 수선관(별관) | 1층 |
| 3 | 수선관 | 5층 | 수선관(별관) | 5층 |
| 4 | 수선관 | 8층 | 수선관(별관) | 8층 |
| 5 | 퇴계인문관 | 2층 | 다산경제관 | 2층 |
| 6 | 퇴계인문관 | 3층 | 다산경제관 | 3층 |
| 7 | 퇴계인문관 | 4층 | 다산경제관 | 4층 |
| 8 | 퇴계인문관 | 5층 | 다산경제관 | 5층 |
| 9 | 다산경제관 | 2층 | 경영관 | 4층 |
| 10 | 다산경제관 | 1층 | 경영관 | 3층 |
| 11 | 600주년기념관 | 지하2층 | 국제관 | 1층 |

---

## Flutter 활용 가이드

### 1. 모델

```dart
class BuildingConnection {
  final int targetSkkuId;
  final String? targetBuildNo;
  final String? targetDisplayNo;
  final LocalizedString targetName;  // { ko, en }
  final LocalizedString fromFloor;
  final LocalizedString toFloor;
}
```

`GET /building/:skkuId` 응답의 `data.connections` 배열을 파싱하면 된다. 배열이 비어있으면 연결통로 UI를 숨기면 된다.

### 2. 건물 상세 화면에서 연결통로 표시

```
if (connections.isNotEmpty) {
  // "연결통로" 섹션 렌더링
  for (conn in connections) {
    // "2층 → 다산경제관 2층" 같은 형태로 표시
    // fromFloor.ko = 현재 건물의 연결 층
    // toFloor.ko = 대상 건물의 연결 층
    // targetName.ko = 대상 건물 이름
  }
}
```

### 3. 층별 연결 매칭

건물 상세의 `floors` 데이터와 `connections`의 `fromFloor`를 매칭하면 특정 층에 연결통로가 있는지 판단할 수 있다.

```
// 현재 보고 있는 층이 floorInfo.floor.ko == "2층"일 때
// connections에서 fromFloor.ko == "2층"인 항목을 찾으면
// → 그 층에 연결통로가 있다는 뜻
matchingConns = connections.where((c) => c.fromFloor.ko == currentFloor.ko)
```

**주의:** `fromFloor.ko`의 포맷은 서버 spaces 데이터의 `floor.ko`와 동일한 형식을 사용한다 (`"1층"`, `"지하1층"`, `"지하2층"` 등). 문자열 비교로 직접 매칭 가능.

### 4. 연결 건물로 이동

`targetSkkuId`를 사용하면 대상 건물 상세 화면으로 바로 이동할 수 있다.

```
// 연결통로 탭 시 → 대상 건물 상세로 이동
onTap: () => navigateTo('/building/${conn.targetSkkuId}')
```

### 5. 같은 대상 건물에 여러 연결이 있는 경우

다산경제관에서 경영관으로의 연결처럼 같은 `targetSkkuId`에 대해 여러 connection이 올 수 있다 (1층→3층, 2층→4층). `targetSkkuId`로 그룹핑해서 보여줄지, 각각 나열할지는 UI 판단.

---

## DB 스키마 (참고)

### `connections` 컬렉션

```javascript
{
  _id: ObjectId,
  campus: "hssc",
  a: { skkuId: 3, floor: { ko: "2층", en: "2F" } },
  b: { skkuId: 13, floor: { ko: "3층", en: "3F" } }
}
```

- 건물 이름/번호는 저장하지 않음 (buildings 컬렉션에서 join)
- 인덱스: `a.skkuId`, `b.skkuId`

### Seed 스크립트

```bash
node scripts/seed-connections.js
```

- `buildings` 컬렉션에서 `name.ko`로 `skkuId`를 조회해서 연결 문서 생성
- `bulkWrite` upsert — 멱등성 보장 (여러 번 실행해도 안전)

---

# Building Data Investigation Report

> 조사일: 2026-03-15
> 목적: SKKU 캠퍼스맵 데이터를 자체 MongoDB에 저장하기 위한 스키마 설계 사전 검증

## 배경

기존 상태:
- `features/search/` — 매 요청마다 SKKU API 직접 호출 (캐싱 없음)
- `features/map/map-markers.data.js` — HSSC 11개 + NSC 1개 건물 좌표 하드코딩
- `features/map/map-overlays.data.js` — 동일하게 하드코딩, 불완전

목표: SKKU API → 자체 DB 주기적 sync → 서버/앱은 자체 DB에서 읽기

---

## Phase 0: 데이터 교차검증 결과

### 건물 목록 (`buildList`)

| 항목 | 수치 |
|------|------|
| HSSC 건물 | 25 |
| NSC 건물 | 53 |
| **총 항목** | **78** |
| buildNo 있음 (실제 건물) | **59** (HSSC 18 + NSC 41) |
| buildNo null (시설/장소) | **19** (HSSC 7 + NSC 12) |

#### buildNo null 항목 (19개)

건물이 아닌 시설/장소. buildInfo 호출 불가 (층별 정보 없음).

**HSSC (7)**: 정문, 대운동장, 금잔디광장, 옥류정, 유림회관, 농구코트, 후문
**NSC (12)**: 정문, 대운동장, 축구장, 야구장, 테니스장, 북문, 북서문, 모듈러, 킹고광장, 글로벌광장, 공자로, 해오름길

---

### 고유키 검증

#### skkuId (`id` 필드)

| 항목 | 결과 |
|------|------|
| 전체 78개 중 unique | **78개 — 100% unique ✓** |
| 타입 | integer |
| 범위 | 1~88 (연속은 아님) |

**SKKU DB의 PK로 확실. `_id`로 사용 가능.**

#### buildNo

| 항목 | 결과 |
|------|------|
| buildNo 있는 59개 중 unique | **59개 — 100% unique ✓** |
| cross-campus 중복 | **0개** |
| same-campus 중복 | **0개** |
| null buildNo | 19개 |

**실제 건물끼리는 unique. 다만 null 19개 때문에 단독 `_id`로 사용 불가.**

#### spaceCd

| 항목 | 결과 |
|------|------|
| 전체 7,134개 중 unique spaceCd | **6,997개** |
| 중복 spaceCd | **137개** |
| 중복 원인 | 캠퍼스 간 독립 코드 체계 |

중복 예시: `10101`이 600주년기념관(HSSC)과 파워플랜트(NSC) 양쪽에 할당.

**→ spaceCd 단독 `_id` 불가. `{ spaceCd, buildNo, campus }` 복합 unique 인덱스 필요.**

---

### buildInfo vs spaceList 교차검증

> 핵심 질문: spaceList가 buildInfo floorItem의 superset인가?

| 항목 | 수치 |
|------|------|
| buildInfo의 unique space_cd | 7,123 |
| spaceList의 unique spaceCd | 6,997 |
| 양쪽 모두 존재 | 6,748 |
| **buildInfo에만 존재** | **375 ⚠** |
| spaceList에만 존재 | 249 |
| 필드값 차이 (spaceCd 중복 때문) | 14 |

#### 결론: **spaceList는 superset이 아님**

375개 공간이 buildInfo에만 존재. 주로 `buildNo=116` (인터내셔널하우스) 등 특정 건물에 집중.

**→ buildInfo floorItem과 spaceList 양쪽에서 데이터를 수집하여 spaces에 병합 필요.**

#### buildInfo 세부 통계

| 항목 | 수치 |
|------|------|
| buildInfo 성공 호출 | 61/78 (buildNo null 17개 + 추가 미호출 제외) |
| 층별 데이터 있는 건물 | **55** / 61 |
| 층별 데이터 없는 건물 | 6 / 61 |
| 첨부파일 있는 건물 | **59** / 61 |
| 총 floor spaces | 7,319 |

---

### 좌표 비교: 공간 좌표 vs 건물 좌표

> 핵심 질문: spaceList의 공간별 좌표가 건물 좌표와 다른가?

**주의**: buildList는 좌표를 **string**으로, spaceList는 **number**로 반환. 비교 시 `parseFloat()` 필수. (초기 string 비교에서 96% differ로 오진 → 숫자 비교로 수정)

| 항목 | 수치 | 비율 |
|------|------|------|
| 건물 좌표와 동일 | 6,591 | **92.4%** |
| 건물 좌표와 다름 | 281 | 3.9% |
| 건물 참조 없음 | 262 | 3.7% |

#### 다른 좌표가 발생하는 건물 (23개)

차이는 소수점 3~4자리 — 같은 건물 내 동(wing)/관별 위치 차이.

예시:
```
경영관(133): 건물좌표 37.5886, 126.9927
  2층 pc실:         37.5889, 126.9926  (≈30m 차이)
  지하2층 학생식당:  37.5885, 126.9927  (≈10m 차이)
```

#### 결론

- 92%는 건물 좌표와 동일 → 대부분 건물 좌표를 상속
- 3.9%는 건물 내 미세 차이 (동/관 수준, 10~30m)
- **spaces에 좌표 저장은 하되, 앱에서는 건물 좌표 우선 사용 권장**
- buildInfo의 floorItem에는 좌표 없음 (spaceList에만 있음)

---

## 스키마 설계 결정사항

### `_id` 전략

| 컬렉션 | `_id` | 이유 |
|---------|-------|------|
| buildings | `skkuId` (integer) | 78개 전부 unique. buildNo는 null 19개라 불가. |
| spaces | `ObjectId` (자동) | spaceCd 중복 137개. 복합 unique 인덱스로 대체. |

### floors 전략

| 옵션 | 채택 |
|------|------|
| ~~spaceList만 SSOT~~ | ✗ — 375개 누락 |
| ~~buildInfo만 임베딩~~ | ✗ — 좌표 없음, 검색 불편 |
| **양쪽 병합 → spaces 컬렉션** | **✓** |

### 병합 sync 흐름

```
Phase 1: buildList → buildings upsert (78개, null buildNo 포함)
Phase 2: buildInfo → buildings에 attachments 저장
                    + spaces에 floorItem upsert (좌표 없이, source="buildInfo")
Phase 3: spaceList → spaces upsert (좌표 포함, 기존 있으면 merge, source 업데이트)
```

- Phase 2에서 먼저 넣은 space + Phase 3에서 좌표 추가 → `source: "both"`
- Phase 2에만 있는 375개 → `source: "buildInfo"` (좌표 null)
- Phase 3에만 있는 249개 → `source: "spaceList"`

### 삭제 정책

sync 시 SKKU에 없는데 DB에 있는 space → **삭제** (데이터 정확성 유지).

### null buildNo 항목

**저장함.** 정문, 광장, 운동장 등은 지도 마커로 표시할 가치 있음.
buildings에 `type: "building" | "facility"`로 구분.

---

## 미결정 사항

- [ ] sync 주기 (현재 안: 주 1회 + DB 비었으면 즉시)
- [ ] 검색 초성 지원 여부 (이번 스코프 밖)
- [ ] map-overlays.data.js DB 전환 시점
- [ ] extensions 필드 구체적 스키마 (실내지도, 운영시간 등)

---

## 검증 스크립트

- `scripts/verify-campus-data.js` — buildInfo vs spaceList 교차검증
- `scripts/investigate-duplicates.js` — buildNo/skkuId uniqueness 분석
- `scripts/investigate-coords.js` — 공간 좌표 vs 건물 좌표 비교

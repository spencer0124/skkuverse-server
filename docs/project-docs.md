# skkuverse-server 프로젝트 문서

> 15개 개별 문서를 하나로 통합 (2026-03-28)

---

# Part 1: Server & Deployment

# Deployment Guide: skkuverse-server → Oracle Cloud Free Tier

## Context

Deploy the Express API server to Oracle Cloud Free Tier with domain `api.skkuuniverse.com` (Cloudflare DNS). The project already has production-ready Docker config (Dockerfile, docker-compose.yml, health checks, graceful shutdown, non-root user, resource limits).

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

Nginx config is version-controlled at `infra/nginx/api.skkuuniverse.com` in the repo. Copy it to the server:

```bash
sudo cp infra/nginx/api.skkuuniverse.com /etc/nginx/sites-available/
```

The config uses an upstream block with passive health checks for load balancing between two API replicas. See `infra/nginx/api.skkuuniverse.com` for the full config.

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/api.skkuuniverse.com /etc/nginx/sites-enabled/
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
- **Caching**: Create a Cache Rule for `api.skkuuniverse.com/*` → Cache Level: Bypass
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
SWAGGER_SERVER_URL=https://api.skkuuniverse.com
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

1. `curl https://api.skkuuniverse.com/health` → `{"status":"ok","uptime":...}`
2. Test from Flutter app by updating base URL
3. Check Cloudflare Analytics for traffic flow
4. Verify SSL with `curl -vI https://api.skkuuniverse.com`

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

### `scripts/migrate-schedules.js`

One-time migration from old per-collection format to new unified schema.

- **Reads from**: `bus_campus` (production DB, read-only)
- **Writes to**: `bus_campus_dev` (dev DB)
- **Transforms**: `operatingHours` → `time`, `specialNotes` → `notes`, adds default `routeType`/`busCount`
- **Creates**: 4 schedule patterns (INJA weekday/friday, JAIN weekday/friday) + 4 holiday overrides

```bash
node scripts/migrate-schedules.js
```

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

> **Building sync** moved from on-demand (per user request) to weekly background sync in `building.sync.js`. Data is stored in MongoDB (`skkumap` DB) and served via `/building/*` routes. See `docs/flutter-building-api-guide.md` for endpoint details.

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

# Part 3: API Migration

# API Migration v2 — Flutter Update Guide

> **Date**: 2026-03-02
> **Status**: Server-side complete. Flutter update pending.
> **Breaking change**: All routes and response shapes changed. Flutter app must be force-updated.

---

## Overview

The server API has been migrated with 4 major changes:

1. **Routes**: Dropped `/v1/` prefix, renamed segments, removed unused alias
2. **Response envelope**: All endpoints now return `{ meta, data }` (success) or `{ error: { code, message } }` (error)
3. **Field names**: All snake_case → camelCase
4. **New features**: `Accept-Language` i18n, `/app/config` force-update, `X-Request-Id` / `X-Response-Time` headers

---

## 1. Route Mapping (Old → New)

| Old Path | New Path | Method |
|---|---|---|
| `/bus/hssc/v1/buslocation` | `/bus/hssc/location` | GET |
| `/bus/hssc_new/v1/buslocation` | **REMOVED** | — |
| `/bus/hssc/v1/busstation` | `/bus/hssc/stations` | GET |
| `/bus/jongro/v1/buslocation/:line` | `/bus/jongro/location/:line` | GET |
| `/bus/jongro/v1/busstation/:line` | `/bus/jongro/stations/:line` | GET |
| `/campus/v1/campus/:bustype` | `/bus/campus/:bustype` | GET |
| `/station/v1/:stationId` | `/bus/station/:stationId` | GET |
| `/mobile/v1/mainpage/buslist` | `/ui/home/buslist` | GET |
| `/mobile/v1/mainpage/scrollcomponent` | `/ui/home/scroll` | GET |
| `/search/all/:inputquery` | `/search/buildings/:query` | GET |
| `/search/detail/:buildNo/:id` | `/search/detail/:buildNo/:id` | GET |
| `/search/option3/:inputquery` | `/search/facilities/:query` | GET |
| `/ad/v1/placements` | `/ad/placements` | GET |
| `/ad/v1/events` | `/ad/events` | POST |
| *(new)* | `/app/config` | GET |
| *(new)* | `/map/config` | GET |
| *(new)* | `/map/markers/campus` | GET |
| *(new)* | `/map/overlays?category=hssc\|nsc` | GET |
| *(new)* | `/map/overlays/:overlayId` | GET |

`/health` and `/health/ready` are unchanged.

---

## 2. Response Format

### Success responses

All success responses now use:

```json
{
  "meta": { "lang": "ko", ... },
  "data": { ... } or [ ... ]
}
```

- `meta` always includes `lang` (resolved from `Accept-Language` header)
- `meta` may include endpoint-specific fields (counts, timestamps, etc.)
- `data` is the payload — can be an array or object depending on the endpoint

### Error responses

All error responses (400, 401, 500, 429) now use:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description"
  }
}
```

Error codes:
| Code | HTTP Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request body / params |
| `AUTH_INVALID` | 401 | Invalid Firebase token |
| `RATE_LIMIT` | 429 | Rate limit exceeded |
| `NOT_FOUND` | 404 | Unknown route (e.g., old `/v1/` paths) |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

### 404 responses

Unknown routes (including old `/v1/` paths) now return **JSON** instead of Express default HTML:

```json
{ "error": { "code": "NOT_FOUND", "message": "GET /bus/hssc/v1/buslocation not found" } }
```

This means Flutter's `jsonDecode()` won't crash on 404s — they follow the same `{ error: { code, message } }` structure as all other errors.

### Flutter parsing migration

```dart
// OLD
final metaData = json['metaData'];
final stations = json['stations'];       // or 'stationData', 'busList', etc.
final error = json['error'];             // was a string

// NEW
final meta = json['meta'];
final data = json['data'];               // always 'data' for all endpoints
final error = json['error'];             // now an object: error['code'], error['message']
```

---

## 3. Per-Endpoint Changes

### GET /bus/hssc/location

```
Old: /bus/hssc/v1/buslocation
```

**Old response**: bare array `[{sequence, stationName, carNumber, estimatedTime}, ...]`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": [
    { "sequence": "1", "stationName": "...", "carNumber": "0000", "estimatedTime": 30 }
  ]
}
```

**Flutter**: `json['data']` instead of `json` (was a bare array).

---

### GET /bus/hssc/stations

```
Old: /bus/hssc/v1/busstation
```

**Old response**:
```json
{ "metaData": { "currentTime": "...", "totalBuses": 0, "lastStationIndex": 10 }, "stations": [...] }
```

**New response**:
```json
{
  "meta": { "lang": "ko", "currentTime": "03:04 PM", "totalBuses": 0, "lastStationIndex": 10 },
  "data": [{ "sequence": 1, "stationName": "...", "eta": "...", "busType": "BusType.hsscBus" }]
}
```

**Flutter**: `json['meta']` instead of `json['metaData']`, `json['data']` instead of `json['stations']`.

---

### GET /bus/jongro/location/:line

```
Old: /bus/jongro/v1/buslocation/:line
```

**Old response**: bare array `[{..., isLastBus: false}, ...]`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": [{ "sequence": "1", "stationName": "...", "isLastBus": false }]
}
```

**Flutter**: `json['data']` instead of `json` (was a bare array).

---

### GET /bus/jongro/stations/:line

```
Old: /bus/jongro/v1/busstation/:line
```

**Old response**:
```json
{ "metaData": { "currentTime": "...", "totalBuses": 2, "lastStationIndex": 18 }, "stations": [...] }
```

**New response**:
```json
{
  "meta": { "lang": "ko", "currentTime": "03:05 PM", "totalBuses": 2, "lastStationIndex": 18 },
  "data": [{ "sequence": "1", "stationName": "...", "eta": "...", "busType": "BusType.jonro07Bus" }]
}
```

**Flutter**: `json['meta']` instead of `json['metaData']`, `json['data']` instead of `json['stations']`.

---

### GET /bus/campus/:bustype

```
Old: /campus/v1/campus/:bustype
```

**Old response**: `{ "result": [...] }`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": [...]
}
```

**Flutter**: `json['data']` instead of `json['result']`.

---

### GET /bus/station/:stationId

```
Old: /station/v1/:stationId
```

**Old response**:
```json
{
  "metaData": { "success": true, "total_count": 2 },
  "stationData": [
    {
      "busNm": "종로07",
      "msg1_showmessage": true,
      "msg1_message": "3분후 도착",
      "msg1_remainStation": null,
      "msg1_remainSeconds": null,
      "msg2_showmessage": false,
      "msg2_message": null,
      "msg2_remainStation": null,
      "msg2_remainSeconds": null
    }
  ]
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "totalCount": 2 },
  "data": [
    {
      "busNm": "종로07",
      "busSupportTime": true,
      "msg1ShowMessage": true,
      "msg1Message": "3분후 도착",
      "msg1RemainStation": null,
      "msg1RemainSeconds": null,
      "msg2ShowMessage": false,
      "msg2Message": null,
      "msg2RemainStation": null,
      "msg2RemainSeconds": null
    }
  ]
}
```

**Flutter field renames** (snake_case → camelCase):
| Old | New |
|---|---|
| `total_count` | `totalCount` |
| `success` | *(removed — HTTP 200 is sufficient)* |
| `msg1_showmessage` | `msg1ShowMessage` |
| `msg1_message` | `msg1Message` |
| `msg1_remainStation` | `msg1RemainStation` |
| `msg1_remainSeconds` | `msg1RemainSeconds` |
| `msg2_showmessage` | `msg2ShowMessage` |
| `msg2_message` | `msg2Message` |
| `msg2_remainStation` | `msg2RemainStation` |
| `msg2_remainSeconds` | `msg2RemainSeconds` |

Also: `json['data']` instead of `json['stationData']`, `json['meta']` instead of `json['metaData']`.

---

### GET /ui/home/buslist

```
Old: /mobile/v1/mainpage/buslist
```

**Old response**:
```json
{
  "metaData": { "busList_count": 4 },
  "busList": [{ "title": "인사캠 셔틀버스", ... }]
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "busListCount": 4 },
  "data": [{ "title": "인사캠 셔틀버스", ... }]
}
```

**Flutter**: `json['meta']['busListCount']` instead of `json['metaData']['busList_count']`, `json['data']` instead of `json['busList']`.

**i18n note**: With `Accept-Language: en`, titles/subtitles return in English:
```json
{ "title": "HSSC Shuttle Bus", "subtitle": "Bus Stop (Humanities) ↔ 600th Anniversary Hall", "busTypeText": "SKKU" }
```

---

### GET /ui/home/scroll

```
Old: /mobile/v1/mainpage/scrollcomponent
```

**Old response**:
```json
{
  "metaData": { "item_count": 3 },
  "itemList": [{ "title": "인사캠 건물지도", ... }]
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "itemCount": 3 },
  "data": [{ "title": "인사캠 건물지도", ... }]
}
```

**Flutter**: `json['meta']['itemCount']` instead of `json['metaData']['item_count']`, `json['data']` instead of `json['itemList']`.

---

### GET /search/buildings/:query

```
Old: /search/all/:inputquery
```

**Old response**:
```json
{
  "metaData": {
    "keyword": "경영",
    "total_totalCount": 35,
    "total_hsscCount": 24,
    "total_nscCount": 11,
    "option1_totalCount": 0,
    "option1_hsscCount": 0,
    "option1_nscCount": 0,
    "option3_totalCount": 35,
    "option3_hsscCount": 24,
    "option3_nscCount": 11
  },
  "option1Items": { "hssc": [...], "nsc": [...] },
  "option3Items": { "hssc": [...], "nsc": [...] }
}
```

**New response**:
```json
{
  "meta": {
    "lang": "ko",
    "keyword": "경영",
    "totalCount": 35,
    "totalHsscCount": 24,
    "totalNscCount": 11,
    "buildingsTotalCount": 0,
    "buildingsHsscCount": 0,
    "buildingsNscCount": 0,
    "facilitiesTotalCount": 35,
    "facilitiesHsscCount": 24,
    "facilitiesNscCount": 11
  },
  "data": {
    "buildings": { "hssc": [...], "nsc": [...] },
    "facilities": { "hssc": [...], "nsc": [...] }
  }
}
```

**Flutter field renames**:
| Old | New |
|---|---|
| `total_totalCount` | `totalCount` |
| `total_hsscCount` | `totalHsscCount` |
| `total_nscCount` | `totalNscCount` |
| `option1_totalCount` | `buildingsTotalCount` |
| `option1_hsscCount` | `buildingsHsscCount` |
| `option1_nscCount` | `buildingsNscCount` |
| `option3_totalCount` | `facilitiesTotalCount` |
| `option3_hsscCount` | `facilitiesHsscCount` |
| `option3_nscCount` | `facilitiesNscCount` |
| `option1Items` | `data.buildings` |
| `option3Items` | `data.facilities` |

---

### GET /search/detail/:buildNo/:id

```
Old: /search/detail/:buildNo/:id  (unchanged path)
```

**Old response**: `{ "item": {...}, "availableFloor": [...], "floorItem": {...} }`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": { "item": {...}, "availableFloor": [...], "floorItem": {...} }
}
```

**Flutter**: Wrap access in `json['data']` — e.g., `json['data']['item']` instead of `json['item']`.

---

### GET /search/facilities/:query

```
Old: /search/option3/:inputquery
```

**Old response**:
```json
{
  "metaData": { "keyword": "...", "option3_totalCount": 35, "option3_hsscCount": 24, "option3_nscCount": 11 },
  "option3Items": { "hssc": [...], "nsc": [...] }
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "keyword": "...", "facilitiesTotalCount": 35, "facilitiesHsscCount": 24, "facilitiesNscCount": 11 },
  "data": { "hssc": [...], "nsc": [...] }
}
```

**Flutter**: `json['data']` instead of `json['option3Items']`, camelCase meta fields (`facilitiesTotalCount`, not `option3_totalCount`).

---

### GET /ad/placements

```
Old: /ad/v1/placements
```

**Old response**:
```json
{
  "metaData": { "count": 2 },
  "placements": { "splash": {...}, "main_banner": {...} }
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "count": 2 },
  "data": { "splash": {...}, "main_banner": {...} }
}
```

**Flutter**: `json['data']` instead of `json['placements']`, `json['meta']` instead of `json['metaData']`.

> **Note**: Placement keys (`splash`, `main_banner`, `main_notice`, `bus_bottom`) are **intentionally snake_case** — they are MongoDB document keys used in both server and Flutter, not API field names. Do not rename these to camelCase.

---

### POST /ad/events

```
Old: /ad/v1/events
```

**Old success response**: `{ "placement": "splash", "event": "view", "adId": "..." }`

**New success response**:
```json
{
  "meta": { "lang": "ko" },
  "data": { "placement": "splash", "event": "view", "adId": "..." }
}
```

**Old error response**: `{ "error": "placement and event are required and must be strings" }`

**New error response**:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "placement and event are required and must be strings" } }
```

**Flutter**: `json['data']` for success, `json['error']['message']` for error.

---

### GET /app/config *(NEW)*

No old equivalent. Call at app startup (before auth — no token needed).

**Response**:
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "ios": {
      "minVersion": "4.0.0",
      "latestVersion": "4.1.0",
      "updateUrl": "https://apps.apple.com/app/id..."
    },
    "android": {
      "minVersion": "4.0.0",
      "latestVersion": "4.1.0",
      "updateUrl": "https://play.google.com/store/apps/details?id=..."
    },
    "forceUpdate": true
  }
}
```

> **Why platform-specific?** iOS App Store review is slower than Google Play — you may need to bump Android `minVersion` while iOS is still in review. Server-managed `updateUrl` prevents the worst case: an app that needs updating has a broken store link (e.g., after app re-registration or account transfer). Fix via `.env` without an app release.

**`forceUpdate`** is `true` if *either* platform has `minVersion !== latestVersion`. It's a quick global indicator — the actual force-update decision in Flutter uses the platform-specific `minVersion`.

**Flutter implementation**:
```dart
final config = json['data'];
final platform = Platform.isIOS ? config['ios'] : config['android'];
final minVersion = platform['minVersion'];
final latestVersion = platform['latestVersion'];
final updateUrl = platform['updateUrl'];

if (currentVersion < minVersion) {
  // Force update — block app usage, show dialog with updateUrl
} else if (currentVersion < latestVersion) {
  // Optional update — dismissible prompt
}
```

**Env vars** (in `.env`):
```
APP_IOS_MIN_VERSION=4.0.0
APP_IOS_LATEST_VERSION=4.1.0
APP_IOS_UPDATE_URL=https://apps.apple.com/app/id...
APP_ANDROID_MIN_VERSION=4.0.0
APP_ANDROID_LATEST_VERSION=4.1.0
APP_ANDROID_UPDATE_URL=https://play.google.com/store/apps/details?id=...
```

---

## 4. New Request Headers (Flutter → Server)

Add these to `ApiClient` default headers:

| Header | Value | Purpose |
|---|---|---|
| `Accept-Language` | `locale.languageCode` (e.g., `ko`, `en`, `zh`) | Server returns localized SDUI text. **Default: `ko`** if header is missing or unsupported. |
| `X-App-Version` | App version string (e.g., `4.1.0`) | Logged in pino for version analytics |
| `X-Platform` | `Platform.operatingSystem` (`ios` or `android`) | Logged in pino for platform analytics |

```dart
// In ApiClient._defaultHeaders()
headers['Accept-Language'] = Platform.localeName.split('_')[0]; // 'ko', 'en', etc.
headers['X-App-Version'] = packageInfo.version;
headers['X-Platform'] = Platform.operatingSystem;
```

---

## 5. New Response Headers (Server → Flutter)

| Header | Format | Purpose |
|---|---|---|
| `X-Request-Id` | UUID (e.g., `6a0d4d28-7279-4be6-a2d7-82988baf8026`) | Unique per request. Store for error reporting. |
| `X-Response-Time` | `12.3ms` | Server processing time |

**Optional Flutter usage**: Store `X-Request-Id` from the last failed request. When user reports "앱이 안 돼요", show/copy the request ID for BetterStack log searching.

```dart
// In ApiClient response handling
final requestId = response.headers['x-request-id'];
if (response.statusCode != 200) {
  _lastFailedRequestId = requestId; // for error reporting
}
```

---

## 6. Flutter Files to Update

Based on the fetch files from Step 1f in `production-ready.md`:

| Flutter File | Changes Needed |
|---|---|
| `lib/app/utils/api_fetch/api_client.dart` | Add `Accept-Language`, `X-App-Version`, `X-Platform` headers |
| `lib/app/utils/api_fetch/bus_location.dart` | URL: drop `/v1/buslocation` → `/location`. Parse: `json['data']` |
| `lib/app/utils/api_fetch/bus_stationlist.dart` | URL: drop `/v1/busstation` → `/stations`. Parse: `json['data']` instead of `json['stations']`, `json['meta']` instead of `json['metaData']` |
| `lib/app/utils/api_fetch/fetch_station.dart` | URL: `/station/v1/:id` → `/bus/station/:id`. Parse: `json['data']` instead of `json['stationData']`, camelCase fields |
| `lib/app/utils/api_fetch/mainpage_buslist.dart` | URL: `/mobile/v1/mainpage/buslist` → `/ui/home/buslist`. Parse: `json['data']` instead of `json['busList']` |
| `lib/app/utils/api_fetch/fetch_ad.dart` | URL: drop `/v1/`. Parse: `json['data']` instead of `json['placements']`, error: `json['error']['message']` |
| `lib/app/utils/api_fetch/search_all.dart` (or equivalent) | URL: `/search/all/` → `/search/buildings/`. Parse: `json['data']` instead of `json['option1Items']`/`json['option3Items']` |
| `lib/app/utils/api_fetch/search_option3.dart` | URL: `/search/option3/` → `/search/facilities/`. Parse: `json['data']` instead of `json['option3Items']` |
| `lib/app/utils/api_fetch/fetch_campus.dart` (or equivalent) | URL: `/campus/v1/campus/` → `/bus/campus/`. Parse: `json['data']` instead of `json['result']` |
| `lib/app/utils/constants.dart` | *(Optional)* Update base URL if domain changes |
| Dart models for station | Rename snake_case fields to camelCase (see Section 3 station table) |
| Dart models for search | Rename snake_case meta fields to camelCase |
| *(New)* app config fetch | `GET /app/config` call at startup + force-update dialog |
| *(New)* scroll component fetch | URL: `/mobile/v1/mainpage/scrollcomponent` → `/ui/home/scroll`. Parse: `json['data']` instead of `json['itemList']` |

---

## 7. Quick Validation Checklist

After Flutter update, verify each endpoint:

- [ ] `GET /bus/hssc/location` → `json['data']` is array
- [ ] `GET /bus/hssc/stations` → `json['data']` is array, `json['meta']['currentTime']` exists
- [ ] `GET /bus/jongro/location/07` → `json['data']` is array
- [ ] `GET /bus/jongro/stations/07` → `json['data']` is array with ETA
- [ ] `GET /bus/campus/INJA_weekday` → `json['data']` is array
- [ ] `GET /bus/station/01592` → `json['data']` has camelCase fields (`msg1Message`, not `msg1_message`)
- [ ] `GET /ui/home/buslist` → `json['data']` is array of 4
- [ ] `GET /ui/home/scroll` → `json['data']` is array of 3
- [ ] `GET /search/buildings/경영` → `json['data']['buildings']` and `json['data']['facilities']`
- [ ] `GET /search/facilities/경영` → `json['data']['hssc']` and `json['data']['nsc']`
- [ ] `GET /search/detail/21201/100` → `json['data']['item']`
- [ ] `GET /ad/placements` → `json['data']` is object with placement keys
- [ ] `POST /ad/events` with valid body → `json['data']['adId']` exists
- [ ] `POST /ad/events` with invalid body → `json['error']['code']` is `"VALIDATION_ERROR"`
- [ ] `GET /app/config` → `json['data']['ios']` and `json['data']['android']` each have `minVersion`, `latestVersion`, `updateUrl`
- [ ] `GET /app/config` → `json['data']['forceUpdate']` is boolean
- [ ] Old paths (`/bus/hssc/v1/buslocation`, `/mobile/v1/...`, `/ad/v1/...`, `/station/...`, `/campus/...`, `/search/all/...`) → 404 JSON: `{ "error": { "code": "NOT_FOUND", "message": "GET /path not found" } }`
- [ ] `Accept-Language: en` → `/ui/home/buslist` returns English text
- [ ] Response header `X-Request-Id` is present (UUID format)
- [ ] Response header `X-Response-Time` is present (e.g., `12.3ms`)

---

# Part 4: Flutter Guides

# Flutter Building API Guide

> **Date**: 2026-03-15
> **Status**: Server-side complete. Flutter integration pending.
> **Context**: Building/space data synced weekly from SKKU → MongoDB → served via REST API.

---

## Overview

Building and space data is now served from our own DB instead of proxying SKKU's API on every request. The server syncs SKKU's campusMap API weekly (3-phase: buildList → buildInfo → spaceList) into MongoDB, then exposes 3 endpoints for the Flutter app.

**What changed for Flutter:**
- No more direct SKKU API calls for buildings/spaces
- All building data comes from `/building/*` endpoints
- Responses follow the standard `{ meta, data }` envelope
- i18n: `name`, `description`, `floor` all have `{ ko, en }` — use `Accept-Language` header
- Map markers (`/map/markers/campus`) now return DB-backed data (78 buildings, both campuses)

---

## Endpoints

### 1. `GET /building/list` — Building list (for map markers, lists)

Returns all buildings. Use for populating map markers or building directory views.

**Query params:**
| Param | Required | Values | Default |
|-------|----------|--------|---------|
| `campus` | No | `hssc`, `nsc` | All campuses |

**Response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "buildings": [
      {
        "_id": 27,
        "buildNo": "248",
        "displayNo": "48",
        "type": "building",
        "campus": "nsc",
        "name": { "ko": "삼성학술정보관", "en": "Samsung Library" },
        "description": { "ko": "2009년에 신축된...", "en": "This is constructed in 2009..." },
        "location": {
          "type": "Point",
          "coordinates": [126.974906, 37.293885]
        },
        "image": {
          "url": "https://www.skku.edu/_attach/image/2018/07/LSHRXXTOWcbuUlegcgZV.jpg",
          "filename": "LSHRXXTOWcbuUlegcgZV.jpg"
        },
        "accessibility": { "elevator": true, "toilet": true },
        "attachments": [
          {
            "id": 37,
            "url": "https://www.skku.edu/_attach/image/2018/07/LSHRXXTOWcbuUlegcgZV.jpg",
            "filename": "P480.jpg",
            "alt": ""
          }
        ],
        "skkuCreatedAt": "2018-04-23T00:55:27.000+00:00",
        "skkuUpdatedAt": "2021-03-25T08:05:54.000+00:00",
        "updatedAt": "2026-03-15T03:54:33.040Z"
      }
    ]
  }
}
```

**Key fields:**
| Field | Type | Notes |
|-------|------|-------|
| `_id` | int | SKKU internal PK (`skkuId`). Use as route param for detail view. |
| `buildNo` | string \| null | Building code (SKKU raw, includes campus prefix). `null` for facilities. |
| `displayNo` | string \| null | Human-readable building number with campus prefix stripped (e.g., "248"→"48"). Use this for display. |
| `type` | string | `"building"` or `"facility"`. Facilities have no floors/spaces. |
| `location.coordinates` | [lng, lat] | **GeoJSON order**: longitude first, latitude second. |
| `image.url` | string \| null | Building photo from SKKU. May be null. |
| `attachments` | array | Additional images from SKKU buildInfo. May be empty. |

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | `INVALID_CAMPUS` | `campus` not `hssc` or `nsc` |

---

### 2. `GET /building/search?q={query}` — Search buildings and spaces

Searches building names, descriptions, and space/room names. Returns buildings and spaces grouped by building.

**Query params:**
| Param | Required | Values |
|-------|----------|--------|
| `q` | Yes | Search keyword (min 1 char after trim) |
| `campus` | No | `hssc`, `nsc` |

**Response:**
```json
{
  "meta": {
    "lang": "ko",
    "keyword": "도서",
    "buildingCount": 5,
    "spaceCount": 9
  },
  "data": {
    "buildings": [
      {
        "_id": 27,
        "buildNo": "248",
        "displayNo": "48",
        "name": { "ko": "삼성학술정보관", "en": "Samsung Library" },
        "campus": "nsc",
        "type": "building",
        "location": { "type": "Point", "coordinates": [126.974906, 37.293885] },
        "image": { "url": "https://...", "filename": "..." },
        "..."
      }
    ],
    "spaces": [
      {
        "skkuId": 3,
        "buildNo": "102",
        "displayNo": "2",
        "buildingName": { "ko": "법학관", "en": "Law Building" },
        "items": [
          {
            "spaceCd": "20501",
            "name": { "ko": "법학전문대학원도서관(한용교기념도서관)", "en": "Law School Library" },
            "floor": { "ko": "5층", "en": "5F" }
          }
        ]
      }
    ]
  }
}
```

**Search behavior:**
- Case-insensitive substring match on `name.ko`, `name.en`, `description.ko` (buildings) and `name.ko`, `name.en`, `buildingName.ko` (spaces)
- Numeric-only queries (e.g., `q=48`) match `displayNo` for buildings (user-facing number, not raw `buildNo`)
- Alphanumeric queries also match `spaceCd` exactly (e.g., `q=23217` → 첨단e+강의실)
- Limits: max 5 buildings, max 20 spaces
- Spaces are grouped by building with `skkuId` (for detail navigation), `displayNo`, and `buildingName`

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | `MISSING_QUERY` | `q` is empty or missing |
| 400 | `INVALID_CAMPUS` | `campus` not `hssc` or `nsc` |

---

### 3. `GET /building/:skkuId` — Building detail with floors

Returns full building info with spaces organized by floor.

**Path params:**
| Param | Type | Description |
|-------|------|-------------|
| `skkuId` | int | Building ID from `_id` field in list/search results |

**Response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "building": {
      "_id": 27,
      "buildNo": "248",
      "displayNo": "48",
      "type": "building",
      "campus": "nsc",
      "name": { "ko": "삼성학술정보관", "en": "Samsung Library" },
      "description": { "ko": "...", "en": "..." },
      "location": { "type": "Point", "coordinates": [126.974906, 37.293885] },
      "image": { "url": "https://...", "filename": "..." },
      "accessibility": { "elevator": true, "toilet": true },
      "attachments": [
        { "id": 37, "url": "https://...", "filename": "P480.jpg", "alt": "" }
      ],
      "extensions": {}
    },
    "floors": [
      {
        "floor": { "ko": "1층", "en": "1F" },
        "spaces": [
          { "spaceCd": "480102", "name": { "ko": "컴넷", "en": "Computer Zone" }, "conspaceCd": null }
        ]
      },
      {
        "floor": { "ko": "2층", "en": "2F" },
        "spaces": [
          { "spaceCd": "480201", "name": { "ko": "...", "en": "..." }, "conspaceCd": null }
        ]
      }
    ]
  }
}
```

**Notes:**
- `floors` is dynamically grouped from spaces — order follows DB insertion order (buildInfo then spaceList)
- Facilities (`type: "facility"`, `buildNo: null`) return `floors: []`
- `extensions` object is reserved for future custom data (indoor maps, operating hours, tags). Always present, currently empty `{}`
- `conspaceCd` is a SKKU internal field — purpose unclear, preserved for future use

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | `INVALID_ID` | `skkuId` is not a positive integer |
| 404 | `NOT_FOUND` | No building with that `skkuId` |

---

## Data Model

### Building types

| `type` | `buildNo` | Example | Has floors? |
|--------|-----------|---------|-------------|
| `"building"` | `"248"` | 삼성학술정보관 | Yes (floors with spaces) |
| `"facility"` | `null` | 정문, 주차장 | No (floors = []) |

### Location coordinates

**GeoJSON format**: `coordinates: [longitude, latitude]`

```dart
// Extract lat/lng from building
final lng = building['location']['coordinates'][0]; // longitude first
final lat = building['location']['coordinates'][1]; // latitude second
```

### Campus codes

| Code | Korean | English |
|------|--------|---------|
| `hssc` | 인사캠 | Humanities & Social Sciences Campus |
| `nsc` | 자과캠 | Natural Sciences Campus |

### Current data counts

| Collection | Count | Notes |
|------------|-------|-------|
| buildings | 78 | 25 HSSC + 53 NSC |
| spaces | ~7,500 | Deduplicated across buildInfo + spaceList |

---

## Updated: `/map/markers/campus` (sole marker source)

This endpoint is now the **only source** for building markers. The old overlay endpoint (`/map/overlays?category=hssc`) has been removed. The `/map/config` layer `campus_buildings` now points to `/map/markers/campus`.

**Response** (78 markers):
```json
{ "skkuId": 2, "buildNo": "101", "displayNo": "1", "type": "building", "name": { "ko": "수선관", "en": "Suseon Hall" }, "campus": "hssc", "lat": 37.587, "lng": 126.994, "image": "https://..." }
```

**Key points:**
- Returns both HSSC (25) and NSC (53) markers — filter client-side by `campus`
- `skkuId` (int) can be used for detail API: `GET /building/{skkuId}`
- `type: "facility"` entries (gates, parking) have `buildNo: null` and no floor data
- Falls back to hardcoded markers if DB is empty (first boot, sync failure)

---

## Flutter Implementation Notes

### API endpoint registration

Add to `api_endpoints.dart`:
```dart
static const buildingList = '/building/list';
static const buildingSearch = '/building/search';
static String buildingDetail(int skkuId) => '/building/$skkuId';
```

### Repository pattern

Add `BuildingRepository` following the existing pattern in `repositories/`:

```dart
class BuildingRepository {
  final ApiClient _api;

  BuildingRepository(this._api);

  /// Get all buildings, optionally filtered by campus
  Future<Result<List<Building>>> getBuildings({String? campus}) async {
    final params = <String, String>{};
    if (campus != null) params['campus'] = campus;

    return _api.safeGet(
      ApiEndpoints.buildingList,
      (json) => (json['data']['buildings'] as List)
          .map((e) => Building.fromJson(e))
          .toList(),
      queryParameters: params,
    );
  }

  /// Search buildings and spaces
  Future<Result<BuildingSearchResult>> search(String query, {String? campus}) async {
    final params = {'q': query};
    if (campus != null) params['campus'] = campus;

    return _api.safeGet(
      ApiEndpoints.buildingSearch,
      (json) => BuildingSearchResult.fromJson(json),
      queryParameters: params,
    );
  }

  /// Get building detail with floor/space data
  Future<Result<BuildingDetail>> getDetail(int skkuId) async {
    return _api.safeGet(
      ApiEndpoints.buildingDetail(skkuId),
      (json) => BuildingDetail.fromJson(json),
    );
  }
}
```

### Coordinate extraction helper

```dart
/// GeoJSON [lng, lat] → LatLng
NLatLng buildingToLatLng(Map<String, dynamic> location) {
  final coords = location['coordinates'] as List;
  return NLatLng(
    (coords[1] as num).toDouble(), // latitude
    (coords[0] as num).toDouble(), // longitude
  );
}
```

### Search debouncing

The search endpoint does regex matching on ~78 buildings + ~7,500 spaces. While fast (indexed), debounce client-side to avoid unnecessary calls:

```dart
final _searchDebounce = Debouncer(milliseconds: 300);

void onSearchChanged(String query) {
  _searchDebounce.run(() {
    if (query.trim().isEmpty) return;
    _repo.search(query);
  });
}
```

---

## Migration Checklist

- [ ] Add `Building`, `BuildingSearchResult`, `BuildingDetail` models
- [ ] Add `BuildingRepository` with `getBuildings()`, `search()`, `getDetail()`
- [ ] Register `BuildingRepository` in DI (GetX binding)
- [ ] Update map layer controller: parse `/map/markers/campus` new shape (`skkuId`, `name` as object)
- [ ] Remove old overlay parser for `GET /map/overlays?category=hssc` (endpoint removed)
- [ ] Add building search UI (connects to `/building/search`)
- [ ] Add building detail view (connects to `/building/:skkuId`, shows floors/spaces)
- [ ] Remove old SKKU API direct calls in `features/search/` usage (if any)
- [ ] Remove `building_labels.dart` hardcoded markers (now server-driven)
- [ ] Test: `/building/list?campus=hssc` returns 25 buildings
- [ ] Test: `/building/search?q=도서` returns buildings + grouped spaces
- [ ] Test: `/building/999` returns 404
- [ ] Test: `/map/markers/campus` returns 78 markers with new shape
- [ ] Test: map layer pipeline works with new endpoint (config → markers → NMarker)

---

# Flutter Building Migration — Server-Side Perspective

> **Date**: 2026-03-15
> **Scope**: What the Flutter app needs to change based on server API changes.
> **Related docs**: `flutter-building-api-guide.md` (API reference), `flutter-map-overlay-guide.md` (overlay migration details)

---

## Summary of Server Changes

1. **Building data now lives in MongoDB** — synced weekly from SKKU's campusMap API (78 buildings, ~7,500 spaces)
2. **3 new endpoints**: `/building/list`, `/building/search?q=`, `/building/:skkuId`
3. **Map overlay change**: `/map/config` → `campus_buildings` layer now points to `/map/markers/campus` (was `/map/overlays?category=hssc`)
4. **Overlay endpoint removed**: `GET /map/overlays?category=hssc` returns 404

---

## Breaking Changes (must fix)

### 1. Map layer pipeline — response shape changed

`/map/config` still drives the layer system, but the `campus_buildings` layer endpoint changed from `/map/overlays?category=hssc` to `/map/markers/campus`. The response shape is completely different:

```
Old: { category, overlays: [{ type, id, position: { lat, lng }, marker: { label, subLabel } }] }
New: { markers: [{ skkuId, buildNo, displayNo, type, name: { ko, en }, campus, lat, lng, image }] }
```

**Flutter action**: Update the layer data loader to parse the new shape. When the layer endpoint is `/map/markers/campus`, parse `markers[]` instead of `overlays[]`.

### 2. Building marker name is now bilingual

Old: `marker.label` was a pre-resolved string (e.g., "법학관")
New: `name` is `{ ko: "법학관", en: "Law School" }` — select by current locale.

### 3. Building identifier changed

Old overlay: `id` was a string like `"bldg_hssc_law"`
New markers: `skkuId` is an integer (e.g., `2`). Use this for `GET /building/{skkuId}` detail calls.

### 4. Old overlay endpoint is gone

`GET /map/overlays?category=hssc` now returns 404. Any code that calls this directly must be removed. The `/map/config` no longer references it.

---

## New Capabilities (can implement)

### 1. Building list — `/building/list?campus=hssc`

Returns all 78 buildings with metadata (name, coordinates, image, type, accessibility). Can replace the map marker source or populate a building directory view.

**Response fields per building:**
| Field | Type | Description |
|-------|------|-------------|
| `_id` | int | `skkuId` — use for detail API |
| `buildNo` | string \| null | SKKU raw building code (includes campus prefix). `null` for facilities. |
| `displayNo` | string \| null | Human-readable number (prefix stripped, e.g., "248"→"48"). **Use this for display.** |
| `type` | `"building"` \| `"facility"` | Facilities = gates, parking, fields |
| `name` | `{ ko, en }` | Bilingual name |
| `campus` | `"hssc"` \| `"nsc"` | Campus code |
| `location.coordinates` | `[lng, lat]` | GeoJSON order (longitude first!) |
| `image.url` | string \| null | Building photo |
| `accessibility` | `{ elevator, toilet }` | Disability access booleans |

### 2. Building search — `/building/search?q={query}&campus=hssc`

Searches building names/descriptions and space/room names. Returns two sections:

- `buildings[]` — matched buildings (max 5)
- `spaces[]` — matched spaces grouped by building (max 20 spaces)

Each space group has `skkuId` (for detail navigation), `buildNo`, `displayNo`, `buildingName`, and `items[]` with `spaceCd`, `name`, `floor`.

**Search behavior:**
- Case-insensitive substring match on names/descriptions
- Numeric queries match `displayNo` (user-facing number, e.g., `q=48` → 삼성학술정보관). Raw `buildNo` (e.g., "248") is NOT searchable.
- Alphanumeric queries also match `spaceCd` exactly (e.g., `q=23217` → 첨단e+강의실 in 제1공학관23동)
- `meta` includes `keyword`, `buildingCount`, `spaceCount`

**Flutter navigation from space result:**
- Use `skkuId` from the space group to call `GET /building/:skkuId`
- Pass `floor` and `spaceCd` from the tapped item as navigation params for future floor/space highlighting

### 3. Building detail — `/building/:skkuId`

Returns full building info with floor-grouped spaces:

```json
{
  "building": { "_id": 27, "buildNo": "248", "displayNo": "48", "name": {...}, "attachments": [...], "extensions": {}, ... },
  "floors": [
    {
      "floor": { "ko": "1층", "en": "1F" },
      "spaces": [
        { "spaceCd": "480102", "name": { "ko": "컴넷", "en": "Computer Zone" }, "conspaceCd": null }
      ]
    }
  ]
}
```

- Facilities (`type: "facility"`) return `floors: []`
- `extensions` is `{}` now — reserved for future custom data (indoor maps, tags, etc.)

---

## Coordinate Handling

All building coordinates use **GeoJSON format**: `coordinates: [longitude, latitude]`

```
Server stores:  location.coordinates = [126.974906, 37.293885]  // [lng, lat]
Flutter needs:  NLatLng(37.293885, 126.974906)                  // (lat, lng)
```

The `/map/markers/campus` endpoint pre-converts to flat `lat/lng` fields for convenience. The `/building/list` and `/building/:skkuId` endpoints return raw GeoJSON — Flutter must swap the order.

---

## Data Counts

| What | Count | Notes |
|------|-------|-------|
| Buildings total | 78 | 25 HSSC + 53 NSC |
| Buildings (type=building) | 59 | Have buildNo + floors |
| Facilities (type=facility) | 19 | Gates, parking, fields — no floors |
| Spaces | ~7,500 | Rooms/labs/offices across all buildings |
| Sync frequency | Weekly | + immediate on first boot if DB empty |

---

## Endpoint Summary

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/building/list` | GET | All buildings (map markers, directory) | **New** |
| `/building/search` | GET | Building + space text search | **New** |
| `/building/:skkuId` | GET | Building detail with floors | **New** |
| `/map/markers/campus` | GET | Lean marker data (pre-formatted lat/lng) | Existing (now DB-backed) |
| `/map/config` | GET | Layer definitions (endpoint changed) | **Updated** |
| `/map/overlays?category=` | GET | ~~Building overlays~~ | **Removed (404)** |
| `/map/overlays/:overlayId` | GET | Bus route polylines | Unchanged |

---

# Flutter Bus Schedule Migration Guide

Bus config가 keyed object → ordered `groups` 배열로 변경됨.
Campus 스케줄이 per-daytype endpoint → 주간 단위 resolution engine으로 변경됨.
`getBusGroups()`가 SSOT(Single Source of Truth)로서 buslist와 config를 통합.

---

## 0. 아키텍처 — 3-Layer 데이터 흐름

서버의 `getBusGroups()`가 유일한 SSOT. 3개 레이어가 모두 이 데이터에서 파생됨:

```
SDUI Layer (무엇을, 어떤 순서로)
  GET /ui/home/buslist
  → 홈 화면 카드 목록, visibility 서버에서 필터링
  → 최소 정보만 (groupId, card, action)

Config Layer (어떻게 구성할지)
  GET /bus/config/:groupId
  → 상세 화면 config, on-demand fetch
  → full group (screen.services[], routeBadges, heroCard 등)

Data Layer (실제 데이터)
  GET /bus/schedule/data/:serviceId/smart  ← status-aware (active/suspended/noData)
  GET /bus/realtime/data/:groupId
  → buses + stationEtas (refreshInterval마다 polling)
```

### Flutter 데이터 흐름

```
홈 화면 진입
  └─ GET /ui/home/buslist → 카드 목록 렌더링 (서버가 visibility 필터링 완료)

카드 탭
  ├─ realtime → GET /bus/config/{groupId} → stations + refreshInterval
  │             └─ poll GET {screen.dataEndpoint} every {refreshInterval}s
  └─ schedule → GET /bus/config/{action.groupId} → full group config 획득
                └─ GET {service.endpoint} → smart 스케줄 데이터 (status-aware)
```

---

## 1. API 변경 요약

| Before | After |
|--------|-------|
| `GET /bus/config` → `{ hssc: {...}, campus: {...} }` | `GET /bus/config` → `{ groups: [...] }` (backward compat) |
| `GET /bus/config/version` → `{ configVersion: N }` | 삭제 — ETag/304로 대체 |
| `GET /bus/campus/inja/{dayType}` | `GET /bus/schedule/data/{serviceId}/smart` (status-aware, auto-select) |
| `GET /bus/campus/jain/{dayType}` | 위와 동일 (serviceId: campus-jain) |
| `GET /bus/campus/eta` | 변경 없음 |
| `/ui/home/buslist` → `{ title, subtitle, ... }` | `/ui/home/buslist` → `{ groupId, card, action }` |
| (없음) | `GET /bus/config/:groupId` — single group config (신규) |

---

## 2. `/bus/config` 새 응답 구조

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "groups": [
      {
        "id": "hssc",
        "screenType": "realtime",
        "label": "인사캠 셔틀버스",
        "visibility": { "type": "always" },
        "card": {
          "themeColor": "003626",
          "iconType": "shuttle",
          "busTypeText": "성대"
        },
        "screen": {
          "endpoint": "/bus/realtime/ui/hssc"
        }
      },
      {
        "id": "campus",
        "screenType": "schedule",
        "label": "인자셔틀",
        "visibility": { "type": "always" },
        "card": { "themeColor": "003626", "iconType": "shuttle", "busTypeText": "성대" },
        "screen": {
          "defaultServiceId": "campus-inja",
          "services": [
            { "serviceId": "campus-inja", "label": "인사캠 → 자과캠", "endpoint": "/bus/schedule/data/campus-inja/smart" },
            { "serviceId": "campus-jain", "label": "자과캠 → 인사캠", "endpoint": "/bus/schedule/data/campus-jain/smart" }
          ],
          "heroCard": {
            "etaEndpoint": "/bus/campus/eta",
            "showUntilMinutesBefore": 0
          },
          "routeBadges": [
            { "id": "regular", "label": "일반", "color": "003626" },
            { "id": "hakbu", "label": "학부대학", "color": "1565C0" }
          ],
          "features": [
            { "type": "info", "url": "https://..." }
          ]
        }
      },
      {
        "id": "fasttrack",
        "screenType": "schedule",
        "label": "패스트트랙",
        "visibility": { "type": "dateRange", "from": "2026-03-09", "until": "2026-03-10" },
        "card": { "themeColor": "E65100", "iconType": "shuttle", "busTypeText": "패스트트랙" },
        "screen": {
          "defaultServiceId": "fasttrack-inja",
          "services": [
            { "serviceId": "fasttrack-inja", "label": "인사캠 → 자과캠", "endpoint": "/bus/schedule/data/fasttrack-inja/smart" }
          ],
          "heroCard": null,
          "routeBadges": [
            { "id": "fasttrack", "label": "패스트트랙", "color": "E65100" }
          ],
          "features": []
        }
      },
      { "id": "jongro02", "screenType": "realtime", "..." : "..." },
      { "id": "jongro07", "screenType": "realtime", "..." : "..." }
    ]
  }
}
```

### 핵심 변경 사항

- **groups는 배열** → 순서가 곧 UI 표시 순서
- **screenType**: `"realtime"` | `"schedule"` — 화면 분기 기준
- **visibility**: 서버가 필터링 (`/ui/home/buslist`). `dateRange` 내에서만 buslist에 포함됨.
  - `{ type: "always" }` → 항상 표시
  - `{ type: "dateRange", from, until }` → KST 기준 `from 00:00` ~ `until 23:59:59.999` 사이에만 표시
- **card**: 메인 목록 카드 렌더링용 (themeColor, iconType, busTypeText)
- **screen**: 상세 화면 렌더링용
  - realtime: `screen.endpoint` (기존 realtime 화면 재사용)
  - schedule: `screen.services[]`, `screen.routeBadges[]`, `screen.heroCard`, `screen.features[]`

### ETag 캐싱 (전체 config + per-group)

```
GET /bus/config
→ 200, ETag: "abc123..."

GET /bus/config
If-None-Match: "abc123..."
→ 304 Not Modified (body 없음)

GET /bus/config/campus
→ 200, ETag: "def456..."

GET /bus/config/campus
If-None-Match: "def456..."
→ 304 Not Modified
```

기존 `checkForUpdates()` → `/bus/config/version` 방식 삭제.
`safeGetConditional`로 ETag 기반 캐싱 사용.

---

## 2-1. `/bus/config/:groupId` 신규 엔드포인트

상세 화면 진입 시 해당 group의 full config를 on-demand로 fetch.

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
    "card": { "themeColor": "003626", "iconType": "shuttle", "busTypeText": "성대" },
    "screen": {
      "defaultServiceId": "campus-inja",
      "services": [...],
      "heroCard": { ... },
      "routeBadges": [...],
      "features": [...]
    }
  }
}
```

```
GET /bus/config/unknown
→ 404
{ "meta": { "error": "GROUP_NOT_FOUND", "message": "Unknown groupId: unknown" }, "data": null }
```

### 사용 시점

| 시점 | 엔드포인트 |
|------|-----------|
| 홈 화면 (카드 목록) | `GET /ui/home/buslist` — 서버가 visibility 필터링 + 최소 card 정보 |
| 상세 화면 진입 | `GET /bus/config/:groupId` — full screen config (services, routeBadges 등) |
| 스케줄 데이터 | `GET /bus/schedule/data/:serviceId/week` — 기존과 동일 |

---

## 2-2. `/ui/home/buslist` 응답 구조 변경 (Breaking Change)

서버가 `getBusGroups()` (SSOT)에서 읽고 visibility 필터링 + card 정보 추출.
**더 이상 클라이언트에서 visibility 필터링할 필요 없음.**

### Before (하드코딩 4개, 고정)

```json
[
  {
    "title": "인사캠 셔틀버스",
    "subtitle": "정차소(인문.농구장) ↔ 600주년 기념관",
    "busTypeText": "성대",
    "busTypeBgColor": "003626",
    "pageLink": "/bus/realtime",
    "pageWebviewLink": null,
    "altPageLink": "https://...",
    "useAltPageLink": false,
    "noticeText": null,
    "showAnimation": false,
    "showNoticeText": false,
    "busConfigId": "hssc"
  }
]
```

### After (SSOT 기반, visibility 필터링 후 동적)

```json
[
  {
    "groupId": "hssc",
    "card": {
      "label": "인사캠 셔틀버스",
      "themeColor": "003626",
      "iconType": "shuttle",
      "busTypeText": "성대"
    },
    "action": {
      "route": "/bus/realtime",
      "groupId": "hssc"
    }
  },
  {
    "groupId": "fasttrack",
    "card": {
      "label": "패스트트랙",
      "themeColor": "E65100",
      "iconType": "shuttle",
      "busTypeText": "패스트트랙"
    },
    "action": {
      "route": "/bus/schedule",
      "groupId": "fasttrack"
    }
  }
]
```

### 필드 매핑

| Before | After |
|--------|-------|
| `title` | `card.label` |
| `busTypeBgColor` | `card.themeColor` |
| `busTypeText` | `card.busTypeText` |
| `pageLink` | `action.route` (`"/bus/realtime"` or `"/bus/schedule"`) |
| `busConfigId` | `groupId` = `action.groupId` |
| `subtitle`, `noticeText`, `showAnimation`, `showNoticeText`, `altPageLink`, `useAltPageLink`, `pageWebviewLink` | 삭제 |

### meta

```json
{ "meta": { "lang": "ko", "busListCount": 5 } }
```

`busListCount`는 visibility 필터링 후 동적 값 (fasttrack dateRange 밖이면 4개, 안이면 5개).

---

## 3. `/bus/schedule/data/:serviceId/smart` 응답 구조

```
GET /bus/schedule/data/campus-inja/smart
```

서버가 자동으로 최적의 주간 + 날짜를 선택하고, `status` 필드로 현재 상태를 명시적으로 전달.

**`status: "active"` — 정상 운행:**
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

**`status: "suspended"` — 운휴 기간 (서버 config에 명시):**
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

**`status: "noData"` — 데이터 갭 (2주 내 운행일 없음):**
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

### 필드 설명

| 필드 | 조건 | 설명 |
|------|------|------|
| `status` | 항상 | `"active"` / `"suspended"` / `"noData"` |
| `from` | active만 | Monday로 정규화된 주간 시작일 |
| `selectedDate` | active만 | 서버가 자동 선택한 운행일 |
| `resumeDate` | suspended만 | 운행 재개 예정일 (until + 1일) |
| `message` | suspended, noData | i18n 번역된 상태 메시지 (active에는 없음) |
| `days[]` | active만 | hidden 필터링된 가시 날짜 배열 (suspended/noData → `[]`) |
| `days[].display` | — | `"schedule"` / `"noService"` (hidden은 서버에서 제거됨) |
| `days[].label` | — | override 라벨 (예: "ESKARA 1일차", "삼일절") |

### ETag 캐싱

```
active:    ETag: "smart-campus-inja-2026-03-16-{md5}"
suspended: ETag: "smart-campus-inja-suspended-{md5}"
noData:    ETag: "smart-campus-inja-noData-{md5}"
Cache-Control: public, max-age=300
```

### 에러 응답 (schedule 전용 형식)

```json
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }
```

주의: 전역 에러 형식 `{ error: { code, message } }`와 **다름**.
`meta.error` 존재 여부로 분기 필요.

---

## 3-1. `/bus/realtime/data/:groupId` — 실시간 버스 데이터

Config/Data 분리: stations (정적) → config에 포함, buses+stationEtas (동적) → data endpoint에서 polling.

### Config 응답 (GET /bus/config/hssc, 1회 fetch + ETag 캐싱)

```json
{
  "data": {
    "id": "hssc",
    "screenType": "realtime",
    "screen": {
      "dataEndpoint": "/bus/realtime/data/hssc",
      "refreshInterval": 10,
      "lastStationIndex": 10,
      "stations": [
        { "index": 0, "name": "농구장", "stationNumber": null, "isFirstStation": true, "isLastStation": false, "isRotationStation": false, "transferLines": [] },
        { "index": 1, "name": "학생회관", "stationNumber": null, "..." : "..." }
      ],
      "routeOverlay": null,
      "features": []
    }
  }
}
```

### Data 응답 (GET /bus/realtime/data/hssc, refreshInterval마다 polling)

```json
{
  "meta": { "lang": "ko", "currentTime": "02:30 PM", "totalBuses": 2 },
  "data": {
    "groupId": "hssc",
    "buses": [
      { "stationIndex": 0, "carNumber": "0000", "estimatedTime": 30 }
    ],
    "stationEtas": []
  }
}
```

Jongro의 경우 `stationEtas`가 채워짐:

```json
{
  "data": {
    "groupId": "jongro07",
    "buses": [
      { "stationIndex": 5, "carNumber": "5537", "estimatedTime": 100, "latitude": 37.58, "longitude": 127.0 }
    ],
    "stationEtas": [
      { "stationIndex": 0, "eta": "3분후[1번째 전]" }
    ]
  }
}
```

### Flutter 흐름

```
화면 진입
  └─ GET /bus/config/{groupId} → stations[], refreshInterval, routeOverlay
     └─ stations로 역 목록 렌더링 (1회)
     └─ Timer.periodic(refreshInterval초)
        └─ GET {screen.dataEndpoint} → buses[], stationEtas[]
           └─ buses → 지도/목록에 버스 위치 표시 (stationIndex로 매칭)
           └─ stationEtas → 역별 도착 정보 표시
```

### 캐싱

| Layer | 캐싱 방식 |
|-------|----------|
| Config (stations) | `Cache-Control: public, max-age=300` + ETag → 304 |
| Data (buses) | `Cache-Control: no-store` → 매번 fresh fetch |

### 주요 필드

| 필드 | 설명 |
|------|------|
| `buses[].stationIndex` | 0-based station index (config의 stations[].index와 매칭) |
| `buses[].carNumber` | 차량번호 |
| `buses[].estimatedTime` | 마지막 위치 보고 후 경과 시간 (초) |
| `buses[].latitude/longitude` | GPS 좌표 (Jongro만, HSSC는 없음) |
| `stationEtas[].stationIndex` | 도착 정보가 있는 역의 index |
| `stationEtas[].eta` | 도착 예정 문자열 (예: "3분후[1번째 전]") |
| `meta.currentTime` | 서버 시각 (KST, 표시용) |
| `meta.totalBuses` | 현재 운행 중인 버스 수 |

---

## 4. Flutter 모델 변경

### 삭제할 모델/클래스

- `BusRouteConfig` — 통째로 교체
- `BusDisplay`, `RealtimeConfig`, `ScheduleConfig`, `BusDirection`
- `ServiceCalendar`, `ServiceException`
- `BusFeatures`, `InfoFeature`, `RouteOverlayFeature`, `EtaFeature`
- 기존 buslist 관련 모델 (title/subtitle/pageLink 기반)

### 새 모델: `BusListItem` (홈 화면 카드)

```dart
// lib/app/model/bus_list_item.dart

class BusListItem {
  final String groupId;
  final BusListCard card;
  final BusListAction action;

  BusListItem({required this.groupId, required this.card, required this.action});

  factory BusListItem.fromJson(Map<String, dynamic> json) {
    return BusListItem(
      groupId: json['groupId'],
      card: BusListCard.fromJson(json['card']),
      action: BusListAction.fromJson(json['action']),
    );
  }

  bool get isRealtime => action.route == '/bus/realtime';
  bool get isSchedule => action.route == '/bus/schedule';
}

class BusListCard {
  final String label;
  final String themeColor; // hex "003626"
  final String iconType;   // "shuttle" | "village"
  final String busTypeText;

  BusListCard({...});
  factory BusListCard.fromJson(Map<String, dynamic> json) => BusListCard(
    label: json['label'],
    themeColor: json['themeColor'],
    iconType: json['iconType'],
    busTypeText: json['busTypeText'],
  );
}

class BusListAction {
  final String route;    // "/bus/realtime" | "/bus/schedule"
  final String groupId;

  BusListAction({...});
  factory BusListAction.fromJson(Map<String, dynamic> json) => BusListAction(
    route: json['route'],
    groupId: json['groupId'],
  );
}
```

### 새 모델: `BusGroup` (상세 화면 config — `/bus/config/:groupId`에서 fetch)

```dart
// lib/app/model/bus_group.dart

class BusGroup {
  final String id;
  final String screenType; // "realtime" | "schedule"
  final String label;
  final BusGroupVisibility visibility;
  final BusGroupCard card;
  final Map<String, dynamic> screen; // screen 구조가 screenType에 따라 다름

  BusGroup({...});

  factory BusGroup.fromJson(Map<String, dynamic> json) {
    return BusGroup(
      id: json['id'],
      screenType: json['screenType'],
      label: json['label'],
      visibility: BusGroupVisibility.fromJson(json['visibility']),
      card: BusGroupCard.fromJson(json['card']),
      screen: json['screen'],
    );
  }

  bool get isRealtime => screenType == 'realtime';
  bool get isSchedule => screenType == 'schedule';

  /// 현재 시각 기준으로 이 group을 보여야 하는지
  bool isVisible(DateTime now) => visibility.isVisible(now);

  // --- schedule 전용 접근자 ---
  String? get defaultServiceId => screen['defaultServiceId'];
  List<BusService> get services =>
      (screen['services'] as List? ?? [])
          .map((e) => BusService.fromJson(e))
          .toList();
  HeroCard? get heroCard => screen['heroCard'] != null
      ? HeroCard.fromJson(screen['heroCard'])
      : null;
  List<RouteBadge> get routeBadges =>
      (screen['routeBadges'] as List? ?? [])
          .map((e) => RouteBadge.fromJson(e))
          .toList();

  // --- realtime 전용 접근자 ---
  String? get realtimeEndpoint => screen['endpoint'];
}
```

### 새 모델: `BusGroupVisibility`

```dart
class BusGroupVisibility {
  final String type; // "always" | "dateRange"
  final String? from;
  final String? until;

  BusGroupVisibility({required this.type, this.from, this.until});

  factory BusGroupVisibility.fromJson(Map<String, dynamic> json) {
    return BusGroupVisibility(
      type: json['type'],
      from: json['from'],
      until: json['until'],
    );
  }

  bool isVisible(DateTime now) {
    if (type == 'always') return true;
    if (type == 'dateRange' && from != null && until != null) {
      final start = DateTime.parse(from!);
      final end = DateTime.parse('${until!}T23:59:59.999');
      return !now.isBefore(start) && !now.isAfter(end);
    }
    return true;
  }
}
```

### 새 모델: `BusService`, `RouteBadge`, `HeroCard`

```dart
class BusService {
  final String serviceId;
  final String label;
  final String endpoint;  // "/bus/schedule/data/{serviceId}/smart"

  BusService({...});
  factory BusService.fromJson(Map<String, dynamic> json) => BusService(
    serviceId: json['serviceId'],
    label: json['label'],
    endpoint: json['endpoint'],
  );
}

class RouteBadge {
  final String id;
  final String label;
  final String color; // hex "003626"

  RouteBadge({...});
  factory RouteBadge.fromJson(Map<String, dynamic> json) => RouteBadge(
    id: json['id'],
    label: json['label'],
    color: json['color'],
  );
}

class HeroCard {
  final String etaEndpoint;
  final int showUntilMinutesBefore;

  HeroCard({...});
  factory HeroCard.fromJson(Map<String, dynamic> json) => HeroCard(
    etaEndpoint: json['etaEndpoint'],
    showUntilMinutesBefore: json['showUntilMinutesBefore'],
  );
}
```

### 새 모델: `SmartSchedule`, `DaySchedule`, `ScheduleEntry`, `ScheduleNotice`

```dart
// lib/app/model/smart_schedule.dart

/// Smart schedule response — status-aware (active/suspended/noData)
class SmartSchedule {
  final String serviceId;
  final String status;          // "active" | "suspended" | "noData"
  final String? from;           // active only
  final String? selectedDate;   // active only
  final String? resumeDate;     // suspended only
  final String? message;        // suspended/noData only (i18n)
  final List<DaySchedule> days; // active: filtered days, others: []

  SmartSchedule({...});

  factory SmartSchedule.fromJson(Map<String, dynamic> json) {
    return SmartSchedule(
      serviceId: json['serviceId'],
      status: json['status'],
      from: json['from'],
      selectedDate: json['selectedDate'],
      resumeDate: json['resumeDate'],
      message: json['message'],
      days: (json['days'] as List)
          .map((d) => DaySchedule.fromJson(d))
          .toList(),
    );
  }

  bool get isActive => status == 'active';
  bool get isSuspended => status == 'suspended';
  bool get isNoData => status == 'noData';

  /// selectedDate에 해당하는 DaySchedule의 인덱스
  int get selectedDayIndex {
    if (selectedDate == null) return 0;
    final idx = days.indexWhere((d) => d.date == selectedDate);
    return idx >= 0 ? idx : 0;
  }
}

class DaySchedule {
  final String date;      // "2026-03-09"
  final int dayOfWeek;    // 1(Mon)~7(Sun)
  final String display;   // "schedule" | "noService" | "hidden"
  final String? label;    // "ESKARA 1일차", "삼일절", null
  final List<ScheduleNotice> notices;
  final List<ScheduleEntry> schedule;

  DaySchedule({...});

  bool get hasSchedule => display == 'schedule';
  bool get isNoService => display == 'noService';
  bool get isHidden => display == 'hidden';

  factory DaySchedule.fromJson(Map<String, dynamic> json) {
    return DaySchedule(
      date: json['date'],
      dayOfWeek: json['dayOfWeek'],
      display: json['display'],
      label: json['label'],
      notices: (json['notices'] as List)
          .map((n) => ScheduleNotice.fromJson(n))
          .toList(),
      schedule: (json['schedule'] as List)
          .map((e) => ScheduleEntry.fromJson(e))
          .toList(),
    );
  }
}

class ScheduleEntry {
  final int index;
  final String time;       // "07:00"
  final String routeType;  // "regular" | "hakbu" | "fasttrack"
  final int busCount;
  final String? notes;     // "만석 시 조기출발", null

  ScheduleEntry({...});
  factory ScheduleEntry.fromJson(Map<String, dynamic> json) => ScheduleEntry(
    index: json['index'],
    time: json['time'],
    routeType: json['routeType'],
    busCount: json['busCount'],
    notes: json['notes'],
  );
}

class ScheduleNotice {
  final String style;   // "info" | "warning"
  final String text;
  final String source;  // "service" | "override"

  ScheduleNotice({...});
  factory ScheduleNotice.fromJson(Map<String, dynamic> json) => ScheduleNotice(
    style: json['style'],
    text: json['text'],
    source: json['source'],
  );
}
```

---

## 5. Repository 변경

### `UiRepository` — buslist fetch (홈 화면)

```dart
class UiRepository {
  final ApiClient _client;

  /// 홈 화면 버스 카드 목록 (서버가 visibility 필터링 완료)
  Future<Result<List<BusListItem>>> getBusList() async {
    return _client.safeGet<List<BusListItem>>(
      '/ui/home/buslist',
      (json) {
        final data = json['data'] as List;
        return data
            .map((e) => BusListItem.fromJson(e as Map<String, dynamic>))
            .toList();
      },
    );
  }
}
```

### `BusConfigRepository` — 전면 교체 (per-group on-demand)

```dart
class BusConfigRepository {
  final ApiClient _client;

  /// groupId별 캐시 (ETag + data)
  final _cache = <String, _GroupCache>{};

  BusConfigRepository(this._client);

  /// 단일 group config fetch (상세 화면 진입 시)
  Future<Result<BusGroup>> getGroupConfig(String groupId) async {
    final cached = _cache[groupId];

    final result = await _client.safeGetConditional<BusGroup>(
      '/bus/config/$groupId',
      (json) {
        final data = json['data'] as Map<String, dynamic>;
        return BusGroup.fromJson(data);
      },
      ifNoneMatch: cached?.etag,
    );

    switch (result) {
      case Ok(:final data):
        if (!data.notModified && data.data != null) {
          _cache[groupId] = _GroupCache(data.data!, data.etag);
          return Ok(data.data!);
        } else if (cached != null) {
          return Ok(cached.group);
        }
        return Err(AppFailure.unknown('No cached data'));
      case Err(:final failure):
        // 네트워크 실패 시 캐시 반환
        if (cached != null) return Ok(cached.group);
        return Err(failure);
    }
  }
}

class _GroupCache {
  final BusGroup group;
  final String? etag;
  _GroupCache(this.group, this.etag);
}
```

> **기존 `GET /bus/config` (전체 groups)는 backward compat으로 유지되지만**,
> 권장 흐름은 buslist → per-group config. 전체 fetch가 필요한 경우에만 사용.

### `BusRepository` — smart schedule 추가

```dart
class BusRepository {
  final ApiClient _client;

  /// Smart 스케줄 조회 (status-aware, ETag 캐싱)
  Future<Result<ConditionalResult<SmartSchedule>>> getSmartSchedule(
    String endpoint, {
    String? ifNoneMatch,
  }) async {
    return _client.safeGetConditional<SmartSchedule>(
      endpoint,
      (json) {
        final data = json['data'] as Map<String, dynamic>;
        return SmartSchedule.fromJson(data);
      },
      ifNoneMatch: ifNoneMatch,
    );
  }

  // 기존 메서드 유지:
  // getLocationsByPath, getStationsByPath, getCampusEta, getRouteOverlay
}
```

### `ApiEndpoints` — 변경

```dart
class ApiEndpoints {
  // 삭제:
  // - busConfigVersion()

  // 변경 없음:
  // - busConfig()         → '/bus/config'
  // - campusEta()         → '/bus/campus/eta'

  // 신규:
  static String busConfigGroup(String groupId) => '/bus/config/$groupId';
  static const buslist = '/ui/home/buslist';

  // 참고용 (실제 endpoint는 config의 endpoint 사용):
  // static String scheduleSmart(String serviceId) => '/bus/schedule/data/$serviceId/smart';
}
```

> endpoint는 `/bus/config/:groupId` 응답의 `screen.services[].endpoint`에서 내려오므로,
> 하드코딩하지 않고 서버가 준 값을 그대로 사용. (현재: `/bus/schedule/data/{serviceId}/smart`)

---

## 6. Controller 변경

### 메인페이지: buslist → 카드 렌더링

```dart
// 기존: BusConfigRepository.all → Map<String, BusRouteConfig> + 클라이언트 visibility 필터링
// 변경: UiRepository.getBusList() → List<BusListItem> (서버가 visibility 필터링 완료)

final result = await uiRepo.getBusList();
switch (result) {
  case Ok(:final data):
    busListItems.value = data;  // List<BusListItem>
  case Err(:final failure):
    logger.e('BusList failed: $failure');
}

// 카드 렌더링 (순서대로)
for (final item in busListItems) {
  // item.card.label, item.card.themeColor, item.card.iconType, item.card.busTypeText
  // 탭 시 action.route로 분기:
  //   "/bus/realtime" → BusRealtimePage(item.action.groupId)
  //   "/bus/schedule" → 먼저 GET /bus/config/{item.action.groupId} → BusSchedulePage(group)
}
```

### 상세 화면 진입 (schedule type)

```dart
// 카드 탭 시 groupId로 full config fetch
final result = await busConfigRepo.getGroupConfig(item.action.groupId);
switch (result) {
  case Ok(:final data):
    Get.to(() => BusSchedulePage(), arguments: data);  // BusGroup
  case Err(:final failure):
    // 에러 처리
}
```

### `BusScheduleController` — 신규 (기존 `BusCampusController` 대체)

```dart
class BusScheduleController extends GetxController {
  final BusRepository _busRepo;
  final BusGroup group;

  // 현재 선택된 service (탭)
  late Rx<BusService> currentService;

  // Smart 스케줄 데이터 (status-aware)
  var schedule = Rx<SmartSchedule?>(null);
  var selectedDayIndex = 0.obs;
  var isLoading = false.obs;

  // ETag 캐시 (serviceId별)
  final _etagMap = <String, String>{};

  @override
  void onInit() {
    super.onInit();
    currentService = Rx(group.services.firstWhere(
      (s) => s.serviceId == group.defaultServiceId,
      orElse: () => group.services.first,
    ));
    _fetchSchedule();
  }

  /// 서비스 탭 전환
  void switchService(BusService service) {
    currentService.value = service;
    schedule.value = null;
    _fetchSchedule();
  }

  /// Smart 스케줄 fetch
  Future<void> _fetchSchedule() async {
    isLoading.value = true;
    final svc = currentService.value;
    final etag = _etagMap[svc.serviceId];

    final result = await _busRepo.getSmartSchedule(
      svc.endpoint,
      ifNoneMatch: etag,
    );

    switch (result) {
      case Ok(:final data):
        if (!data.notModified && data.data != null) {
          schedule.value = data.data;
          _etagMap[svc.serviceId] = data.etag ?? '';
          // Auto-select the server-recommended day
          selectedDayIndex.value = data.data!.selectedDayIndex;
        }
      case Err(:final failure):
        logger.e('Schedule fetch failed: $failure');
    }
    isLoading.value = false;
  }

  // --- Status-based getters ---

  bool get isActive => schedule.value?.isActive ?? false;
  bool get isSuspended => schedule.value?.isSuspended ?? false;
  bool get isNoData => schedule.value?.isNoData ?? false;

  /// 상태 메시지 (suspended, noData)
  String? get statusMessage => schedule.value?.message;

  /// 운행 재개 예정일 (suspended)
  String? get resumeDate => schedule.value?.resumeDate;

  // --- Active-state getters ---

  DaySchedule? get selectedDay {
    final s = schedule.value;
    if (s == null || !s.isActive || s.days.isEmpty) return null;
    final idx = selectedDayIndex.value.clamp(0, s.days.length - 1);
    return s.days[idx];
  }

  List<ScheduleEntry> get currentEntries =>
      selectedDay?.schedule ?? [];

  bool get isNoService =>
      selectedDay?.isNoService ?? false;

  String? get dayLabel => selectedDay?.label;

  List<ScheduleNotice> get dayNotices =>
      selectedDay?.notices ?? [];
}
```

---

## 7. UI 렌더링 가이드

### Status-based 최상위 분기 (가장 먼저)

```dart
// 서버의 status를 신뢰 — 클라이언트가 빈 화면 사유를 추측하지 않음
if (controller.isLoading) {
  return LoadingIndicator();
}

final schedule = controller.schedule.value;
if (schedule == null) {
  return ErrorView();
}

switch (schedule.status) {
  case 'active':
    return _buildScheduleView();    // 요일 칩 + 시간표
  case 'suspended':
    return _buildSuspendedView();   // empty state + message + resumeDate
  case 'noData':
    return _buildNoDataView();      // empty state + message
}
```

### Suspended Empty State

```dart
Widget _buildSuspendedView() {
  return EmptyStateWidget(
    icon: Icons.pause_circle_outline,
    message: controller.statusMessage!,  // "운휴 기간입니다"
    detail: controller.resumeDate != null
      ? '운행 재개: ${controller.resumeDate}'
      : null,
  );
}
```

### NoData Empty State

```dart
Widget _buildNoDataView() {
  return EmptyStateWidget(
    icon: Icons.schedule,
    message: controller.statusMessage!,  // "시간표 정보를 준비 중입니다"
  );
}
```

### 요일 선택 바 (Active 상태에서만)

```
월  화  수  목  금
──────────────────
         ●         ← selectedDayIndex (서버의 selectedDate 기반)
```

- `schedule.days`의 항목 사용 (hidden은 서버에서 이미 제거됨)
- `selectedDayIndex`는 서버의 `selectedDate`로 자동 설정됨
- `label != null`이면 날짜 아래에 라벨 표시 (예: "ESKARA 1일차")

### display별 렌더링 (Active 상태 내부)

```dart
switch (selectedDay.display) {
  case 'schedule':
    // notices 표시 (style에 따라 info/warning 스타일 분기)
    // schedule 목록 렌더링
    break;
  case 'noService':
    // "운행 없음" 표시 + label 있으면 사유 표시 (삼일절 등)
    break;
}
```

> Note: `hidden`은 서버에서 필터링되므로 클라이언트에 도달하지 않음.

### 스케줄 엔트리 렌더링

```dart
for (final entry in currentEntries) {
  Row(
    children: [
      Text(entry.time),                        // "07:00"
      RouteBadgeChip(entry.routeType, group),  // routeBadges에서 색상/라벨 조회
      if (entry.busCount > 1) Text('${entry.busCount}대'),
      if (entry.notes != null) Text(entry.notes!),
    ],
  );
}
```

`routeType`과 `routeBadges` 매칭:
```dart
RouteBadge? badge = group.routeBadges
    .where((b) => b.id == entry.routeType)
    .firstOrNull;
// badge?.label → "일반", badge?.color → "003626"
```

### Notice 렌더링

```dart
for (final notice in dayNotices) {
  Container(
    color: notice.style == 'warning' ? Colors.orange[50] : Colors.blue[50],
    child: Text(notice.text),
  );
}
```

### HeroCard (campus ETA)

```dart
if (group.heroCard != null) {
  // getCampusEta() 호출
  // showUntilMinutesBefore: 다음 버스 출발 N분 전까지만 표시 (0이면 항상)
}
```

---

## 8. 에러 처리 주의사항

schedule 엔드포인트의 에러 형식이 전역과 다름:

```json
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }
```

`ApiClient._parseServerError()`에서 `error.code` 대신 `meta.error`를 확인해야 함.
또는 `safeGet` parser에서 `data == null && meta.error != null` 일 때 별도 처리:

```dart
final result = await _client.safeGet(endpoint, (json) {
  final envelope = json as Map<String, dynamic>;
  final meta = envelope['meta'] as Map<String, dynamic>;
  if (meta.containsKey('error')) {
    throw ScheduleApiError(meta['error'], meta['message']);
  }
  return WeekSchedule.fromJson(envelope);
});
```

---

## 9. 마이그레이션 체크리스트

### 모델
- [ ] `bus_route_config.dart` → 삭제
- [ ] `bus_list_item.dart` 신규 생성 (BusListItem, BusListCard, BusListAction)
- [ ] `bus_group.dart` 신규 생성 (BusGroup, BusGroupVisibility, BusGroupCard, BusService, RouteBadge, HeroCard)
- [ ] `smart_schedule.dart` 신규 생성 (SmartSchedule, DaySchedule, ScheduleEntry, ScheduleNotice)
- [ ] 기존 buslist 모델 삭제 (title/subtitle/pageLink 기반)

### Repository
- [ ] `ui_repository.dart`에 `getBusList()` 추가 (GET /ui/home/buslist)
- [ ] `bus_config_repository.dart` 전면 교체 (per-group on-demand fetch, ETag 캐싱)
- [ ] `bus_repository.dart`에 `getSmartSchedule()` 추가
- [ ] `api_endpoints.dart`: `busConfigVersion()` 삭제, `busConfigGroup()` + `buslist` 추가

### Controller
- [ ] `bus_campus_controller.dart` → `bus_schedule_controller.dart`로 교체
- [ ] 메인페이지: `getBusList()` → `List<BusListItem>` (서버가 visibility 필터링)
- [ ] 상세 화면 진입: `getGroupConfig(groupId)` → `BusGroup` on-demand fetch

### UI
- [ ] 메인 bus list: buslist 응답의 card/action으로 렌더링 (title→card.label, busTypeBgColor→card.themeColor)
- [ ] 카드 탭: action.route로 분기 (realtime vs schedule)
- [ ] schedule 화면 최상위: `status` 기반 분기 (active → 시간표, suspended → empty state, noData → empty state)
- [ ] suspended empty state: message + resumeDate 표시
- [ ] noData empty state: message 표시
- [ ] active 상태: 요일 선택 바 + display별 분기 + routeBadge 색상 매칭
- [ ] notice 렌더링 (style별 색상 분기)
- [ ] ETag 캐싱 적용 (per-group config + smart schedule)

### 삭제
- [ ] `/bus/config/version` 호출 코드
- [ ] 클라이언트 visibility 필터링 로직 (서버에서 처리)
- [ ] `ServiceCalendar`, `ServiceException` 관련 로직 (서버가 display 필드로 대체)
- [ ] `BusDirection.endpoint` + `{dayType}` 치환 로직 (smart endpoint로 대체)
- [ ] 기존 buslist 파싱 코드 (title/subtitle/pageLink → groupId/card/action)

---

# Flutter Map Overlay Migration Guide

> **Date**: 2026-03-15 (updated)
> **Status**: Server migration complete. Flutter update pending.

---

## What Changed (2026-03-15)

Building marker overlays were **removed from the overlay system** and consolidated into the building module.

### Before

```
/map/config → layers[campus_buildings].endpoint = "/map/overlays?category=hssc"
                                                     ↓
                                          map-overlays.data.js (13 hardcoded markers)
                                          Response: { category, overlays: [{ type, position, marker }] }
```

### After

```
/map/config → layers[campus_buildings].endpoint = "/map/markers/campus"
                                                     ↓
                                          building.data.js → MongoDB (78 DB-backed markers)
                                          Response: { markers: [{ skkuId, buildNo, name, lat, lng, ... }] }
```

### Removed

- `GET /map/overlays?category=hssc` — **returns 404 now**
- `features/map/map-overlays.data.js` — deleted (hardcoded building data)
- ETag/Cache-Control for building overlays — no longer needed (DB-backed with 5min cache)

### Still Active

- `GET /map/overlays/:overlayId` — bus route polylines (`jongro07`, `jongro02`) unchanged
- `GET /map/config` — same structure, only `campus_buildings` endpoint URL changed
- `GET /map/markers/campus` — now the sole source for building markers (78 buildings, both campuses)

---

## Response Shape Change

**Old overlay shape** (removed):
```json
{
  "category": "hssc",
  "overlays": [
    {
      "type": "marker",
      "id": "bldg_hssc_law",
      "position": { "lat": 37.5874, "lng": 126.9905 },
      "marker": { "icon": null, "label": "법학관", "subLabel": "2" }
    }
  ]
}
```

**New markers shape** (`/map/markers/campus`):
```json
{
  "markers": [
    {
      "skkuId": 2,
      "buildNo": "1",
      "type": "building",
      "name": { "ko": "수선관", "en": "Suseon Hall" },
      "campus": "hssc",
      "lat": 37.587,
      "lng": 126.994,
      "image": "https://www.skku.edu/..."
    }
  ]
}
```

### Field Mapping

| Old (overlay) | New (markers) | Notes |
|---------------|---------------|-------|
| `id` (`bldg_hssc_law`) | `skkuId` (int) | Use for detail API: `GET /building/{skkuId}` |
| `position.lat/lng` | `lat/lng` | Flat fields, no nesting |
| `marker.label` | `name.ko` / `name.en` | Bilingual object, select by locale |
| `marker.subLabel` | `buildNo` | Can be `null` for facilities |
| `marker.icon` | *(removed)* | Was always `null` |
| *(none)* | `type` | `"building"` or `"facility"` |
| *(none)* | `campus` | Filter client-side (`"hssc"` or `"nsc"`) |
| *(none)* | `image` | Building photo URL |

---

## Flutter Impact

See `flutter-building-api-guide.md` for the full building API reference.

The Flutter map layer controller needs to handle the new response shape when loading the `campus_buildings` layer. The `/map/config` still drives the layer pipeline — only the endpoint URL and response parser need to change.

Bus route polyline layers (`jongro07`, `jongro02`) are unaffected.

---

# Flutter Smart Schedule — 구현 가이드

## API 개요

Smart Schedule API는 버스 시간표를 **status-aware**로 제공한다.
클라이언트가 "왜 비었는지" 추측하지 않고, 서버가 명시적으로 상태를 알려준다.

```
GET /bus/schedule/data/{serviceId}/smart
Accept-Language: ko|en|zh
```

endpoint URL은 하드코딩하지 않는다.
`GET /bus/config/{groupId}` 응답의 `screen.services[].endpoint`에서 받아 사용.

---

## 응답 3가지 상태

### `active` — 정상 운행

```json
{
  "data": {
    "serviceId": "campus-inja",
    "status": "active",
    "from": "2026-03-16",
    "selectedDate": "2026-03-16",
    "days": [
      {
        "date": "2026-03-16",
        "dayOfWeek": 1,
        "display": "schedule",
        "label": null,
        "notices": [{ "style": "info", "text": "...", "source": "service" }],
        "schedule": [
          { "index": 1, "time": "08:00", "routeType": "regular", "busCount": 1, "notes": null }
        ]
      },
      { "date": "2026-03-17", "dayOfWeek": 2, "display": "schedule", "..." : "..." },
      { "date": "2026-03-20", "dayOfWeek": 5, "display": "noService", "label": "삼일절", "..." : "..." }
    ]
  }
}
```

- `selectedDate`: 서버가 자동 선택한 "오늘 이후 첫 운행일"
- `days[]`: hidden 날이 이미 제거된 상태 (토/일 등)
- `message` 필드 없음

### `suspended` — 운휴 기간

```json
{
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

- `resumeDate`: 운행 재개 예정일 (서버가 자동 계산)
- `message`: Accept-Language에 따라 자동 번역 (ko/en/zh)

### `noData` — 데이터 없음

```json
{
  "data": {
    "serviceId": "campus-inja",
    "status": "noData",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "시간표 정보를 준비 중입니다"
  }
}
```

- 서버 운영 이슈 (데이터 미등록 등)
- `resumeDate` 없음

---

## 필드 존재 조건

| 필드 | active | suspended | noData |
|------|--------|-----------|--------|
| `status` | O | O | O |
| `serviceId` | O | O | O |
| `from` | O (Monday) | `null` | `null` |
| `selectedDate` | O | `null` | `null` |
| `days[]` | O (비어있지 않음) | `[]` | `[]` |
| `resumeDate` | X | O | X |
| `message` | X | O | O |

---

## Flutter 모델

### `SmartSchedule`

```dart
class SmartSchedule {
  final String serviceId;
  final String status;         // "active" | "suspended" | "noData"
  final String? from;
  final String? selectedDate;
  final String? resumeDate;
  final String? message;
  final List<DaySchedule> days;

  SmartSchedule({
    required this.serviceId,
    required this.status,
    this.from,
    this.selectedDate,
    this.resumeDate,
    this.message,
    required this.days,
  });

  factory SmartSchedule.fromJson(Map<String, dynamic> json) {
    return SmartSchedule(
      serviceId: json['serviceId'],
      status: json['status'],
      from: json['from'],
      selectedDate: json['selectedDate'],
      resumeDate: json['resumeDate'],
      message: json['message'],
      days: (json['days'] as List)
          .map((d) => DaySchedule.fromJson(d as Map<String, dynamic>))
          .toList(),
    );
  }

  bool get isActive => status == 'active';
  bool get isSuspended => status == 'suspended';
  bool get isNoData => status == 'noData';

  /// selectedDate에 해당하는 day 인덱스 (active 전용)
  int get selectedDayIndex {
    if (selectedDate == null) return 0;
    final idx = days.indexWhere((d) => d.date == selectedDate);
    return idx >= 0 ? idx : 0;
  }
}
```

### `DaySchedule`

```dart
class DaySchedule {
  final String date;           // "2026-03-16"
  final int dayOfWeek;         // 1(Mon)~7(Sun)
  final String display;        // "schedule" | "noService"
  final String? label;         // "ESKARA 1일차", "삼일절", null
  final List<ScheduleNotice> notices;
  final List<ScheduleEntry> schedule;

  DaySchedule({...});

  bool get hasSchedule => display == 'schedule';
  bool get isNoService => display == 'noService';

  factory DaySchedule.fromJson(Map<String, dynamic> json) {
    return DaySchedule(
      date: json['date'],
      dayOfWeek: json['dayOfWeek'],
      display: json['display'],
      label: json['label'],
      notices: (json['notices'] as List)
          .map((n) => ScheduleNotice.fromJson(n as Map<String, dynamic>))
          .toList(),
      schedule: (json['schedule'] as List)
          .map((e) => ScheduleEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
```

### `ScheduleEntry`, `ScheduleNotice`

```dart
class ScheduleEntry {
  final int index;
  final String time;          // "08:00" (24h, KST)
  final String routeType;    // "regular" | "hakbu" | "fasttrack"
  final int busCount;
  final String? notes;

  ScheduleEntry({...});
  factory ScheduleEntry.fromJson(Map<String, dynamic> json) => ScheduleEntry(
    index: json['index'],
    time: json['time'],
    routeType: json['routeType'],
    busCount: json['busCount'],
    notes: json['notes'],
  );
}

class ScheduleNotice {
  final String style;        // "info" | "warning"
  final String text;
  final String source;       // "service" | "override"

  ScheduleNotice({...});
  factory ScheduleNotice.fromJson(Map<String, dynamic> json) => ScheduleNotice(
    style: json['style'],
    text: json['text'],
    source: json['source'],
  );
}
```

---

## Repository

```dart
class BusRepository {
  final ApiClient _client;

  /// Smart 스케줄 fetch (서버 status-aware)
  /// endpoint: config에서 받은 URL (e.g., "/bus/schedule/data/campus-inja/smart")
  Future<Result<SmartSchedule>> getSmartSchedule(
    String endpoint, {
    String? ifNoneMatch,
  }) async {
    return _client.safeGet<SmartSchedule>(
      endpoint,
      (json) {
        final data = json['data'] as Map<String, dynamic>;
        return SmartSchedule.fromJson(data);
      },
    );
  }
}
```

### ETag 캐싱 (선택)

smart endpoint는 `Cache-Control: public, max-age=300` + ETag를 지원한다.
ETag 포맷:

```
active:    "smart-campus-inja-2026-03-16-{md5}"
suspended: "smart-campus-inja-suspended-{md5}"
noData:    "smart-campus-inja-noData-{md5}"
```

ETag 캐싱을 원하면 `safeGetConditional` 사용:

```dart
Future<Result<ConditionalResult<SmartSchedule>>> getSmartSchedule(
  String endpoint, {String? ifNoneMatch}
) async {
  return _client.safeGetConditional<SmartSchedule>(
    endpoint,
    (json) => SmartSchedule.fromJson(json['data']),
    ifNoneMatch: ifNoneMatch,
  );
}
```

---

## Controller

```dart
class BusScheduleController extends GetxController {
  final BusRepository _busRepo;
  final BusGroup group;

  late Rx<BusService> currentService;
  var schedule = Rx<SmartSchedule?>(null);
  var selectedDayIndex = 0.obs;
  var isLoading = false.obs;

  @override
  void onInit() {
    super.onInit();
    currentService = Rx(group.services.firstWhere(
      (s) => s.serviceId == group.defaultServiceId,
      orElse: () => group.services.first,
    ));
    _fetch();
  }

  void switchService(BusService service) {
    currentService.value = service;
    schedule.value = null;
    _fetch();
  }

  Future<void> _fetch() async {
    isLoading.value = true;
    final result = await _busRepo.getSmartSchedule(
      currentService.value.endpoint,
    );
    switch (result) {
      case Ok(:final data):
        schedule.value = data;
        selectedDayIndex.value = data.selectedDayIndex;
      case Err(:final failure):
        // 에러 핸들링
    }
    isLoading.value = false;
  }

  // --- Status ---
  bool get isActive => schedule.value?.isActive ?? false;
  bool get isSuspended => schedule.value?.isSuspended ?? false;
  bool get isNoData => schedule.value?.isNoData ?? false;
  String? get statusMessage => schedule.value?.message;
  String? get resumeDate => schedule.value?.resumeDate;

  // --- Active-only ---
  DaySchedule? get selectedDay {
    final s = schedule.value;
    if (s == null || !s.isActive || s.days.isEmpty) return null;
    return s.days[selectedDayIndex.value.clamp(0, s.days.length - 1)];
  }

  List<ScheduleEntry> get entries => selectedDay?.schedule ?? [];
  List<ScheduleNotice> get notices => selectedDay?.notices ?? [];
}
```

---

## UI 구현

### 최상위 분기 (status 기반)

```dart
Widget build(BuildContext context) {
  return Obx(() {
    if (controller.isLoading.value) {
      return const Center(child: CircularProgressIndicator());
    }

    final schedule = controller.schedule.value;
    if (schedule == null) {
      return _buildError();
    }

    return switch (schedule.status) {
      'active'    => _buildActiveView(),
      'suspended' => _buildSuspendedView(),
      'noData'    => _buildNoDataView(),
      _           => _buildError(),
    };
  });
}
```

### Suspended Empty State

```dart
Widget _buildSuspendedView() {
  return Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.pause_circle_outline, size: 48, color: Colors.grey),
        SizedBox(height: 16),
        Text(
          controller.statusMessage!,   // "운휴 기간입니다"
          style: TextStyle(fontSize: 16, color: Colors.grey[700]),
        ),
        if (controller.resumeDate != null) ...[
          SizedBox(height: 8),
          Text(
            '운행 재개: ${controller.resumeDate}',
            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
          ),
        ],
      ],
    ),
  );
}
```

### NoData Empty State

```dart
Widget _buildNoDataView() {
  return Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.schedule, size: 48, color: Colors.grey),
        SizedBox(height: 16),
        Text(
          controller.statusMessage!,   // "시간표 정보를 준비 중입니다"
          style: TextStyle(fontSize: 16, color: Colors.grey[700]),
        ),
      ],
    ),
  );
}
```

### Active — 요일 칩 바

```dart
Widget _buildDayChips() {
  final days = controller.schedule.value!.days;
  return Row(
    children: List.generate(days.length, (i) {
      final day = days[i];
      final isSelected = i == controller.selectedDayIndex.value;

      return GestureDetector(
        onTap: () => controller.selectedDayIndex.value = i,
        child: Column(
          children: [
            // 요일 이름 (월, 화, ...)
            Text(_weekdayLabel(day.dayOfWeek)),
            // 날짜 숫자
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isSelected ? Theme.of(context).primaryColor : null,
              ),
              child: Text(day.date.substring(8)),  // "16"
            ),
            // 라벨 (삼일절, ESKARA 등)
            if (day.label != null)
              Text(day.label!, style: TextStyle(fontSize: 10)),
            // 운행 없음 표시
            if (day.isNoService)
              Container(width: 4, height: 4, color: Colors.red),
          ],
        ),
      );
    }),
  );
}

String _weekdayLabel(int dow) =>
    const ['', '월', '화', '수', '목', '금', '토', '일'][dow];
```

### Active — 시간표 목록

```dart
Widget _buildScheduleList() {
  final day = controller.selectedDay;
  if (day == null) return const SizedBox.shrink();

  if (day.isNoService) {
    return Center(
      child: Text(
        day.label ?? '운행 없음',
        style: TextStyle(color: Colors.grey),
      ),
    );
  }

  return Column(
    children: [
      // Notices
      for (final notice in controller.notices)
        _buildNotice(notice),
      // Entries
      for (final entry in controller.entries)
        _buildEntry(entry),
    ],
  );
}
```

### Notice 렌더링

```dart
Widget _buildNotice(ScheduleNotice notice) {
  return Container(
    padding: EdgeInsets.all(12),
    color: notice.style == 'warning' ? Colors.orange[50] : Colors.blue[50],
    child: Row(
      children: [
        Icon(
          notice.style == 'warning' ? Icons.warning : Icons.info,
          size: 16,
        ),
        SizedBox(width: 8),
        Expanded(child: Text(notice.text)),
      ],
    ),
  );
}
```

### Entry + RouteBadge 매칭

```dart
Widget _buildEntry(ScheduleEntry entry) {
  // group.routeBadges에서 routeType으로 매칭
  final badge = controller.group.routeBadges
      .where((b) => b.id == entry.routeType)
      .firstOrNull;

  return ListTile(
    leading: Text(entry.time, style: TextStyle(fontSize: 16)),
    title: Row(
      children: [
        if (badge != null)
          Container(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: Color(int.parse('FF${badge.color}', radix: 16)),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(badge.label, style: TextStyle(color: Colors.white, fontSize: 12)),
          ),
        if (entry.busCount > 1) ...[
          SizedBox(width: 8),
          Text('${entry.busCount}대'),
        ],
      ],
    ),
    subtitle: entry.notes != null ? Text(entry.notes!) : null,
  );
}
```

---

## 전체 데이터 흐름

```
1. 홈 화면
   GET /ui/home/buslist → 카드 목록

2. "인자셔틀" 카드 탭
   GET /bus/config/campus → group config (services[], routeBadges 등)

3. 시간표 화면 진입
   GET {services[0].endpoint} → SmartSchedule

4. status 분기
   ├─ active    → 요일 칩 + 시간표 렌더링
   ├─ suspended → empty state + message + resumeDate
   └─ noData    → empty state + message

5. 서비스 탭 전환 (인사캠→자과캠)
   GET {services[1].endpoint} → SmartSchedule (다시 status 분기)
```

---

## 에러 처리 주의

schedule 에러 형식이 전역과 다르다:

```json
// Schedule 에러
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }

// 전역 에러
{ "error": { "code": "...", "message": "..." } }
```

`safeGet` parser에서 `data == null && meta.error != null` 체크 필요:

```dart
(json) {
  final meta = json['meta'] as Map<String, dynamic>;
  if (meta.containsKey('error')) {
    throw ApiException(meta['error'], meta['message']);
  }
  return SmartSchedule.fromJson(json['data']);
}
```

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

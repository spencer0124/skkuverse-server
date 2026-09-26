---
title: Fail Over the Poller
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-26
audience: internal
---

# Fail Over the Poller

> How to move the poller from one origin host to another by hand — the host role file, the order that never leaves the bus data without a writer, how to confirm the bus data is fresh, and how to move it back.

## Overview

Every origin host runs the api replicas; exactly one runs the poller. The poller calls the external bus APIs and writes the results to the shared Mongo `bus_cache` collection, and every replica on every host serves bus data from there. So one poller is enough for all hosts, and two would call every external API twice (the Seoul bus API key has a daily quota).

Which host runs it is set per host in `/etc/skkuverse/host.env`:

| `POLLER_ROLE` | The deploy ([deploy-host.yml](../../.github/workflows/deploy-host.yml)) | The heartbeat ([heartbeat.sh](../../infra/monitoring/heartbeat.sh)) |
| --- | --- | --- |
| `active` | Builds, updates and checks the poller | Fails if the poller is not running |
| `standby` | Never builds, starts or checks it; aborts if one is running | Fails if the poller **is** running |

A missing or invalid file stops both (the deploy aborts before changing the host; the heartbeat stops pinging, which Healthchecks.io reports as "down"). The parser is [infra/hosts/poller-role.sh](../../infra/hosts/poller-role.sh). The file is the whole contract: exactly one line `POLLER_ROLE=active` or `POLLER_ROLE=standby`, no quotes, no spaces.

What the poller does, and what stops when no host runs it:

| Job | Without a poller |
| --- | --- |
| Bus positions and arrivals (HSSC shuttle, Jongro buses, station arrivals) | `bus_cache` entries expire (TTL index on `_updatedAt`, 60 s, applied by Atlas within about another minute), then the realtime endpoints return no buses. Everything else keeps serving |
| Building data sync | Building data stops refreshing; what is stored keeps serving |
| Notice push safety-net sweep (`DISPATCH_SWEEP_ENABLED`) | Only the crawler's cycle-end trigger dispatches pushes. That is the primary path, so pushes still go out |

The poller's jobs and their intervals are registered in `src/` (`registerPoller(` calls) — that is the current list.

The load balancer does not know about the poller: disabling or draining a host's endpoint ([operate-load-balancer.md](operate-load-balancer.md)) leaves its poller running, and moving the poller does not change where requests go.

This is a stopgap. Phase B replaces the role file with leader election over a Mongo lease, so any host takes the poller over automatically and `POLLER_ROLE` goes away ([decisions/0009](../decisions/0009-multi-origin-active-active.md)).

## Prerequisites

- SSH to both hosts (`ssh oracle`, `ssh mnemosyne`) with `sudo`.
- The new host is onboarded and deployed ([lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md#onboard-another-origin-host)) and has the same `.env` as the current active host.
- Both hosts are on the same commit: `git rev-parse --short HEAD` in the deploy checkout matches on both. mnemosyne is updated by its own workflow after oracle's deploy ([Deploy mnemosyne](../cicd-and-branch-protection.md#deploy-mnemosyne-self-hosted-runner)); if that run did not go green, deploy it by hand first ([Deploy a host by hand](../cicd-and-branch-protection.md#deploy-a-host-by-hand)).

Below, **OLD** is the host running the poller now and **NEW** is the one taking it over. Every command runs in the deploy checkout:

```bash
cd /home/ubuntu/skkumap-server-express
```

## Steps

### Move the poller (both hosts up)

Start the new one before stopping the old one. The overlap is a few seconds of two pollers, which is harmless: `bus_cache` writes are upserts of the same keys, and the push sweep claims each notice under a lease. Keep it short anyway — run step 3 as soon as step 2 passes, well under a minute.

> [!NOTE]
> Starting a poller runs a full building sync at once: it re-fetches every building and space from the external API and upserts them all to Atlas, which takes about ten seconds. While it runs, requests on **every** host can take a second or two longer. In a drill this cost no failed requests, but move the poller at a quiet hour, not at peak.

1. On NEW, change the role and start the poller:

   ```bash
   echo 'POLLER_ROLE=active' | sudo tee /etc/skkuverse/host.env
   docker compose up -d --no-deps poller
   docker compose ps poller                       # State: running
   docker compose logs poller --since 2m          # "Running in poller-only mode", "MongoDB connected"
   ```

   A standby host's deploy does not build the poller image, so `up` builds it first. It shares every layer with the api image, so this takes seconds.
2. On NEW, confirm it is writing (see [Check that bus data is fresh](#check-that-bus-data-is-fresh)): `hssc` a few seconds old.
3. On OLD, change the role, then stop and remove the poller, in one line so the heartbeat never sees the two disagree for long:

   ```bash
   echo 'POLLER_ROLE=standby' | sudo tee /etc/skkuverse/host.env && docker compose stop poller && docker compose rm -f poller
   ```

   Remove it, not only stop it. The heartbeat tolerates a stopped poller on a standby host (only a running one is an alert), but a stopped container can come back by accident: every api replica has `depends_on: poller`, so any `docker compose up` on this host without `--no-deps` starts it again — two pollers, and nothing alerts until the next heartbeat. With the container gone, a standby host looks exactly like a freshly onboarded one. The image stays, so moving the poller back needs no rebuild.
4. Check again that bus data is fresh, then that both hosts' heartbeats are green on Healthchecks.io at the next run (about a minute).

### Take the poller over when OLD is down

Do steps 1 and 2 on NEW only. Bus data comes back within about ten seconds of the poller starting.

> [!WARNING]
> When OLD comes back, Docker restarts its poller (`restart: unless-stopped`) and its role file still says `active`, so its heartbeat stays green while **two pollers run**. Nothing alerts on this. As soon as OLD is reachable, run step 3 on it.

### Check that bus data is fresh

The poller stamps every `bus_cache` write with `_updatedAt`. The HSSC shuttle entry (`hssc`) is written on every poll, even when no bus is running, so its age is the clearest signal: a few seconds means a live poller; no document at all means no poller has written for over a minute. The Jongro and station entries are written on their own, longer intervals.

From any host (it reads the shared collection, so it works on either):

```bash
docker compose exec -T api-1 node -e '
const c = require("./dist/src/infra/config");
const { getClient } = require("./dist/src/infra/db");
getClient().db(c.mongo.dbName).collection(c.mongo.collections.busCache)
  .find({}, { projection: { _updatedAt: 1 } }).toArray()
  .then((docs) => {
    for (const d of docs) console.log(d._id, Math.round((Date.now() - d._updatedAt) / 1000) + "s ago");
    process.exit(0);
  }, (e) => { console.error(e.message); process.exit(1); });'
```

From outside, through Cloudflare, during bus service hours:

```bash
curl -sD - https://api.skkuverse.com/bus/realtime/data/hssc | grep -i x-served-by
curl -s https://api.skkuverse.com/bus/realtime/data/hssc | jq '.meta'
```

`meta.totalBuses` above 0 means users see buses (`meta.currentTime` is the server's clock, not the data's age). Outside service hours `totalBuses` is 0 either way, so use the `bus_cache` check. Repeat the `curl` a few times: `X-Served-By` shows it is answered by both hosts, and both read the same data.

### Move it back

The same procedure with the hosts swapped: on the host taking it back, step 1 and 2; on the other, step 3.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Heartbeat: `poller: running on a standby host` | The poller was started without changing that host's role file, the host came back after a takeover, or a `docker compose up` without `--no-deps` revived a stopped poller | Decide which host should run it; run step 3 on the other |
| Heartbeat: `poller: no container` or `poller: exited` on the active host | The role file says `active` but the poller is not running there | Step 1 on that host, or step 3 if it should be standby |
| Deploy aborts: "the poller is running on this host, but host.env says POLLER_ROLE=standby" | Same contradiction, found by the deploy before it changed anything | Fix it as above, then re-run the workflow |
| Deploy or heartbeat: "no valid POLLER_ROLE" / `poller-role:` errors | `/etc/skkuverse/host.env` missing, empty, quoted or with a second `POLLER_ROLE` line | Rewrite it with exactly one line; the error says what it found |
| `hssc` entry missing or minutes old after step 1 | The poller is not polling: bad `.env`, Atlas access list missing NEW's IP, or the external API is down | `docker compose logs poller`; compare with OLD's logs |

## Related

- [decisions/0009](../decisions/0009-multi-origin-active-active.md) — why several origins, and why the poller runs on one host until leader election
- [lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md) — onboarding an origin host, including its role file
- [monitor-production.md](monitor-production.md) — the heartbeat and what its alerts mean
- [operate-load-balancer.md](operate-load-balancer.md) — draining or removing a host, which is separate from moving its poller
- [docs/README.md](../README.md) — writing rules

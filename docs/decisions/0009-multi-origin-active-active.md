---
title: Multiple Origins, Active-Active, Behind Cloudflare Load Balancing
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-26
audience: internal
---

# 0009. Multiple Origins, Active-Active, Behind Cloudflare Load Balancing

## Status

Accepted — 2026-09-24. Phase A (two hosts) is to be in place before the ESKARA
festival on 2026-10-01/02; Phase B (N identical hosts) follows it.

Phase A in place. Since 2026-09-25 the load balancer is live with both hosts
in the pool; on 2026-09-26 the failover drills passed and both hosts went to
equal weights. How the load balancer is operated:
[operate-load-balancer.md](../how-to/operate-load-balancer.md). What changed
against the plan below is under [Rollout notes](#rollout-notes).

## Context

The API ran on one host, the OCI VM in Chuncheon. Capacity was not the
problem: its three replicas measured about 1,990 req/s against an estimated
festival peak of about 700 req/s. Availability was: one VM, one provider, one
region. If the VM or OCI failed during the festival, everything failed.

A second host was available: `mnemosyne`, a rented Naver Cloud x86 server in
Seoul, rented until 2026-10-07. Every public host name is already proxied by
Cloudflare, and the origins accept 80/443 only from Cloudflare's ranges
([lock-origin-to-cloudflare.md](../how-to/lock-origin-to-cloudflare.md)).

Three questions had to be answered: what sends traffic to more than one
origin, which Cloudflare plan that needs, and whether the second host serves
traffic all the time or only when the first fails.

### Front door options

| Option | For | Against |
| --- | --- | --- |
| **Cloudflare Load Balancing add-on** | Health-checked, automatic failover. Zero-downtime failover retries a request that could not connect on another endpoint in the same pool. Adding a host is adding an endpoint. Keeps the current firewall and certificates | $5/month for 2 endpoints, +$5 per extra endpoint |
| Two A records + a DNS flip | Free | No health checks; the flip is automation we would write, and takes about 4 minutes. Cannot see a host that is up with a dead app |
| Cloudflare Tunnel | Free, no inbound ports | Tunnel replicas alone give connector HA only. Health-aware failover still needs the Load Balancing add-on, with the tunnel as an endpoint; on an HTTP ingress route its monitor request reaches the origin service (to be confirmed by a drill) |
| Workers-based failover | Any behaviour we want | The Free plan caps at 100k requests/day, so it needs Workers Paid, and puts our own code on every request's path |
| OCI free load balancer | Free | 10 Mbps is too little, and it sits in OCI — the failure domain we are trying to leave |
| Route 53, Fly.io, k3s | Powerful | Not compatible with the Cloudflare proxy as set up, or a migration; far more than two hosts need |

### Cloudflare plan

- Pro does not include Load Balancing; Pro plus the add-on is about $30/month.
- Pro does not make failover faster: the monitor interval is 60 s on the Free
  plan too, and 30 s or 15 s intervals are paid options of the add-on itself.
- What Pro adds for this use is Discord webhooks for load-balancer alerts and
  the load-balancing analytics view. Monitoring already has a Discord path
  (Healthchecks.io, UptimeRobot — [monitor-production.md](../how-to/monitor-production.md)).

### Active-active or primary/standby

Primary/standby — all traffic to OCI, the second host only on failure — was
the first proposal. Compared side by side:

| | Active-active | Primary/standby |
| --- | --- | --- |
| Adding a host | One more endpoint in the pool | A new failover tier or pool |
| Capacity | Every host's CPU serves traffic | The standby's CPU idles |
| Is the second host actually working? | Proven by real requests, continuously | Unknown until the failover; a standby can rot unnoticed |
| Connection failure on one host | Retried on another endpoint in the same pool (zero-downtime failover) | Waits for the monitor to fail the primary |
| A mistake on a new host | Reaches users at once | Hidden until failover |
| Per-client rate limit | Held in each process's memory, so N hosts are N times as lenient | Unchanged |
| The rented host | Sees a share of user requests until it is returned | Sees them only during a failover |

## Decision

**Cloudflare Load Balancing add-on on the Free plan, one pool, every origin
active.** $5/month for two endpoints ($10 for three).

- One pool, `api-origins`, holds every origin as an endpoint. The load
  balancer on `api.skkuverse.com` uses it as both default and fallback pool.
  Endpoint steering is Random (included in the base price), with weights; a
  new host enters at a low weight (0.1 → 0.5 → 1) while nginx 5xx, the
  heartbeat and Atlas ops are watched.
- Monitor: HTTPS `GET /health/ready`, `Host: api.skkuverse.com`, body must
  contain `ready`, 60 s interval, 5 s timeout, 2 retries, one region. Its
  health alerts go out by email.
- The existing A records stay as the rollback: turning the load balancer off
  returns to them. `ota.` and `files.` keep their own records; they are not
  load-balanced.
- Every host runs the same compose file, nginx site, firewall and deploy
  ([deploy.yml](../../.github/workflows/deploy.yml) runs
  [deploy-host.yml](../../.github/workflows/deploy-host.yml) once per host, in
  order). Replica count is the same everywhere; hosts of different size are
  balanced with endpoint weights, not with per-host compose files. nginx adds
  `X-Served-By: <hostname>` to every response so a response can be traced to
  its host.
- **The poller runs on one host only (OCI) until leader election.** Every
  replica on every host serves bus data from the shared Mongo `bus_cache`, so
  one poller serves all hosts. Each host declares its role in
  `/etc/skkuverse/host.env` (`POLLER_ROLE=active|standby`); the deploy and the
  heartbeat read it and fail on a missing or invalid file. Moving the poller
  is manual: [fail-over-poller.md](../how-to/fail-over-poller.md).
- The rented host uses the same `.env` as OCI — the same database
  credentials and API keys. The maintainer accepted that risk for the
  rental period rather than minting a second set of credentials for a few
  days.

### Phase B, after the festival

- Leader election for the poller: a lease document in Mongo, expiry computed
  from the database clock, renewed every 10 s with a 30 s TTL, and the holder
  stepping down on its own monotonic clock before the lease can lapse. Then
  `POLLER_ROLE` and the manual fail-over go away, and every host is identical.
- Images built once per architecture in CI and pushed to a registry, so hosts
  pull instead of building; deploys drain a host (its endpoint weight to 0)
  before restarting it.
- One checkout path and a host inventory from which the deploy chain is
  generated.
- Optional: a Tunnel per host as its endpoint (no inbound ports), a shared
  rate-limit store or Cloudflare's rate-limit rules, load-balancer alerts to
  Discord.

## Consequences

- **A host that refuses connections costs users nothing**: zero-downtime
  failover retries those requests on the other endpoint.
- **A host that answers with 5xx is removed only by the monitor**: at a 60 s
  interval, for a few minutes a share of requests fails. A faster interval is
  a paid option if that proves too slow.
- **If OCI fails, bus realtime data goes empty** within about two minutes
  (`bus_cache` TTL), while every other endpoint keeps serving from the other
  host, until someone moves the poller. The heartbeat alert is the trigger.
  Phase B removes this gap.
- **If every host is unhealthy** (for example an Atlas outage), the fallback
  pool is the same pool, so traffic still goes to the hosts — the same
  behaviour as with one host.
- **Rate limiting is about twice as lenient** with two hosts, because each
  process counts on its own. Accepted for the festival; revisited in Phase B.
- **Atlas load scales with processes**, not with traffic alone: twice the
  replicas means twice the connection pools and the idle ops. Estimated at
  about 7 ops/s and 90 of 500 connections — inside the Flex tier, but watched
  during the weight ramp.
- **A mistake on a new host reaches users immediately**, mitigated by the
  weight ramp and by checking the host on its own before it joins
  ([onboarding](../how-to/lock-origin-to-cloudflare.md#onboard-another-origin-host)).
- **Returning the rented host (2026-10-07)**: drain it, remove the endpoint
  (or the load balancer, if no other host is planned), then take it out of
  Atlas's access list, the deploy chain, GitHub's secrets and the monitoring,
  and shred its `.env` and origin key — the checklist is
  [Remove an origin](../how-to/operate-load-balancer.md#remove-an-origin).
  The credentials in that `.env` remain valid — the accepted risk above.

## Rollout notes

What the rollout changed against the decision above, in the order found.

- **The second host is deployed by hand.** Its provider's firewall allows SSH
  only from an allow-listed network, so GitHub-hosted runners cannot reach
  it. `deploy-mnemosyne` stays in the chain, switched off with the
  `MNEMOSYNE_ENABLED` repo variable, and the same remote script is run over
  SSH from the allowed network instead
  ([Deploy a host by hand](../cicd-and-branch-protection.md#deploy-a-host-by-hand)).
  Still open: give Actions a path to the host (a private network overlay, so
  no public SSH port is needed at all, or asking the provider to open SSH
  wider), or keep deploying it by hand until it is returned.
- **A host hygiene check before go-live found problems on the rented host.**
  Secrets were withdrawn from it, the provider resolved the problems, the
  checks were repeated, and the rollout resumed. The check is now an
  onboarding step:
  [Check the host is clean](../how-to/lock-origin-to-cloudflare.md#onboard-another-origin-host).
- **The monitor was tightened** from the plan: an expected body (`ready`, so a
  proxy error page with status 200 counts as down) and an explicit 5 s
  timeout.
- **Load-balancer health alerts are enabled**, by email. They are the only
  Cloudflare notification used; the Discord path stays with Healthchecks.io
  and UptimeRobot.
- **The old A record stays** as the rollback, as planned: the load balancer
  takes precedence over it while enabled.
- **Follow-up: origin-path stalls via some Cloudflare colos.** Some requests
  stall for seconds on the path between certain Cloudflare locations and the
  origins, on every origin alike; the hosts themselves are idle. The app's
  request timeouts were shortened meanwhile. After the festival, Cloudflare
  Tunnel endpoints are to be evaluated against the direct endpoints (tracked
  internally).
- **The failover drills passed (2026-09-26), and the ramp is finished.** At a
  low-traffic hour, with an outside probe running throughout: disabling
  either endpoint moved all traffic to the other within seconds; stopping
  nginx on one host was absorbed by zero-downtime failover; the poller moved
  to the second host and back with `bus_cache` fresh throughout. No probe
  request failed in any of them. Both endpoints then went to equal weights.
  What the drills taught is in the runbooks: a re-enabled endpoint serves
  only after its next monitor check, a pool edit needs a second
  confirmation
  ([operate-load-balancer.md](../how-to/operate-load-balancer.md#pool-edits-and-the-monitor)),
  and starting a poller runs a full building sync that briefly slows every
  host, and the host left standby must have its poller container removed
  ([fail-over-poller.md](../how-to/fail-over-poller.md#move-the-poller-both-hosts-up)).

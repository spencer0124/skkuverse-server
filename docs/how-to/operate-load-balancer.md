---
title: Operate the Load Balancer
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-25
audience: internal
---

# Operate the Load Balancer

> How the Cloudflare load balancer in front of the origin hosts is set up, and how to ramp a host's weight, drain it, take it out, roll back to plain DNS, drill a failover, and add or remove an origin.

## Overview

`api.skkuverse.com` is served by a Cloudflare load balancer (the Load Balancing add-on on the Free plan) that spreads requests over every origin host, all active at once. Why this and not the alternatives: [decisions/0009](../decisions/0009-multi-origin-active-active.md). Nothing about it lives in this repo; it is configured in the Cloudflare dashboard (Traffic → Load Balancing), which holds the current values. Its shape:

| Part | Setting |
| --- | --- |
| Load balancer | Host name `api.skkuverse.com`, proxied. Default pool and fallback pool are the same pool |
| Pool | One pool, `api-origins`. Endpoint steering Random, with weights |
| Endpoints | One per origin host, named by provider and region (for example `oci-chuncheon`), addressed by the host's public IP |
| Monitor `api-health-ready` | HTTPS `GET /health/ready`, header `Host: api.skkuverse.com`, response body must contain `ready`, 60 s interval, 5 s timeout, 2 retries, one check region |
| Notification | Load Balancing health alert, by email (the Free plan's Cloudflare notifications are email-only) |
| Rollback path | The proxied `api` A record from before the load balancer is kept. While the load balancer is enabled it takes precedence over that record; disabling the load balancer makes the record answer again |

What the monitor and the pool do with a failure:

| Failure on one host | What users see |
| --- | --- |
| The host refuses or drops connections (host down, nginx stopped) | Nothing: Cloudflare's zero-downtime failover retries the request on another endpoint in the pool |
| The host answers, but `/health/ready` fails (503, 5xx, wrong body) | That host's share of requests fails until the monitor marks it unhealthy, then the pool stops sending it traffic |
| Every host is unhealthy | The fallback pool is the same pool, so traffic still goes to the hosts — as with one host |

The monitor's `Host` header matters: it makes the request match the `api.skkuverse.com` nginx site. Without it the request falls to the catch-all server, gets no response, and every endpoint reads as unhealthy. The origins accept 443 from Cloudflare's ranges only ([lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md)); the monitor's probes come from those ranges, so the lock does not affect them.

Pricing is per endpoint: the base price covers two, and each further endpoint adds to it ([decisions/0009](../decisions/0009-multi-origin-active-active.md) has the figures as decided). Health checks from more regions or at shorter intervals are paid options of the add-on, not of the zone plan.

### What is not behind it

Only `api.skkuverse.com`. `ota.` and `files.` keep their own DNS records and are not load-balanced. The mini-apps and webviews are static sites on Cloudflare Pages and never reach an origin. Static Pages requests are unlimited and free; Pages Functions, by contrast, count against the account's Workers request quota (100k/day on Workers Free), which a zone plan upgrade does not raise — so keep Functions out of anything festival traffic loads. Pages builds are capped per month and run one at a time across the whole account, so a burst of deploys queues.

### Tell which host answered

nginx adds `X-Served-By: <hostname>` to every response ([infra/nginx/api.skkuverse.com](../../infra/nginx/api.skkuverse.com)). To see the split the load balancer is producing right now:

```bash
for i in $(seq 1 200); do
  curl -s -o /dev/null -D - https://api.skkuverse.com/health/ready | awk 'tolower($1) == "x-served-by:" { print $2 }'
done | sort | uniq -c
```

With Random steering each request is drawn independently, so a host's expected share is its weight divided by the sum of all weights, and 200 samples land within a few points of it.

## Prerequisites

- Access to the Cloudflare account that holds the `skkuverse.com` zone, with Load Balancing.
- SSH to the origin hosts for anything that changes a host, and the ability to watch nginx logs, `docker stats`, the heartbeat ([monitor-production.md](monitor-production.md)) and Atlas Metrics (ops/s and connections).

## Steps

### Ramp a host's weight

A host enters at a low weight and is raised in steps: 0.1, then 0.5, then 1. At each step, for at least several minutes of real traffic:

1. Change the endpoint's weight in the pool and save.
2. Sample `X-Served-By` (above) and check the split matches the weights.
3. On the new host: nginx 5xx in the access log, `docker stats` for the replicas, the heartbeat green.
4. In Atlas: ops/s and connections. Every host's replicas hold their own connection pools, so connections rise with the host count, not with traffic.

Hold the step back (lower the weight again) on any rise in 5xx or a heartbeat failure. The current weights are in the dashboard; do not write them down elsewhere.

### Drain a host

For a restart, a risky change, or before removing it. Set its endpoint weight to 0 (or disable the endpoint) and wait a few minutes: in-flight requests finish, new ones go to the other endpoints. Sample `X-Served-By` until the host no longer appears. Undo by restoring the weight or enabling the endpoint.

### Take a host out in an emergency

Disable its endpoint in the pool. This does not wait for the monitor, and zero-downtime failover covers requests already on their way to it. If the host still runs the poller, move the poller first or right after ([fail-over-poller.md](fail-over-poller.md)): the load balancer knows nothing about it.

### Roll back to plain DNS

Disable the load balancer. The kept `api` A record answers again, sending all traffic to the host it points at. Before doing this, check that record still points at a host that is up and serving: it is not health-checked, and nothing updates it when hosts change. Re-enable the load balancer to return.

### Drill a failover

Run these at a low-traffic hour before relying on the second host, and after any change to the pool or the monitor. Watch 5xx, the heartbeat and Atlas throughout.

| Drill | Do | Expect | Undo |
| --- | --- | --- | --- |
| One host takes everything | Disable one endpoint | `X-Served-By` shows only the other host; its CPU and Atlas connections hold | Enable the endpoint |
| A host stops accepting connections | `sudo systemctl stop nginx` on one host | No failed requests from outside (zero-downtime failover); the monitor marks it unhealthy within a few minutes; the health-alert email arrives; the heartbeat reports nginx | `sudo systemctl start nginx`; the monitor marks it healthy again and a recovery email arrives |
| Move the poller | [fail-over-poller.md](fail-over-poller.md), there and back | `bus_cache` stays fresh throughout | — |

### Add an origin

1. Onboard the host completely, including checking it alone, before it is in the pool ([lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md#onboard-another-origin-host)).
2. Add it as an endpoint of `api-origins`, with its public IP as the address, at weight 0.1. The monitor applies to it at once.
3. Wait for the dashboard to show it healthy, then [ramp its weight](#ramp-a-hosts-weight).
4. Add a UptimeRobot monitor for it if it has a host name of its own ([monitor-production.md](monitor-production.md#add-a-public-url-to-uptimerobot)).

### Remove an origin

For a host being returned or retired. In order:

1. If it runs the poller, move the poller to a host that stays ([fail-over-poller.md](fail-over-poller.md)).
2. [Drain it](#drain-a-host), confirm it no longer appears in `X-Served-By`, then delete its endpoint from the pool. If only one endpoint would remain, disable the load balancer instead, after pointing the `api` A record at the remaining host (a one-endpoint load balancer only adds cost).
3. Deploy chain: set the host's repo variable to `false`, then remove its job from [deploy.yml](../../.github/workflows/deploy.yml) and the test that pins the chain (`deploy-workflow.test.ts`), and delete its GitHub secrets and variable.
4. Remove its public IP from the Atlas access list.
5. Delete its Healthchecks.io check and any UptimeRobot monitor for it.
6. On the host, before handing it back: shred the `.env`, the Cloudflare origin key and `/etc/skkuverse/heartbeat.env` (`shred -u`), and remove the deploy key from `authorized_keys`.
7. Decide about the credentials that were in its `.env`. They stay valid after the file is shredded; rotate them if the host was not fully under your control.
8. Update the docs that name the host.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every endpoint unhealthy, but the site works with the load balancer off | The monitor does not reach the `api.skkuverse.com` site: `Host` header missing or wrong, or the expected body does not match | Check the monitor's header and body settings against the table above |
| One endpoint unhealthy, the host looks fine from inside | The host's firewall or provider security group rejects Cloudflare, or `/health/ready` returns 503 (DB ping failing) | On the host: `curl -sk --resolve api.skkuverse.com:443:127.0.0.1 https://api.skkuverse.com/health/ready`; check the firewall's Cloudflare list is current |
| The split does not match the weights | Too few samples, or an endpoint is unhealthy or disabled | Sample more; check endpoint health in the pool |
| 52x for everyone right after disabling the load balancer | The `api` A record points at a host that is down or gone | Re-enable the load balancer, then fix the record |

## Related

- [decisions/0009](../decisions/0009-multi-origin-active-active.md) — why several active origins behind Cloudflare Load Balancing
- [lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md) — onboarding an origin host, and the firewall the monitor passes through
- [fail-over-poller.md](fail-over-poller.md) — the one thing the load balancer does not move
- [monitor-production.md](monitor-production.md) — the alerts to watch while changing the pool
- [cicd-and-branch-protection.md](../cicd-and-branch-protection.md) — the per-host deploy chain, and deploying a host GitHub cannot reach
- [docs/README.md](../README.md) — writing rules

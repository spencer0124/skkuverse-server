---
title: Monitor Production
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-25
audience: internal
---

# Monitor Production

> How production is watched, what each alert means, how to add a host to the watch, and how to test the alert path without touching a running container.

## Overview

Two layers hide failures from users, so two layers watch for them. nginx retries a request on another replica when one dies, and Cloudflare Load Balancing routes around a dead origin host ([operate-load-balancer.md](operate-load-balancer.md)). Each is good for users and bad for detection: the service looks up from outside while capacity is gone.

| Layer | Service | Watches | Alerts when |
| --- | --- | --- | --- |
| Outside-in | UptimeRobot (free, 5-minute checks) | The public host names, through Cloudflare, as a user reaches them | A public URL stops answering, or answers without the expected keyword |
| Edge | Cloudflare Load Balancing monitor (60 s checks) | Each origin's `/health/ready`, from Cloudflare | An endpoint turns unhealthy or recovers |
| Inside-out | Healthchecks.io (free), one check per host | Each host, from the host itself: every compose service, nginx, and the other containers on it | The host posts a failure, or stops pinging at all |

Both deliver to `#server-alerts` on the SKKUVERSE Discord server (Healthchecks.io through its Discord integration, UptimeRobot through a channel webhook), plus email. The crawler's webhook posts elsewhere and is not part of this. Cloudflare's notifications are email-only on the Free plan (Cloudflare Pro was evaluated for its Discord webhooks and declined, 2026-09-24), so only one is used: the load balancer's health alert, by email to the account owner.

UptimeRobot watches the public URLs (`https://api.skkuverse.com/health/ready` by keyword, `https://ota.skkuverse.com/hc` by HTTP), Healthchecks.io has one check per origin host, and the load balancer's monitor covers every endpoint in its pool; the dashboards are the current lists.

### The per-host heartbeat

Cron runs [infra/monitoring/heartbeat.sh](../../infra/monitoring/heartbeat.sh) every minute ([infra/monitoring/skkuverse-heartbeat.cron](../../infra/monitoring/skkuverse-heartbeat.cron) is the schedule, user and path). The script's header lists the checks; in short, every service in [docker-compose.yml](../../docker-compose.yml) must have one running, not-unhealthy container, nginx must serve `/health/ready` on loopback, and no other container on the host may be restarting or unhealthy.

- All pass: it pings the host's check URL.
- Any fail: it re-checks once after a short delay (so a deploy recreating a container does not page), then posts the failures to `<check URL>/fail`. The body — host name and one line per problem — appears in the alert.
- The host, Docker or cron is down: nothing is sent, and Healthchecks.io raises "down" when the grace period runs out.

The expected services come from `docker compose config`, so adding a replica needs no change here.

### What fires when

| Event | Alert | Detection |
| --- | --- | --- |
| A replica or the poller is unhealthy, stopped or missing | Healthchecks.io: failure body names it | Next heartbeat run, within about a minute plus the Docker healthcheck's own retries |
| nginx or its upstreams fail on the host | Healthchecks.io: `nginx /health/ready: …` | Next heartbeat run |
| Crawler, AI or OTA container restarting or unhealthy | Healthchecks.io: failure body names it | Next heartbeat run |
| A poller running on a `standby` host | Healthchecks.io: `poller: running on a standby host` | Next heartbeat run |
| VM down, Docker hung, cron stopped, env file or host role file missing | Healthchecks.io: "down" (no ping) | Check period plus grace period |
| Public URL down (DNS, Cloudflare, origin unreachable) | UptimeRobot | Up to one check interval |
| One origin fails `/health/ready` as Cloudflare sees it (host down, firewall rejecting Cloudflare, DB ping failing) | Cloudflare email: Load Balancing health alert, naming the endpoint; another when it recovers | The monitor's interval and retries ([operate-load-balancer.md](operate-load-balancer.md)) |

Period, grace and check intervals are set in each service's dashboard, not in this repo; see those for the current values.

## Prerequisites

- SSH access to the host as the user named in the cron file.
- Access to the Healthchecks.io and UptimeRobot accounts, and to the Cloudflare account for the load balancer's health alerts.

## Steps

### Add a host to the heartbeat

This is one step of onboarding a new origin host; the full order (checkout, heartbeat, firewall, nginx, outside-in monitor) is in [lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md#onboard-another-origin-host).

1. In Healthchecks.io, create a check for the host, with a 1-minute period and a grace period of a few minutes, and the Discord integration enabled. Name it by provider and region (for example `oracle-chuncheon`, `naver-seoul`): the alert body carries the machine's `hostname`, which on cloud VMs is a generated `instance-…` name. Copy its ping URL.
2. On the host, create the env file. It holds the ping URL, which is a secret, so it is not in the repo:

   ```bash
   sudo install -d -m 0755 /etc/skkuverse
   sudo install -m 0600 -o ubuntu -g ubuntu /dev/null /etc/skkuverse/heartbeat.env
   echo 'HC_PING_URL=https://hc-ping.com/<check-uuid>' > /etc/skkuverse/heartbeat.env   # as that user
   ```

   The owner must be the user the cron file runs as.
3. Deploy (or wait for the next one). The deploy workflow installs the cron file into `/etc/cron.d/`. Until the env file exists the script exits without pinging, so installing it early is harmless.
4. Run the script once by hand from the deploy checkout and confirm the check turns green:

   ```bash
   <deploy-checkout>/infra/monitoring/heartbeat.sh
   ```

The cron file names one user and one checkout path, the same on every host (the deploy installs it unchanged). The script expects a container for every service in `docker-compose.yml`, with one exception set by the host's role file `/etc/skkuverse/host.env`: on a `POLLER_ROLE=standby` host the poller is not expected, and a **running** poller there is reported as a failure ("poller: running on a standby host") — two pollers would poll every external API twice. A missing or invalid role file makes the script exit without pinging, like a missing `heartbeat.env`. Moving the poller between hosts: [fail-over-poller.md](fail-over-poller.md).

### Add a public URL to UptimeRobot

Use a keyword monitor where the endpoint returns a body, so a proxy error page with status 200 still counts as down. `https://api.skkuverse.com/health/ready` returns `{"status":"ready",…}`; use the keyword `"ready"` with the quotes, alerting when it does not exist. The quotes matter: the 503 body `{"status":"unavailable",…}` contains no quoted `"ready"`, while other bodies might contain the bare word.

Where an endpoint returns an empty body (`https://ota.skkuverse.com/hc`), use a plain HTTP monitor. That monitor sends `HEAD`, so the endpoint must answer it: the OTA server returned 405 to `HEAD /hc` until its nginx forwarded the probe as `GET` (`proxy_method GET`, skkuverse-codepush PR #1). `files.skkuverse.com` has no health path, so it is not monitored. Health endpoints must not be cached at the edge — check that `cf-cache-status` is `DYNAMIC` or `BYPASS`.

When there is more than one origin behind a load balancer, add one monitor per origin host name as well, so a dead origin is not hidden by the healthy one. Every monitor must go through Cloudflare: the origins accept 80/443 from Cloudflare's ranges only ([lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md)), so a check against an origin IP fails by design.

### Test the alert path

Neither test stops a container.

- Heartbeat failure and recovery, on the host:

  ```bash
  ( . /etc/skkuverse/heartbeat.env && curl -fsS --data-raw "alert test" "$HC_PING_URL/fail" )
  <deploy-checkout>/infra/monitoring/heartbeat.sh   # sends a real ping: recovery
  ```

  Expect a "down" message in Discord, then an "up" message.
- UptimeRobot: send a test notification from the alert contact's settings.
- Missed pings: create a throwaway check, ping it once by hand, and let its grace period expire. This exercises the "down" path without silencing the host's real check.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Check shows "down" but the host is up | `journalctl -t skkuverse-heartbeat` on the host — a missing or unreadable env file is logged there |
| Failure body says a service has no container | `docker compose ps -a` in the deploy checkout |
| `nginx /health/ready` failure | `sudo nginx -t`, then the replicas' `curl localhost:<port>/health/ready` |
| Alert during every deploy | The re-check delay in the script is shorter than a container recreate |

## Related

- [infra/monitoring/heartbeat.sh](../../infra/monitoring/heartbeat.sh) — the checks, and why a broken setup never pings
- [lock-origin-to-cloudflare.md](lock-origin-to-cloudflare.md) — the origin firewall, onboarding another origin host, and reaching a locked origin
- [.github/workflows/deploy-host.yml](../../.github/workflows/deploy-host.yml) — installs the cron file on every host
- [fail-over-poller.md](fail-over-poller.md) — the host role file, and moving the poller
- [operate-load-balancer.md](operate-load-balancer.md) — the load balancer's monitor, and taking a failing origin out
- [docs/README.md](../README.md) — writing rules

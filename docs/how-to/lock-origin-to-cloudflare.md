---
title: Lock the Origin to Cloudflare
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-24
audience: internal
---

# Lock the Origin to Cloudflare

> How an origin host is closed to everything but Cloudflare — the nginx catch-all server, the host firewall and the Cloudflare IP lists they share — and how to apply, verify, roll back and refresh each.

## Overview

Every public host name is proxied by Cloudflare, so nothing legitimate reaches an origin host directly. Direct traffic is scanners, and anything that bypasses Cloudflare also bypasses its cache, rate limiting and TLS. Two layers close that path:

| Layer | What it stops | Source | Applied by |
| --- | --- | --- | --- |
| nginx catch-all server | A request for a host name nginx does not serve (a bare IP, a retired name) gets no response instead of whichever site loads first | [infra/nginx/00-default-catchall](../../infra/nginx/00-default-catchall) | The deploy, every run |
| Host firewall | A TCP connection to 80/443 from any address outside Cloudflare's ranges is rejected | [infra/firewall/cloudflare-only.sh](../../infra/firewall/cloudflare-only.sh), run at boot by [skkuverse-firewall.service](../../infra/firewall/skkuverse-firewall.service) | **By hand, once per host** (below); the deploy only installs the unit |

Both depend on one list of Cloudflare ranges:

| File | Role |
| --- | --- |
| [infra/cloudflare/ips-v4.txt](../../infra/cloudflare/ips-v4.txt), [ips-v6.txt](../../infra/cloudflare/ips-v6.txt) | The single source of truth, verbatim from `https://www.cloudflare.com/ips-v4` and `/ips-v6` |
| [infra/nginx/cloudflare-realip.conf](../../infra/nginx/cloudflare-realip.conf) | Generated from the lists by `npm run cloudflare-ips`; the ranges nginx trusts `CF-Connecting-IP` from. `npm test` fails when it is stale |
| [.github/workflows/cloudflare-ips.yml](../../.github/workflows/cloudflare-ips.yml) | Weekly comparison with cloudflare.com; a red run is the drift alert |

Design choices worth knowing before touching any of it:

- **The firewall is iptables on the host, not the OCI security list.** The security list cannot be versioned from here (no OCI CLI), and the rented Naver host has a different one. iptables is already the filter that decides, so one script covers every host.
- **`/etc/iptables/rules.v4` is never rewritten.** It still holds the open 80/443 rules; the unit re-applies the lock after `netfilter-persistent` loads it at boot. Never run `netfilter-persistent save`: it would freeze Docker's chains and fail2ban's current bans into the file.
- **It fails open.** If the script refuses or fails (list missing, `INPUT` not shaped as expected), the open rules stay and the site keeps serving. The alternative, failing closed, is an outage.
- **IPv4 only.** The hosts have no IPv6 address and nginx listens on IPv4 only. The script warns if a host gains a global IPv6 address.
- **nginx 1.18 has no `ssl_reject_handshake`** (it arrived in 1.19.4), so the catch-all completes a TLS handshake with a self-signed `CN=invalid` certificate the deploy generates, then closes the connection. It never presents the origin certificate, which would name the domain to a scanner.

## Prerequisites

- `ssh oracle` (or the host in question) with passwordless `sudo`.
- A deploy of a commit that contains the files above has finished, so the checkout holds the script and `/etc/systemd/system/skkuverse-firewall.service` exists.
- A second terminal. Keep one SSH session open for the whole firewall procedure; SSH (port 22) is never touched by the script, but an open session is the way back if something unexpected happens.

## Steps

### Remove a retired site (one-time, after the catch-all is deployed)

With the catch-all in place, removing a site sends its host name to the catch-all rather than to another site. This is how the legacy `api.skkuuniverse.com` site was removed.

```bash
ssh oracle
ts=$(date +%s)
sudo cp -a /etc/nginx/sites-available/api.skkuuniverse.com ~/api.skkuuniverse.com.bak.$ts
sudo rm /etc/nginx/sites-enabled/api.skkuuniverse.com /etc/nginx/sites-available/api.skkuuniverse.com
sudo nginx -t && sudo systemctl reload nginx
```

Rollback: copy the backup back to `sites-available`, re-create the symlink in `sites-enabled`, `nginx -t`, reload.

### Apply the firewall (one-time per host)

```bash
ssh oracle                                  # session 1 — leave it open throughout
cd /home/ubuntu/skkumap-server-express      # the deploy checkout (DEPLOY_PATH)
sudo iptables-save > ~/iptables.bak.$(date +%s)
sudo iptables -S INPUT                      # expect the open --dport 443 / --dport 80 ACCEPTs, then a final REJECT
sudo infra/firewall/cloudflare-only.sh --dry-run
sudo infra/firewall/cloudflare-only.sh
sudo iptables -S INPUT                      # the two ACCEPTs are now one jump to SKKUVERSE-CF
sudo systemctl enable --now skkuverse-firewall
systemctl status skkuverse-firewall --no-pager
```

`enable --now` runs the script a second time, which changes nothing (it is idempotent) and proves the unit works before the next reboot depends on it.

Then verify, from outside the host (before the lock, the first check instead completes a TLS handshake with the `CN=invalid` certificate and gets an empty reply from the catch-all):

| Check | Expected |
| --- | --- |
| `curl -skm 5 https://<origin-ip>/` from a Mac | `No route to host` — the final REJECT answers with ICMP host-prohibited. A timeout instead means something upstream (the security list) dropped it |
| `curl -s https://api.skkuverse.com/health/ready`, and the same for `ota.` and `files.` | 200 through Cloudflare |
| A **new** SSH session | Opens |
| Healthchecks.io and UptimeRobot | Stay up — see [monitor-production.md](monitor-production.md) |
| `sudo tail -f /var/log/nginx/access.log` for ~10 minutes | No rise in 5xx; Cloudflare Analytics shows no rise in 52x |

### Roll back the firewall

Either of these, from the session kept open:

```bash
sudo infra/firewall/cloudflare-only.sh --undo       # reopens 80/443 first, then removes the jump and chain
sudo systemctl disable skkuverse-firewall           # or the lock returns at the next boot
```

```bash
sudo iptables-restore < ~/iptables.bak.<ts>         # the exact pre-apply ruleset
sudo systemctl disable skkuverse-firewall
```

`--undo` is the better first choice: `iptables-restore` also rewinds Docker's chains and fail2ban's bans to the moment of the backup. `systemctl stop skkuverse-firewall` does not reopen anything.

### Refresh after Cloudflare changes its ranges

The weekly workflow goes red, or `npm run cloudflare-ips -- --live` reports a difference. A range Cloudflare **added** is urgent: until the host is refreshed, requests through that edge are rejected by the firewall (Cloudflare shows 52x) and share one rate-limit key in nginx. A range it **removed** only stays trusted a little longer.

1. `npm run cloudflare-ips -- --live --write` — copies Cloudflare's lists into `infra/cloudflare/` and regenerates the nginx snippet.
2. Commit, open the PR, release to `main`. The deploy installs the new snippet and reloads nginx.
3. On every host with the lock: `sudo systemctl restart skkuverse-firewall`. The script adds the new ranges before it removes the old ones, so no Cloudflare connection is rejected during the change.
4. `sudo iptables -S SKKUVERSE-CF` lists the new set.

### Add another host (for example the Naver server, at the load-balancing stage)

The deploy installs the unit wherever it runs. Check that the host's `INPUT` has the same shape — open `--dport 80`/`--dport 443` ACCEPTs and a final REJECT or DROP — then follow [Apply the firewall](#apply-the-firewall-one-time-per-host). If the shape differs, the script refuses and says why; adapt the host's base rules rather than the script. A security group in front of the host (OCI, Naver ACG) is a separate layer and still has to allow Cloudflare in.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The script exits 1 before changing anything | The list is empty or malformed, `INPUT` does not end in a REJECT/DROP, or `INPUT` has a 80/443 ACCEPT it does not recognise | Read the message; fix the list or the host's rules. Nothing was changed |
| `skkuverse-firewall` is `failed` after a reboot | Same as above, or the checkout path moved | `journalctl -u skkuverse-firewall -b`. The host is open (fail-open) until fixed |
| Cloudflare 522/52x for some users only | A Cloudflare range missing from the list | [Refresh](#refresh-after-cloudflare-changes-its-ranges); `--undo` meanwhile if it is widespread |
| A real host name returns no response (curl: "Empty reply from server") | It fell to the catch-all: no site has that `server_name` | Add the name to its site; the catch-all's access log lines show status 444 |
| Deploy aborts with "nginx rejected the new config" | `nginx -t` failed; the previous config was restored | Run `sudo nginx -t` on the host for the error |

## Related

- [monitor-production.md](monitor-production.md) — the alerts to watch while applying
- [docs/README.md](../README.md) — writing rules
- `infra/nginx/api.skkuverse.com` header — the client-IP contract the real-IP snippet is half of

---
title: Lock the Origin to Cloudflare
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-24
audience: internal
---

# Lock the Origin to Cloudflare

> How an origin host is closed to everything but Cloudflare — the nginx catch-all server, the host firewall and the Cloudflare IP lists they share — how to apply, verify, roll back and refresh each, how to reach a locked origin, and how to onboard another origin host.

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
- **Direct HTTP(S) to an origin IP stops working, on purpose.** That includes load tests from another server and monitors pointed at an IP. Go through Cloudflare, or over SSH — see [Reach a locked origin](#reach-a-locked-origin).
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

### Reach a locked origin

Port 22 is never touched, and loopback traffic never meets the lock:

| Need | How |
| --- | --- |
| A shell | `ssh oracle` |
| One replica, on the host | `curl -s http://localhost:3001/health/ready` (each replica has its own loopback port; the list is in `docker-compose.yml`) |
| nginx and the upstream pool, on the host | `curl -sk --resolve api.skkuverse.com:443:127.0.0.1 https://api.skkuverse.com/health/ready` — the same probe the heartbeat runs |
| The origin from a Mac, bypassing Cloudflare | `ssh -N -L 8443:127.0.0.1:443 oracle`, then `curl -sk --resolve api.skkuverse.com:8443:127.0.0.1 https://api.skkuverse.com:8443/health/ready` |
| A load test | Through Cloudflare (edge cache and the per-client-IP rate limit apply), or run the generator on the host over SSH, capped so it does not starve the replicas |

If a test really needs one outside address to reach 80/443 directly, allow it in `INPUT` for the duration and remove it afterwards. The script leaves rules with a source address alone, and nothing persists them, so a reboot also clears it:

```bash
sudo iptables -I INPUT -s <ip>/32 -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo iptables -D INPUT -s <ip>/32 -p tcp -m multiport --dports 80,443 -j ACCEPT   # when done
```

Do not add it to the `SKKUVERSE-CF` chain: the next apply or refresh deletes every source in that chain that is not a Cloudflare range.

### Refresh after Cloudflare changes its ranges

The weekly workflow goes red, or `npm run cloudflare-ips -- --live` reports a difference. A range Cloudflare **added** is urgent: until the host is refreshed, requests through that edge are rejected by the firewall (Cloudflare shows 52x) and share one rate-limit key in nginx. A range it **removed** only stays trusted a little longer.

1. `npm run cloudflare-ips -- --live --write` — copies Cloudflare's lists into `infra/cloudflare/` and regenerates the nginx snippet.
2. Commit, open the PR, release to `main`. The deploy installs the new snippet and reloads nginx.
3. On every host with the lock: `sudo systemctl restart skkuverse-firewall`. The script adds the new ranges before it removes the old ones, so no Cloudflare connection is rejected during the change.
4. `sudo iptables -S SKKUVERSE-CF` lists the new set.

### Onboard another origin host

For example the rented Naver server (`ssh mnemosyne`) at the load-balancing stage. In order, before the load balancer sends it traffic:

1. **Get the repo files onto it.** The deploy workflow deploys to the single host in its `ORACLE_VM_HOST` secret, so a second host needs its own deploy step or a checkout kept in step by hand. The unit's `ExecStart` and the heartbeat cron line both name the OCI checkout path and user (`/home/ubuntu/…`, `ubuntu`); adjust them for a host whose checkout or login differs.
2. **Heartbeat.** Create the host's Healthchecks.io check (named by provider and region, 1-minute period, a few minutes' grace, Discord integration on), write `/etc/skkuverse/heartbeat.env` and install the cron file — [monitor-production.md](monitor-production.md#add-a-host-to-the-heartbeat). An api-only host needs the heartbeat's expected services narrowed first (see the note there).
3. **Firewall.** Check that the host's `INPUT` has the same shape — open `--dport 80`/`--dport 443` ACCEPTs and a final REJECT or DROP — then follow [Apply the firewall](#apply-the-firewall-one-time-per-host): back up, `--dry-run`, apply, `systemctl enable --now skkuverse-firewall`, verify. If the shape differs, the script refuses and says why; adapt the host's base rules rather than the script. A security group in front of the host (OCI security list, Naver ACG) is a separate layer and still has to allow Cloudflare in.
4. **nginx.** Install the real-IP snippet, `api.skkuverse.com` and the catch-all (with its certificate) the way the deploy does, then `nginx -t`.
5. **Outside-in monitor.** Add an UptimeRobot monitor for the new origin's own proxied host name ([monitor-production.md](monitor-production.md#add-a-public-url-to-uptimerobot)).
6. **Refresh duty.** From now on, [Refresh after Cloudflare changes its ranges](#refresh-after-cloudflare-changes-its-ranges) includes this host: its snippet and its firewall unit both need the new lists.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The script exits 1 before changing anything | The list is empty or malformed, `INPUT` does not end in a REJECT/DROP, or `INPUT` has a 80/443 ACCEPT it does not recognise | Read the message; fix the list or the host's rules. Nothing was changed |
| `skkuverse-firewall` is `failed` after a reboot | Same as above, or the checkout path moved | `journalctl -u skkuverse-firewall -b`. The host is open (fail-open) until fixed |
| Cloudflare 522/52x for some users only | A Cloudflare range missing from the list | [Refresh](#refresh-after-cloudflare-changes-its-ranges); `--undo` meanwhile if it is widespread |
| A real host name returns no response (curl: "Empty reply from server") | It fell to the catch-all: no site has that `server_name` | Add the name to its site; the catch-all's access log lines show status 444 |
| Deploy aborts with "nginx rejected the new config" | `nginx -t` failed; the previous config was restored | Run `sudo nginx -t` on the host for the error |

## Related

- [monitor-production.md](monitor-production.md) — the alerts to watch while applying, and adding a host to them
- [docs/README.md](../README.md) — writing rules
- `infra/nginx/api.skkuverse.com` header — the client-IP contract the real-IP snippet is half of

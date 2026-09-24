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
| Host firewall | A TCP connection to 80/443 from any address outside Cloudflare's ranges is rejected | [infra/firewall/cloudflare-only.sh](../../infra/firewall/cloudflare-only.sh), run at boot by [skkuverse-firewall.service](../../infra/firewall/skkuverse-firewall.service), on top of the shared `INPUT` chain in [infra/firewall/baseline-rules.v4](../../infra/firewall/baseline-rules.v4) | **By hand, once per host** (below); the deploy only installs the unit |

Both depend on one list of Cloudflare ranges:

| File | Role |
| --- | --- |
| [infra/cloudflare/ips-v4.txt](../../infra/cloudflare/ips-v4.txt), [ips-v6.txt](../../infra/cloudflare/ips-v6.txt) | The single source of truth, verbatim from `https://www.cloudflare.com/ips-v4` and `/ips-v6` |
| [infra/nginx/cloudflare-realip.conf](../../infra/nginx/cloudflare-realip.conf) | Generated from the lists by `npm run cloudflare-ips`; the ranges nginx trusts `CF-Connecting-IP` from. `npm test` fails when it is stale |
| [.github/workflows/cloudflare-ips.yml](../../.github/workflows/cloudflare-ips.yml) | Weekly comparison with cloudflare.com; a red run is the drift alert |

Design choices worth knowing before touching any of it:

- **The firewall is iptables on the host, not the OCI security list.** The security list cannot be versioned from here (no OCI CLI), and the rented Naver host has a different one. iptables is already the filter that decides, so one script covers every host.
- **`/etc/iptables/rules.v4` is never rewritten by the lock.** It still holds the open 80/443 rules; the unit re-applies the lock after `netfilter-persistent` loads it at boot. Never run `netfilter-persistent save`: it would freeze Docker's chains and fail2ban's current bans into the file. A new host gets the file once, as a copy of `baseline-rules.v4` ([Onboard another origin host](#onboard-another-origin-host)).
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

For example the rented Naver server (`ssh mnemosyne`). Every origin runs the same compose file, nginx site and firewall, and takes an equal share of traffic from the Cloudflare load balancer ([decisions/0009](../decisions/0009-multi-origin-active-active.md)). The one difference is the poller: exactly one host runs it (`POLLER_ROLE=active`), every other host is `standby` ([fail-over-poller.md](fail-over-poller.md)). In order, before the load balancer sends the host any traffic:

1. **Login and checkout.** The deploy, the heartbeat cron and the firewall unit all assume user `ubuntu` and the checkout `/home/ubuntu/skkumap-server-express` (`DEPLOY_PATH` in [deploy-host.yml](../../.github/workflows/deploy-host.yml); a test keeps the three in step). Create `ubuntu` with passwordless `sudo` and membership of the `docker` group, install the deploy key's public half in its `authorized_keys`, and clone the repo there as `ubuntu`, on `main`. Turn SSH password login off, and check the clock is synchronised (`timedatectl` shows `System clock synchronized: yes`): Atlas TLS and the bus timestamps both depend on it.
2. **Docker network.** `docker network create skkuverse`. The compose file joins it as `external`, so compose will not create it.
3. **Host role.** The deploy and the heartbeat both refuse to run without it:

   ```bash
   sudo install -d -m 0755 /etc/skkuverse
   echo 'POLLER_ROLE=standby' | sudo tee /etc/skkuverse/host.env
   sudo chmod 0644 /etc/skkuverse/host.env
   ```

   Exactly one line, no quotes, no spaces. Only the host that runs the poller says `active`.
4. **Baseline firewall.** A fresh image may have an empty `INPUT` chain (policy ACCEPT), which `cloudflare-only.sh` refuses to lock, because removing its ACCEPTs would block nothing. Give it the shared shape, live, one `iptables -A` at a time — never `iptables-restore`, which would flush Docker's chains:

   ```bash
   cd /home/ubuntu/skkumap-server-express
   sudo iptables -S INPUT                                   # empty, or only fail2ban's jumps
   sudo infra/firewall/apply-baseline.sh --dry-run
   sudo infra/firewall/apply-baseline.sh
   echo 'iptables-persistent iptables-persistent/autosave_v4 boolean false' | sudo debconf-set-selections
   echo 'iptables-persistent iptables-persistent/autosave_v6 boolean false' | sudo debconf-set-selections
   sudo apt-get install -y iptables-persistent               # do NOT save the current rules
   sudo infra/firewall/apply-baseline.sh --persist           # rules.v4 = baseline-rules.v4
   ```

   The script refuses (and prints the chain) if `INPUT` holds anything other than the baseline or a prefix of it. `--persist` writes the repo's file, not the live ruleset, and keeps any previous `rules.v4` as a `.bak`.
5. **nginx, after the firewall.** Install it (`sudo apt-get install -y nginx`) only once the baseline is in place, then remove the distro's default site, which would clash with the catch-all's `default_server`: `sudo rm /etc/nginx/sites-enabled/default`. The deploy installs the real-IP snippet, the `api.skkuverse.com` site and the catch-all (generating its certificate) and runs `nginx -t`.
6. **Secrets on the host.** Copy the OCI host's `.env` into the checkout without leaving a copy on the Mac (`ssh oracle 'cat …/.env' | ssh mnemosyne 'umask 077; cat > …/.env'`, then `chmod 0600`), and the Cloudflare Origin CA certificate and key to `/etc/ssl/cloudflare/skkuverse-origin.pem` and `skkuverse-origin-key.pem` (key `0600`). The nginx site names both paths; without them the deploy's `nginx -t` fails and the deploy aborts.
7. **Atlas access list.** Add the host's public IP in Atlas → Network Access, then check from the host that a TLS handshake to the cluster completes, for example with a throwaway `docker compose run --rm --no-deps -T api-1 node -e "require('./dist/src/infra/db').ping().then(() => { console.log('db ok'); process.exit(0); }, (e) => { console.error(e.message); process.exit(1); })"` after the first build.
8. **Provider security group** (OCI security list, Naver ACG). A separate layer in front of the host: allow 443 from Cloudflare's ranges and 22 for SSH. Port 80 is not needed (Cloudflare connects to the origin over HTTPS).
9. **Deploy job and secrets.** Add a job for the host at the end of the chain in [deploy.yml](../../.github/workflows/deploy.yml) (it `needs` the job before it) and create its GitHub secrets: `<HOST>_VM_HOST`, `<HOST>_VM_USER` (`ubuntu`) and `<HOST>_SSH_PRIVATE_KEY`. An empty secret fails that host's job before it connects. The first run after merge deploys the api replicas (a standby host never starts the poller).
10. **Lock the firewall.** On the host, with the replicas up: [Apply the firewall](#apply-the-firewall-one-time-per-host) — back up, `--dry-run`, apply, `systemctl enable --now skkuverse-firewall`, verify.
11. **Heartbeat.** Create the host's Healthchecks.io check (named by provider and region, 1-minute period, a few minutes' grace, Discord integration on) and write `/etc/skkuverse/heartbeat.env` — [monitor-production.md](monitor-production.md#add-a-host-to-the-heartbeat). The deploy has already installed the cron file; a standby host is checked for its replicas and for *not* running the poller.
12. **Check it alone**, before it takes traffic: from a Mac, `curl -skm 5 https://<host-ip>/` does not connect (the security group drops it, or the firewall rejects it); on the host, `curl -sk --resolve api.skkuverse.com:443:127.0.0.1 https://api.skkuverse.com/health/ready` returns 200 with an `X-Served-By` header naming the host; `infra/monitoring/heartbeat.sh` prints `ok`.
13. **Load balancer.** Add the host as an endpoint of the `api-origins` pool with a low weight and raise it in steps while watching nginx 5xx, the heartbeat and Atlas ops ([decisions/0009](../decisions/0009-multi-origin-active-active.md)). `X-Served-By` on responses through Cloudflare shows the split.
14. **Refresh duty.** From now on, [Refresh after Cloudflare changes its ranges](#refresh-after-cloudflare-changes-its-ranges) includes this host: the deploy installs its snippet, and its firewall unit needs the restart.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The script exits 1 before changing anything | The list is empty or malformed, `INPUT` does not end in a REJECT/DROP, or `INPUT` has a 80/443 ACCEPT it does not recognise | Read the message; fix the list or the host's rules. Nothing was changed |
| `skkuverse-firewall` is `failed` after a reboot | Same as above, or the checkout path moved | `journalctl -u skkuverse-firewall -b`. The host is open (fail-open) until fixed |
| Cloudflare 522/52x for some users only | A Cloudflare range missing from the list | [Refresh](#refresh-after-cloudflare-changes-its-ranges); `--undo` meanwhile if it is widespread |
| A real host name returns no response (curl: "Empty reply from server") | It fell to the catch-all: no site has that `server_name` | Add the name to its site; the catch-all's access log lines show status 444 |
| Deploy aborts with "nginx rejected the new config" | `nginx -t` failed; the previous config was restored | Run `sudo nginx -t` on the host for the error. On a new host: the distro's `default` site is still enabled (duplicate `default_server`), or the origin certificate is missing |
| `apply-baseline.sh` exits 1 and prints the chain | `INPUT` holds rules that are neither the baseline nor a prefix of it, or its policy is not ACCEPT | Nothing was changed. Decide by hand whether those rules can go; the script never merges |
| Deploy aborts with "no valid POLLER_ROLE" | `/etc/skkuverse/host.env` is missing or malformed on that host | Write it ([step 3](#onboard-another-origin-host)); nothing on the host was changed |

## Related

- [monitor-production.md](monitor-production.md) — the alerts to watch while applying, and adding a host to them
- [fail-over-poller.md](fail-over-poller.md) — moving the poller between hosts
- [decisions/0009](../decisions/0009-multi-origin-active-active.md) — why several origins behind Cloudflare Load Balancing
- [docs/README.md](../README.md) — writing rules
- `infra/nginx/api.skkuverse.com` header — the client-IP contract the real-IP snippet is half of

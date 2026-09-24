#!/usr/bin/env bash
# Per-host heartbeat for Healthchecks.io — the inside-out half of monitoring
# (docs/how-to/monitor-production.md). Cron runs it every minute
# (skkuverse-heartbeat.cron). It checks this host, then either pings
# HC_PING_URL or posts what is wrong to HC_PING_URL/fail.
#
# The alert that matters most is the one this script cannot send: when the
# host, Docker or cron is down, no ping arrives and Healthchecks.io raises
# "down" once the grace period runs out. So every problem with the script's
# own setup (no env file, no ping URL) exits non-zero WITHOUT pinging — a
# silent fallback would hide exactly the failure this exists to catch.
#
# Checks:
#   1. every service in this repo's docker-compose.yml has exactly one
#      container, running, and not `unhealthy` (`starting` passes: a rolling
#      deploy restarts each replica, and the healthcheck is what finishes it);
#   2. nginx serves /health/ready for api.skkuverse.com on this host, which
#      exercises nginx, the upstream pool and a replica's DB ping in one go;
#   3. no other container on the host (crawler, AI, OTA) is restarting or
#      unhealthy. `exited` is ignored — that is a deliberate stop.
# A failed round is re-checked once after HEARTBEAT_RECHECK_DELAY seconds, so
# the moment a deploy recreates a container does not page anyone.
#
# Written for bash 3.2 as well as 5 (tests run it on macOS).
set -euo pipefail

ENV_FILE="${HEARTBEAT_ENV_FILE:-/etc/skkuverse/heartbeat.env}"
RECHECK_DELAY="${HEARTBEAT_RECHECK_DELAY:-15}"
COMPOSE_FILE="$(cd "$(dirname "$0")/../.." && pwd)/docker-compose.yml"
HOST="$(hostname)"

if [ ! -r "$ENV_FILE" ]; then
  echo "heartbeat: cannot read $ENV_FILE — not pinging" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$ENV_FILE"
if [ -z "${HC_PING_URL:-}" ]; then
  echo "heartbeat: HC_PING_URL is not set in $ENV_FILE — not pinging" >&2
  exit 1
fi

failures=""
fail() { failures="${failures}- $1"$'\n'; }

check_compose() {
  local services ps_out own_project="" svc
  local project service state health count seen_state seen_health
  if ! services="$(docker compose -f "$COMPOSE_FILE" config --services)"; then
    fail "docker compose config failed"
    return
  fi
  if [ -z "$services" ]; then
    fail "docker compose config listed no services"
    return
  fi
  if ! ps_out="$(docker compose -f "$COMPOSE_FILE" ps -a \
    --format '{{.Project}}|{{.Service}}|{{.State}}|{{.Health}}')"; then
    fail "docker compose ps failed"
    return
  fi
  for svc in $services; do
    count=0
    seen_state=""
    seen_health=""
    while IFS='|' read -r project service state health; do
      if [ "$service" = "$svc" ]; then
        count=$((count + 1))
        seen_state="$state"
        seen_health="$health"
        own_project="$project"
      fi
    done <<< "$ps_out"
    if [ "$count" -eq 0 ]; then
      fail "$svc: no container"
    elif [ "$count" -gt 1 ]; then
      fail "$svc: $count containers, expected 1"
    elif [ "$seen_state" != "running" ]; then
      fail "$svc: $seen_state"
    elif [ "$seen_health" = "unhealthy" ]; then
      fail "$svc: unhealthy"
    fi
  done
  OWN_PROJECT="$own_project"
}

check_nginx() {
  local err
  # -k: the origin serves a Cloudflare Origin CA certificate, which no system
  # trust store holds. Certificate validity is what the outside-in monitor
  # sees through the edge; this probe is about nginx and the upstreams.
  if ! err="$(curl -fsS -k -m 5 -o /dev/null \
    --resolve api.skkuverse.com:443:127.0.0.1 \
    https://api.skkuverse.com/health/ready 2>&1)"; then
    fail "nginx /health/ready: ${err%%$'\n'*}"
  fi
}

check_other_containers() {
  local out name state status project
  if ! out="$(docker ps -a \
    --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Label "com.docker.compose.project"}}')"; then
    fail "docker ps failed"
    return
  fi
  while IFS='|' read -r name state status project; do
    if [ -z "$name" ] || { [ -n "$OWN_PROJECT" ] && [ "$project" = "$OWN_PROJECT" ]; }; then
      continue
    fi
    if [ "$state" = "restarting" ]; then
      fail "$name: restarting"
    else
      case "$status" in
        *"(unhealthy)"*) fail "$name: unhealthy" ;;
      esac
    fi
  done <<< "$out"
}

run_checks() {
  failures=""
  OWN_PROJECT=""
  check_compose
  check_nginx
  check_other_containers
}

run_checks
if [ -n "$failures" ]; then
  sleep "$RECHECK_DELAY"
  run_checks
fi

if [ -z "$failures" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$HC_PING_URL"
  echo "ok"
  exit 0
fi

body="$HOST: heartbeat failed"$'\n'"$failures"
printf '%s' "$body"
curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$body" "$HC_PING_URL/fail" || true
exit 1

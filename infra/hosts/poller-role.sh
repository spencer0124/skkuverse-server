#!/usr/bin/env bash
# Print this host's poller role, `active` or `standby`, from the host role
# file /etc/skkuverse/host.env. The file lives outside the repo, one per host:
#
#   POLLER_ROLE=active     this host runs the poller (exactly one host does)
#   POLLER_ROLE=standby    this host runs the api replicas only
#
# Every api replica on every host serves bus data from the shared Mongo
# `bus_cache`, so one poller is enough for all of them, and two would poll the
# external APIs twice. The role says which host that is. Moving the poller is
# docs/how-to/fail-over-poller.md.
#
# Readers: the deploy workflow (.github/workflows/deploy-host.yml) and the
# heartbeat (infra/monitoring/heartbeat.sh). There is no default: a missing
# file, a missing or repeated POLLER_ROLE line, or any other value exits 1
# with the reason on stderr, and both readers stop there. Guessing a role
# would either start a second poller or leave none running, silently.
#
# The file is parsed, never sourced. Other lines (comments, future keys) are
# ignored; the POLLER_ROLE line itself must be exact — no quotes, no spaces.
#
# HOST_ENV_FILE overrides the path (tests). Must stay bash 3.2 compatible
# (the tests run on macOS too).
set -euo pipefail

FILE=${HOST_ENV_FILE:-/etc/skkuverse/host.env}

die() {
  echo "poller-role: $*" >&2
  exit 1
}

[ -r "$FILE" ] || die "cannot read $FILE; it must contain POLLER_ROLE=active or POLLER_ROLE=standby"

n=$(grep -c '^POLLER_ROLE=' "$FILE" || true)
[ "$n" = 1 ] || die "$FILE must set POLLER_ROLE exactly once (found $n)"

role=$(sed -n 's/^POLLER_ROLE=//p' "$FILE")
case $role in
  active | standby) printf '%s\n' "$role" ;;
  *) die "$FILE: POLLER_ROLE must be active or standby, not '$role'" ;;
esac

#!/usr/bin/env bash
# Give a fresh origin host the shared INPUT chain from baseline-rules.v4 —
# accept replies, ICMP, loopback, SSH and 80/443, reject the rest — on the
# live host, without touching anything else.
#
# It appends the file's INPUT rules one at a time with `iptables -A`, in file
# order. Never `iptables-restore`: on a host where Docker runs, that would
# flush Docker's chains along with everything else. The order is what makes
# appending safe over SSH: the ESTABLISHED/RELATED accept goes in first, so
# the session running this is never cut, and the final REJECT goes in last,
# after the SSH accept.
#
#   apply-baseline.sh             append whatever of the baseline is missing
#   apply-baseline.sh --dry-run   print the commands, change nothing
#   apply-baseline.sh --persist   also install baseline-rules.v4 as
#                                 /etc/iptables/rules.v4 (the old file is
#                                 kept as rules.v4.bak.<time>)
#
# What it accepts in INPUT, ignoring fail2ban's `-j f2b-*` jumps (fail2ban
# inserts and removes those itself):
#   - nothing, or the first N baseline rules (an interrupted run): appends
#     the rest;
#   - the whole baseline, or the baseline locked by cloudflare-only.sh (its
#     jump in place of the 80/443 accepts): nothing to do.
# Anything else — another rule, another order, an INPUT policy other than
# ACCEPT — and it refuses (exit 1) before changing anything, printing what
# INPUT holds. Merging into an unknown chain is a person's call.
#
# Persistence: --persist writes the repo's file, never the live ruleset. Do
# not use `netfilter-persistent save` (or answer "yes" to the save prompt
# when installing iptables-persistent): that would freeze Docker's chains
# and fail2ban's bans into rules.v4.
#
# IPv4 only, like cloudflare-only.sh. Runbook: "Onboard another origin host"
# in docs/how-to/lock-origin-to-cloudflare.md. Tests with a stub iptables:
# __tests__/nest/infra/firewall.test.ts. Must stay bash 3.2 compatible.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RULES_FILE=${BASELINE_RULES_FILE:-$SCRIPT_DIR/baseline-rules.v4}
PERSIST_PATH=${BASELINE_PERSIST_PATH:-/etc/iptables/rules.v4}

# As cloudflare-only.sh writes them (and `iptables -S` prints them).
OPEN_443='-p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT'
OPEN_80='-p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT'
CF_JUMP='-p tcp -m state --state NEW -m multiport --dports 80,443 -j SKKUVERSE-CF'

DRY_RUN=0
PERSIST=0
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=1 ;;
    --persist) PERSIST=1 ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "apply-baseline: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

die() {
  echo "apply-baseline: $*" >&2
  exit 1
}

ipt() { iptables -w "$@"; }

# Every change goes through here, so --dry-run prints exactly what a real run
# would execute.
# shellcheck disable=SC2048,SC2086
run() {
  echo "+ $*"
  if [ "$DRY_RUN" = 0 ]; then
    "$@"
  fi
}

# The baseline's INPUT rules, one spec per line, in file order.
baseline_specs() {
  sed -n 's/^-A INPUT //p' "$RULES_FILE"
}

# The baseline as cloudflare-only.sh leaves it: its jump where the 80/443
# accepts were.
locked_specs() {
  local spec
  baseline_specs | while IFS= read -r spec; do
    if [ "$spec" = "$OPEN_443" ]; then
      printf '%s\n' "$CF_JUMP"
    elif [ "$spec" != "$OPEN_80" ]; then
      printf '%s\n' "$spec"
    fi
  done
}

# INPUT's rules now, in order, without fail2ban's jumps.
current_specs() {
  ipt -S INPUT | sed -n 's/^-A INPUT //p' | { grep -v -- ' -j f2b-' || true; }
}

refuse() {
  {
    echo "apply-baseline: $1; refusing to change INPUT. It holds:"
    ipt -S INPUT | sed 's/^/  /'
    echo "The baseline ($RULES_FILE) is:"
    baseline_specs | sed 's/^/  -A INPUT /'
  } >&2
  exit 1
}

apply_live() {
  local policy current baseline n_cur prefix spec
  policy=$(ipt -S INPUT | sed -n 's/^-P INPUT //p') || die "cannot read the INPUT chain (run as root)"
  [ "$policy" = ACCEPT ] || refuse "the INPUT policy is '$policy', not ACCEPT"

  current=$(current_specs)
  baseline=$(baseline_specs)

  if [ "$current" = "$baseline" ]; then
    echo "apply-baseline: INPUT already has the baseline"
    return
  fi
  if [ "$current" = "$(locked_specs)" ]; then
    echo "apply-baseline: INPUT already has the baseline, locked to Cloudflare by cloudflare-only.sh"
    return
  fi

  # Is what is there the start of the baseline?
  # (BSD head rejects -n 0, hence the guard.)
  n_cur=0
  prefix=""
  if [ -n "$current" ]; then
    n_cur=$(printf '%s\n' "$current" | wc -l | tr -d ' ')
    prefix=$(printf '%s\n' "$baseline" | head -n "$n_cur")
  fi
  [ "$current" = "$prefix" ] || refuse "INPUT has rules that are not the baseline"

  # Append the rest, in order.
  # shellcheck disable=SC2086
  printf '%s\n' "$baseline" | tail -n +"$((n_cur + 1))" | while IFS= read -r spec; do
    run iptables -w -A INPUT $spec
  done

  [ "$DRY_RUN" = 1 ] && return
  [ "$(current_specs)" = "$baseline" ] || die "verify: INPUT does not match the baseline after applying"
  printf '%s\n' "$baseline" | while IFS= read -r spec; do
    # shellcheck disable=SC2086
    ipt -C INPUT $spec > /dev/null 2>&1 || die "verify: INPUT is missing: $spec"
  done
  echo "apply-baseline: INPUT now has the baseline"
}

persist() {
  if [ -f "$PERSIST_PATH" ] && cmp -s "$RULES_FILE" "$PERSIST_PATH"; then
    echo "apply-baseline: $PERSIST_PATH already is the baseline"
    return
  fi
  if [ -f "$PERSIST_PATH" ]; then
    run cp -p "$PERSIST_PATH" "$PERSIST_PATH.bak.$(date +%s)"
  fi
  run install -m 0644 "$RULES_FILE" "$PERSIST_PATH"
}

[ -r "$RULES_FILE" ] || die "cannot read $RULES_FILE"
[ -n "$(baseline_specs)" ] || die "$RULES_FILE has no INPUT rules"
command -v iptables > /dev/null 2>&1 || die "iptables not found"
# Checked before INPUT changes, so a failed --persist leaves nothing half-done.
if [ "$PERSIST" = 1 ] && [ ! -d "$(dirname "$PERSIST_PATH")" ]; then
  die "$(dirname "$PERSIST_PATH") does not exist; install iptables-persistent first (answer No to saving the current rules)"
fi

apply_live
if [ "$PERSIST" = 1 ]; then persist; fi

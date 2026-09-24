#!/usr/bin/env bash
# Accept HTTP(S) on this host only from Cloudflare's edge (IPv4).
#
# Every public host name is proxied by Cloudflare, so a connection to 80/443
# from anywhere else is a scanner or someone bypassing Cloudflare's cache,
# rate limiting and TLS. This script swaps the host's open rules
#
#   -A INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
#   -A INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
#
# for a jump to the SKKUVERSE-CF chain, which accepts 80/443 only from the
# ranges in infra/cloudflare/ips-v4.txt. Everything else falls through to the
# REJECT that already ends INPUT. It touches nothing else: not port 22, not
# fail2ban's chain, not Docker's.
#
#   cloudflare-only.sh            apply, or refresh after the list changed
#   cloudflare-only.sh --undo     put the open 80/443 rules back, drop the chain
#   cloudflare-only.sh --dry-run  print the iptables commands, change nothing
#                                 (combine with --undo to preview an undo)
#
# Order is what makes it safe to run on a live host: new ACCEPTs go in before
# old ones come out, so no Cloudflare connection is ever rejected mid-change.
# Apply builds the chain, then inserts the jump above the open rules, then
# deletes them. A refresh adds new ranges before deleting dropped ones. Undo
# reinserts the open rules above the jump before deleting it.
#
# Idempotent: a second run finds nothing to do. It refuses to run (exit 1,
# before changing anything) when the list is empty or malformed, when INPUT
# does not end in a REJECT/DROP (removing ACCEPTs would then block nothing),
# or when INPUT holds a 80/443 ACCEPT it does not recognise (it would stay
# open and the lock would be a lie).
#
# IPv4 only. The hosts this runs on have no IPv6 address and nginx listens
# on IPv4 only; the script warns if that stops being true.
#
# Persistence: rules.v4 is never written (`netfilter-persistent save` would
# also freeze Docker's chains and fail2ban's bans into it). Instead
# skkuverse-firewall.service runs this at boot, after netfilter-persistent
# has loaded rules.v4. If it fails, the open rules from rules.v4 stay: the
# host fails open, which beats failing closed during an event.
#
# Runbook: docs/how-to/lock-origin-to-cloudflare.md. Tests with a stub
# iptables: __tests__/nest/infra/firewall.test.ts. Must stay bash 3.2
# compatible (the tests run on macOS too).
set -euo pipefail

CHAIN=SKKUVERSE-CF
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
IPS_FILE=${CF_IPS_V4_FILE:-$SCRIPT_DIR/../cloudflare/ips-v4.txt}

# Rule specs exactly as `iptables -S` prints them, so that counting lines of
# its output and `-D` by spec address the same rules.
OPEN_443='-p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT'
OPEN_80='-p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT'
JUMP="-p tcp -m state --state NEW -m multiport --dports 80,443 -j $CHAIN"
range_rule() { printf '%s' "-s $1 -p tcp -m multiport --dports 80,443 -j ACCEPT"; }

MODE=apply
DRY_RUN=0
for arg in "$@"; do
  case $arg in
    --undo) MODE=undo ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "cloudflare-only: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

die() {
  echo "cloudflare-only: $*" >&2
  exit 1
}

# Read-only queries. `-C` answers with its exit status; iptables-nft 1.8.7
# also prints the matched rule, so callers silence stdout too.
ipt() { iptables -w "$@"; }

# Every change goes through here, so --dry-run prints exactly what a real run
# would execute.
# shellcheck disable=SC2048,SC2086
run() {
  echo "+ iptables -w $*"
  if [ "$DRY_RUN" = 0 ]; then
    iptables -w $*
  fi
}

# INPUT's rules, one spec per line, in rule-number order.
input_specs() {
  ipt -S INPUT | sed -n 's/^-A INPUT //p'
}

# How many INPUT rules are exactly this spec.
count_input() {
  input_specs | grep -cxF -- "$1" || true
}

# Rule number of the first INPUT rule that is exactly one of the specs.
position_of() {
  local args=() spec
  for spec in "$@"; do args+=(-e "$spec"); done
  { input_specs | grep -nxF "${args[@]}" || true; } | head -n 1 | cut -d: -f1
}

chain_exists() { ipt -S "$CHAIN" > /dev/null 2>&1; }

# 0-255, no leading zeros (bash arithmetic would read 010 as octal).
OCTET='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'

# An IPv4 CIDR with no host bits set. iptables clears host bits when it stores
# a rule, so a range like 1.2.3.4/24 would never read back as written and the
# stale-rule pass below would churn it on every run.
valid_cidr() {
  printf '%s\n' "$1" | grep -Eqx "$OCTET(\\.$OCTET){3}/([89]|[12][0-9]|3[0-2])" || return 1
  local addr=${1%/*} bits=${1#*/} a b c d
  IFS=. read -r a b c d <<< "$addr"
  local ip=$(((a << 24) | (b << 16) | (c << 8) | d))
  [ $((ip & ((1 << (32 - bits)) - 1))) -eq 0 ]
}

RANGES=""
read_ranges() {
  [ -r "$IPS_FILE" ] || die "cannot read $IPS_FILE"
  local line n=0
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d ' \t\r')
    [ -n "$line" ] || continue
    valid_cidr "$line" || die "$IPS_FILE: not an aligned IPv4 CIDR (/8-/32): '$line'"
    case " $RANGES " in *" $line "*) die "$IPS_FILE: duplicate range $line" ;; esac
    RANGES="$RANGES $line"
    n=$((n + 1))
  done < "$IPS_FILE"
  [ "$n" -gt 0 ] || die "$IPS_FILE has no ranges; refusing to lock 80/443 to nobody"
}

# Structural checks on INPUT, before anything changes.
check_input() {
  local specs last unknown
  specs=$(input_specs) || die "cannot read the INPUT chain (run as root)"
  last=$(printf '%s\n' "$specs" | tail -n 1)
  case $last in
    "-j REJECT"* | "-j DROP") ;;
    *) die "INPUT does not end in an unconditional REJECT/DROP (last rule: '$last'); removing the open rules would block nothing" ;;
  esac
  # Any other rule that accepts 80 or 443 from everywhere would keep the port
  # open behind our back. Rules with a source (-s) are someone's allowlist and
  # are left alone.
  unknown=$(printf '%s\n' "$specs" |
    grep -E -- '-j ACCEPT$' |
    grep -E -- '--dports? ([0-9:]+,)*(80|443)(,[0-9:]+)*( |$)' |
    grep -vE -- '(^| )-s ' |
    grep -vxF -e "$OPEN_443" -e "$OPEN_80" || true)
  [ -z "$unknown" ] || die "INPUT has an 80/443 ACCEPT this script does not know; fix it by hand first: $unknown"
}

warn_ipv6() {
  if command -v ip > /dev/null 2>&1 && ip -6 addr show scope global 2> /dev/null | grep -q inet6; then
    echo "cloudflare-only: WARNING: this host has a global IPv6 address, and this script locks IPv4 only. Check ip6tables." >&2
  fi
}

apply() {
  read_ranges
  check_input
  warn_ipv6

  chain_exists || run -N "$CHAIN"

  # Add first. -C asks iptables itself, so a rule is found however it prints.
  local r
  for r in $RANGES; do
    ipt -C "$CHAIN" $(range_rule "$r") > /dev/null 2>&1 || run -A "$CHAIN" $(range_rule "$r")
  done

  # Then drop rules for ranges no longer listed. Keyed on the source address
  # alone: a formatting difference must never make a live range look stale.
  local spec src
  # (Under --dry-run on a fresh host the chain does not exist yet.)
  { ipt -S "$CHAIN" 2> /dev/null || true; } | sed -n "s/^-A $CHAIN //p" | while IFS= read -r spec; do
    src=$(printf '%s\n' "$spec" | sed -n 's/^\(.* \)\{0,1\}-s \([^ ]*\).*/\2/p')
    case " $RANGES " in *" ${src:-none} "*) continue ;; esac
    run -D "$CHAIN" $spec
  done

  # Jump in where the open rules are (above them), or just above the final
  # REJECT if they are already gone.
  if ! ipt -C INPUT $JUMP > /dev/null 2>&1; then
    local pos
    pos=$(position_of "$OPEN_443" "$OPEN_80")
    [ -n "$pos" ] || pos=$(input_specs | wc -l | tr -d ' ')
    run -I INPUT "$pos" $JUMP
  fi

  # Only now close the open rules, every copy of them.
  local open i n
  for open in "$OPEN_443" "$OPEN_80"; do
    n=$(count_input "$open")
    i=0
    while [ "$i" -lt "$n" ]; do
      run -D INPUT $open
      i=$((i + 1))
    done
  done

  n=$(count_input "$JUMP")
  while [ "$n" -gt 1 ]; do
    run -D INPUT $JUMP
    n=$((n - 1))
  done

  [ "$DRY_RUN" = 1 ] || verify_applied
}

verify_applied() {
  ipt -C INPUT $JUMP > /dev/null 2>&1 || die "verify: the jump to $CHAIN is missing from INPUT"
  [ "$(count_input "$OPEN_443")" = 0 ] || die "verify: INPUT still accepts 443 from everywhere"
  [ "$(count_input "$OPEN_80")" = 0 ] || die "verify: INPUT still accepts 80 from everywhere"
  local r
  for r in $RANGES; do
    ipt -C "$CHAIN" $(range_rule "$r") > /dev/null 2>&1 || die "verify: $CHAIN is missing $r"
  done
  echo "cloudflare-only: 80/443 accepted only from $(echo $RANGES | wc -w | tr -d ' ') Cloudflare ranges"
}

undo() {
  input_specs > /dev/null || die "cannot read the INPUT chain (run as root)"

  # Reopen first, above the jump (or the final rule, or at the end), so the
  # ports are never closed to everyone in between.
  local pos open
  pos=$(position_of "$JUMP")
  if [ -z "$pos" ]; then
    case $(input_specs | tail -n 1) in
      "-j REJECT"* | "-j DROP") pos=$(input_specs | wc -l | tr -d ' ') ;;
    esac
  fi
  for open in "$OPEN_443" "$OPEN_80"; do
    ipt -C INPUT $open > /dev/null 2>&1 && continue
    if [ -n "$pos" ] && [ "$pos" -gt 0 ]; then
      run -I INPUT "$pos" $open
      pos=$((pos + 1))
    else
      run -A INPUT $open
    fi
  done

  local n
  n=$(count_input "$JUMP")
  while [ "$n" -gt 0 ]; do
    run -D INPUT $JUMP
    n=$((n - 1))
  done

  if chain_exists; then
    run -F "$CHAIN"
    run -X "$CHAIN"
  fi
  [ "$DRY_RUN" = 1 ] || echo "cloudflare-only: 80/443 open to everyone again"
}

command -v iptables > /dev/null 2>&1 || die "iptables not found"
if [ "$MODE" = undo ]; then undo; else apply; fi

#!/bin/zsh
# Waits until Google Play has stopped updating apps on the emulator, so no update lands mid-test
# (shyden-labs/playwright-devices#45; Shyden's choice 2026-11-22: wait for updates, not turn them off).
# Chrome died 2-6 s after Play services updated itself, in runs 45027508984 and 45037655845.
#
# Play says nowhere that it has finished, so this waits until no package's lastUpdateTime has
# changed for QUIET_S, and fails at CEILING_S naming the packages still changing. Each change is
# written to <evidence>, with the seconds since this started, to tune both figures.
#
#   wait-for-play-updates.zsh <serial> <evidence-file>
#   wait-for-play-updates.zsh --list <serial>     prints "<package> <lastUpdateTime>" for every package
set -uo pipefail

list_only=0
if [[ ${1:-} == --list ]]; then list_only=1; shift; fi

serial=${1:?usage: wait-for-play-updates.zsh [--list] <serial> [<evidence-file>]}
QUIET_S=120
CEILING_S=600
POLL_S=15

# "<package> <lastUpdateTime>" for every package, sorted.
snapshot() {
  adb -s $serial shell dumpsys package packages |
    awk '/^  Package \[/ { name = substr($2, 2, length($2) - 2) } /lastUpdateTime=/ { sub(/^ *lastUpdateTime=/, ""); print name, $0 }' |
    sort
}

if (( list_only )); then snapshot; exit; fi
evidence=${2:?usage: wait-for-play-updates.zsh <serial> <evidence-file>}

start=$SECONDS
previous=$(snapshot)
quiet_since=$SECONDS
print "waiting for Play updates: quiet ${QUIET_S} s, ceiling ${CEILING_S} s" >$evidence
while (( SECONDS - quiet_since < QUIET_S )); do
  if (( SECONDS - start >= CEILING_S )); then
    print "Play was still updating after ${CEILING_S} s; last changes:" | tee -a $evidence >&2
    tail -5 $evidence >&2
    exit 1
  fi
  sleep $POLL_S
  current=$(snapshot)
  if [[ $current != $previous ]]; then
    diff <(print -r -- $previous) <(print -r -- $current) | grep '^>' | sed "s/^>/+$(( SECONDS - start )) s updated:/" >>$evidence
    previous=$current
    quiet_since=$SECONDS
  fi
done
print "quiet for ${QUIET_S} s after $(( SECONDS - start )) s" | tee -a $evidence

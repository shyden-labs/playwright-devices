#!/bin/zsh
# Takes a fresh emulator's Chrome through its first-run screens once, with real taps, as a person
# would on a new phone (shyden-labs/playwright-devices#38). Until then Chrome shows FirstRunActivity
# instead of a page and opens no DevTools socket (devices-sim run 44884591897).
#
#   finish-chrome-first-run.zsh <serial>
set -euo pipefail

serial=${1:?usage: finish-chrome-first-run.zsh <serial>}
dump=$(mktemp)
# The buttons that move each first-run screen on, by their text, declining sign-in and extras.
buttons=('Use without an account' 'Accept & continue' 'No thanks' 'Got it' 'Continue' 'Skip')

front() { adb -s $serial shell dumpsys activity activities | grep -m1 topResumedActivity || true; }

adb -s $serial shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d about:blank >/dev/null
for _ in {1..30}; do
  sleep 2
  current=$(front)
  if [[ $current == *com.android.chrome/* && $current != *FirstRunActivity* ]]; then
    print "finish-chrome-first-run: Chrome is past its first run ($current)"
    adb -s $serial shell am force-stop com.android.chrome
    exit 0
  fi
  adb -s $serial exec-out uiautomator dump /dev/tty >$dump 2>/dev/null || continue
  for label in $buttons; do
    # The node's bounds, "[x1,y1][x2,y2]", for the first node whose text is the label.
    bounds=$(grep -o "text=\"$label\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" $dump | head -1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' || true)
    [[ -n $bounds ]] || continue
    nums=(${(s:,:)${${bounds//\]\[/,}//[\[\]]/}})
    x=$(( (nums[1] + nums[3]) / 2 )) y=$(( (nums[2] + nums[4]) / 2 ))
    print "finish-chrome-first-run: tapping \"$label\" at $x,$y"
    adb -s $serial shell input tap $x $y
    break
  done
done
print -u2 "finish-chrome-first-run: Chrome still on its first run after 60 s; in front: $(front)"
grep -o 'text="[^"]*"' $dump | sort -u | head -20 >&2
exit 1

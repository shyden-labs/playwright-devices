#!/bin/zsh
# Measure Chrome's cold start on an Android phone, the way the android-cdp route starts it
# (research/devices/device-fixture.ts, launchChromeCold): force-stop, start on about:blank, then
# time (a) until @chrome_devtools_remote appears in /proc/net/unix and (b) until a DevTools HTTP
# request through the adb forward is first answered. Also records whether the request sent the
# moment the socket appears is answered, which is what the fixture does today
# (shyden-labs/playwright-devices#33).
#
# Usage: ANDROID_SERIAL=<serial> research/devices/measure-cdp-cold-start.zsh [runs=20]
# Hold the USB phones claim first. Prints one line per run, then a summary.
set -uo pipefail

serial=${ANDROID_SERIAL:?set ANDROID_SERIAL (adb devices)}
runs=${1:-20}
port=9333
ceiling_ms=10000
[[ -d ~/.claude/locks/usb-devices ]] || { echo "claim the USB phones first (~/.claude/locks/usb-devices)" >&2; exit 1; }

now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time*1000'; }
socket_open() { adb -s $serial shell cat /proc/net/unix | awk '{print $NF}' | grep -qx '@chrome_devtools_remote'; }
answered() { curl -s -m 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/json/version" | grep -qx 200; }

adb -s $serial forward tcp:$port localabstract:chrome_devtools_remote >/dev/null
trap 'adb -s $serial forward --remove tcp:$port >/dev/null 2>&1' EXIT

first_fail=0
for i in $(seq 1 $runs); do
  adb -s $serial shell am force-stop com.android.chrome
  t0=$(now_ms)
  adb -s $serial shell am start -a android.intent.action.VIEW -d about:blank com.android.chrome >/dev/null
  until socket_open; do
    (( $(now_ms) - t0 > ceiling_ms )) && { echo "run $i: socket not open within ${ceiling_ms} ms"; continue 2; }
  done
  t_socket=$(( $(now_ms) - t0 ))
  if answered; then first="answered"; else first="REFUSED"; (( first_fail++ )); fi
  until answered; do
    (( $(now_ms) - t0 > ceiling_ms )) && { echo "run $i: socket at ${t_socket} ms, no answer within ${ceiling_ms} ms"; continue 2; }
  done
  t_answer=$(( $(now_ms) - t0 ))
  echo "run $i: socket ${t_socket} ms, first request at socket: $first, first answer ${t_answer} ms"
done
echo "summary: $runs runs, first request at socket refused in $first_fail"

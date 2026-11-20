#!/bin/zsh
# Runs the unchanged journey on one device and keeps its output as evidence
# (shyden-labs/playwright-devices#7).
#
#   run-journey.zsh iphone  <udid>                 real iPhone or iPad over USB
#   run-journey.zsh ios-sim <udid>                 booted iOS Simulator
#   run-journey.zsh android <serial> <route>       phone or emulator; route android-cdp or android-playwright
#
# Claim first: the USB phones through ~/.claude/locks/usb-devices, a simulator or
# emulator through ~/.claude/scripts/sim-use.zsh. This script starts the device
# side (WebDriverAgent, ios_webkit_debug_proxy, Chrome's DevTools forward),
# runs the journey, stops everything it started, and copies the report into
# research/devices/evidence/<target>-<date>-<time>.{txt,json}.
set -euo pipefail

repo=${0:A:h:h:h}
wda=$HOME/Library/Caches/playwright-devices/wda
runner_id=uk.co.shyden.WebDriverAgentRunner.xctrunner
fixtures=$repo/research/devices/fixtures
evidence=$repo/research/devices/evidence
stamp=$(date +%F-%H%M)
pids=()
forwarded=''

die() { print -u2 "run-journey: $*"; exit 2; }

cleanup() {
  for pid in $pids; do kill $pid 2>/dev/null || true; done
  [[ -n $forwarded ]] && adb -s $forwarded forward --remove tcp:9230 2>/dev/null || true
}
trap cleanup EXIT

# Waits for `url` to answer with a body matching `pattern`, failing at `ceiling` seconds naming `what`.
wait_for() {
  local url=$1 pattern=$2 ceiling=$3 what=$4 start=$SECONDS
  until curl -sf --max-time 2 $url 2>/dev/null | grep -q -- $pattern; do
    (( SECONDS - start >= ceiling )) && die "$what did not answer at $url within ${ceiling} s"
    sleep 1
  done
  print "run-journey: $what answered after $(( SECONDS - start )) s"
}

# Starts WebDriverAgent with the cached build in `derived`, logging to `logs`.
start_wda() {
  local udid=$1 derived=$2 logs=$3
  mkdir -p $logs
  xcodebuild test-without-building -project $wda/src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
    -destination id=$udid -derivedDataPath $derived >$logs/wda.log 2>&1 &
  pids+=$!
}

# Opens one Safari tab through WebDriverAgent; the journey navigates it.
open_tab_through_wda() {
  local session
  session=$(curl -sf -X POST -H 'content-type: application/json' -d '{"capabilities":{}}' http://127.0.0.1:8100/session |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sessionId))')
  curl -sf -X POST -H 'content-type: application/json' -d '{"url":"http://127.0.0.1:9/"}' http://127.0.0.1:8100/session/$session/url >/dev/null
  curl -sf -X DELETE http://127.0.0.1:8100/session/$session >/dev/null
}

target=${1:-}
case $target in
  iphone)
    udid=${2:-}; [[ -n $udid ]] || die "usage: run-journey.zsh iphone <udid>"
    route=ios-webkit label=iphone-$udid
    iproxy 8100 8100 -u $udid >$wda/logs/iproxy.log 2>&1 &
    pids+=$!
    start_wda $udid $wda/derived $wda/logs
    wait_for http://127.0.0.1:8100/status '"ready"' 180 WebDriverAgent
    xcrun devicectl device copy to --device $udid --domain-type appDataContainer --domain-identifier $runner_id \
      --source $fixtures/device-journey.txt --destination Documents/device-journey.txt >/dev/null
    ios_webkit_debug_proxy -c $udid:9222 >$wda/logs/iwdp.log 2>&1 &
    pids+=$!
    open_tab_through_wda
    wait_for http://127.0.0.1:9222/json webSocketDebuggerUrl 30 'ios_webkit_debug_proxy (a Safari tab)'
    ;;
  ios-sim)
    udid=${2:-}; [[ -n $udid ]] || die "usage: run-journey.zsh ios-sim <udid>"
    route=ios-webkit label=ios-sim-$udid
    xcrun simctl bootstatus $udid -b >/dev/null
    xcrun simctl addmedia $udid $fixtures/device-journey.png
    start_wda $udid $wda/derived-sim $wda/logs-sim
    wait_for http://127.0.0.1:8100/status '"ready"' 300 WebDriverAgent
    cp $fixtures/device-journey.txt "$(xcrun simctl get_app_container $udid $runner_id data)/Documents/device-journey.txt"
    socket=$(xcrun simctl getenv $udid RWI_LISTEN_SOCKET)
    ios_webkit_debug_proxy -s unix:$socket >$wda/logs-sim/iwdp.log 2>&1 &
    pids+=$!
    xcrun simctl openurl $udid http://127.0.0.1:9/
    wait_for http://127.0.0.1:9222/json webSocketDebuggerUrl 60 'ios_webkit_debug_proxy (a Safari tab)'
    ;;
  android)
    serial=${2:-} route=${3:-}
    [[ -n $serial && ( $route == android-cdp || $route == android-playwright ) ]] ||
      die "usage: run-journey.zsh android <serial> <android-cdp|android-playwright>"
    label=$route-$serial
    export ANDROID_SERIAL=$serial
    if [[ $route == android-cdp ]]; then
      # Chrome opens its DevTools socket only once it runs in the foreground, so start it cold.
      adb -s $serial shell am force-stop com.android.chrome
      adb -s $serial shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d http://127.0.0.1:9/ >/dev/null
      adb -s $serial forward tcp:9230 localabstract:chrome_devtools_remote >/dev/null
      forwarded=$serial
      wait_for http://127.0.0.1:9230/json/version Browser 30 "Chrome's DevTools socket"
    fi
    ;;
  *) die "usage: run-journey.zsh iphone <udid> | ios-sim <udid> | android <serial> <route>" ;;
esac

out=$evidence/$label-$stamp.txt
print "run-journey: $label, route $route, output $out"
set +e
(cd $repo && DEVICE_ROUTE=$route npx playwright test --config playwright.devices.config.ts) 2>&1 | tee $out
result=${pipestatus[1]}
set -e
cp $repo/test-results/devices/$route.json $evidence/$label-$stamp.json
print "run-journey: $label exit=$result" | tee -a $out
exit $result

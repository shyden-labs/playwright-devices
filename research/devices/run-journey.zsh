#!/bin/zsh
# Runs the unchanged journey on one device and keeps its output as evidence
# (shyden-labs/playwright-devices#7).
#
#   run-journey.zsh iphone  <udid>                 real iPhone or iPad over USB
#   run-journey.zsh ios-sim <udid>                 booted iOS Simulator
#   run-journey.zsh android <serial> <route>       phone or emulator; route android-cdp or android-playwright
#   PROBE=<script.ts> run-journey.zsh …            the same device side, a measurement script instead of the journey
#
# Claim first: the USB phones through ~/.claude/locks/usb-devices (a simulator run too: its
# inspector proxy attaches every iPhone on USB), a simulator or
# emulator through ~/.claude/scripts/sim-use.zsh. This script starts the device
# side (WebDriverAgent, ios_webkit_debug_proxy, Chrome's DevTools forward),
# runs the journey, stops everything it started, and copies the report into
# research/devices/evidence/<target>-<date>-<time>.{txt,json}.
set -euo pipefail

repo=${0:A:h:h:h}
wda=$HOME/Library/Caches/playwright-devices/wda
runner_id=uk.co.shyden.WebDriverAgentRunner.xctrunner
fixtures=$repo/src/devices/phone-files
evidence=$repo/research/devices/evidence
stamp=$(date +%F-%H%M)
pids=()

die() { print -u2 "run-journey: $*"; exit 2; }

cleanup() {
  for pid in $pids; do kill $pid 2>/dev/null || true; done
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

# ios_webkit_debug_proxy listens on every address and has no option to stop that;
# the pf rule in mac-setup/ (shyden-labs/playwright-devices#19)
# keeps its ports to this Mac. Refuse to start it unless that rule was loaded.
require_pf_rule() {
  grep -q 'port 9221:9322' /etc/pf.shyden.conf 2>/dev/null ||
    die "/etc/pf.shyden.conf does not block ports 9221-9322; install mac-setup/ first"
  launchctl print system/uk.co.shyden.pf 2>/dev/null | grep -q 'last exit code = 0' ||
    die "the pf rule's launchd job (uk.co.shyden.pf) has not loaded it; install mac-setup/ first"
}

# Starts WebDriverAgent with the cached build in `derived`, logging to `logs`.
start_wda() {
  local udid=$1 derived=$2 logs=$3
  mkdir -p $logs
  xcodebuild test-without-building -project $wda/src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
    -destination id=$udid -derivedDataPath $derived >$logs/wda.log 2>&1 &
  pids+=$!
}

target=${1:-}
case $target in
  iphone)
    udid=${2:-}; [[ -n $udid ]] || die "usage: run-journey.zsh iphone <udid>"
    route=ios-webkit label=iphone-$udid project=iphone
    # The packaged command starts and stops the iPhone's side (shyden-labs/playwright-devices#54).
    launcher=(node $repo/src/devices/cli/main.ts start iphone $udid --)
    ;;
  ios-sim)
    udid=${2:-}; [[ -n $udid ]] || die "usage: run-journey.zsh ios-sim <udid>"
    route=ios-webkit label=ios-sim-$udid project=iphone launcher=()
    xcrun simctl bootstatus $udid -b >/dev/null
    xcrun simctl addmedia $udid $fixtures/device-journey.png
    start_wda $udid $wda/derived-sim $wda/logs-sim
    wait_for http://127.0.0.1:8100/status '"ready"' 300 WebDriverAgent
    socket=$(xcrun simctl getenv $udid RWI_LISTEN_SOCKET)
    require_pf_rule
    # The proxy also attaches every iPhone on USB, and cannot name the simulator (it reads only hex
    # device ids): so hold the phones' claim for a simulator run too, put each USB iPhone on a port
    # from 9300, and leave 9222 to the simulator.
    config=null:9221 port=9300
    for phone in $(idevice_id -l); do config+=,$phone:$port; (( port += 1 )); done
    ios_webkit_debug_proxy -c $config,:9222 -s unix:$socket >$wda/logs-sim/iwdp.log 2>&1 &
    pids+=$!
    xcrun simctl openurl $udid http://127.0.0.1:9/
    # A cold inspector and Safari took 51 s to register at 4-5 GB swap (evidence/ios-simulator-inspector-cold-start-2026-11-19.txt).
    wait_for http://127.0.0.1:9222/json webSocketDebuggerUrl 150 'ios_webkit_debug_proxy (a Safari tab)'
    # What `playwright-devices start iphone` would set; the fixture puts the document into the simulator's runner.
    export PLAYWRIGHT_DEVICES_TARGET=iphone IOS_UDID=$udid IOS_RUNNER_ID=$runner_id IOS_SIMULATOR=1
    ;;
  android)
    serial=${2:-} route=${3:-}
    [[ -n $serial && ( $route == android-cdp || $route == android-playwright ) ]] ||
      die "usage: run-journey.zsh android <serial> <android-cdp|android-playwright>"
    label=$route-$serial project=$route
    # The packaged command checks the phone; the fixture starts and stops Chrome itself.
    launcher=(node $repo/src/devices/cli/main.ts start android $serial --)
    ;;
  *) die "usage: run-journey.zsh iphone <udid> | ios-sim <udid> | android <serial> <route>" ;;
esac

# PROBE=<script.ts> runs a measurement against the same device side instead of the journey.
if [[ -n ${PROBE:-} ]]; then
  print "run-journey: probing $label with $PROBE"
  (cd $repo && DEVICE_ROUTE=$route $launcher node $PROBE)
  exit $?
fi

out=$evidence/$label-$stamp.txt
print "run-journey: $label, route $route, output $out"
set +e
(cd $repo && JOURNEY_REPORT=$route $launcher npx playwright test --config playwright.devices.config.ts --project $project) 2>&1 | tee $out
result=${pipestatus[1]}
set -e
cp $repo/test-results/devices/$route.json $evidence/$label-$stamp.json
# A failed run's device screenshot, if Playwright wrote it as a file.
for shot in $repo/test-results/**/*.png(N); do cp $shot $evidence/$label-$stamp-${shot:t}; done
print "run-journey: $label exit=$result" | tee -a $out
exit $result

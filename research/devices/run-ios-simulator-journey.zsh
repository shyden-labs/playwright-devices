#!/bin/zsh
# Run the unchanged journey.spec.ts on Safari in an iOS Simulator (iPhone or iPad), with every tap,
# key and finger scroll sent by WebDriverAgent (shyden-labs/playwright-devices#7, AC 2). The
# simulator twin of run-ios-journey.zsh: same route, same fixture, IOS_SIMULATOR=1.
#
# Before running:
#   - hold the simulator claim (~/.claude/scripts/sim-use.zsh claim ...), global rule
#     simulators-one-at-a-time; this script boots IOS_UDID if it is not booted
#   - hold the USB phones claim too: ios_webkit_debug_proxy has no way to leave out a plugged-in
#     iPhone (its config only names hex UDIDs and the simulator is "SIMULATOR"), so it attaches to
#     every phone on USB as well as the simulator
#
# Usage: IOS_UDID=<simulator udid> research/devices/run-ios-simulator-journey.zsh [--build] [playwright args]
#   --build  (re)build WebDriverAgent for the simulator; needed once per Xcode or WDA version
#
# Measured 2026-11-17 (evidence/ios-simulator-iwdp-socket-2026-11-17.txt): the simulator's Web
# Inspector socket is the simulator's RWI_LISTEN_SOCKET (/private/var/tmp/com.apple.launchd.*/
# com.apple.webinspectord_sim.socket), not ios_webkit_debug_proxy's default localhost:27753; given
# that socket, the proxy lists Safari's tabs.
# Safari restores its tabs on launch, so they are cleared (SafariTabs.db, BrowserState.db) while
# Safari is stopped, leaving the one tab the route needs.
set -euo pipefail

repo=${0:A:h:h:h}
build=false
[[ ${1:-} == --build ]] && { build=true; shift; }

udid=${IOS_UDID:?set IOS_UDID to the simulator UDID (xcrun simctl list devices)}
wda_port=${WDA_PORT:-8101}
wda_src=${WDA_SRC:-$HOME/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent}
wda_dir=${WDA_DIR:-$HOME/Library/Caches/playwright-devices/wda}
derived=$wda_dir/derived-sim
logs=$wda_dir/logs-sim
safari_data=$HOME/Library/Developer/CoreSimulator/Devices/$udid/data/Library/Safari

[[ -d ~/.claude/locks/simulator ]] || { echo "claim the simulator first (~/.claude/scripts/sim-use.zsh claim)" >&2; exit 1; }
[[ -d ~/.claude/locks/usb-devices ]] || { echo "claim the USB phones first (~/.claude/locks/usb-devices): the proxy attaches to them too" >&2; exit 1; }
xcrun simctl list devices | grep -q "($udid)" || { echo "no simulator $udid in xcrun simctl list devices" >&2; exit 1; }
for port in $wda_port 9221; do
  # lsof exits 1 when nothing listens, which is the state wanted here.
  holder=$( (lsof -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null || true) | tail -n +2 | head -1)
  [[ -z $holder ]] || { echo "port $port is already held: $holder" >&2; exit 1; }
done

xcrun simctl list devices | grep "($udid)" | grep -q Booted || xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >/dev/null

# Earlier boots leave stale sockets behind (19 found 2026-11-17), so ask the booted simulator which
# one its Safari publishes to.
socket=$(xcrun simctl getenv "$udid" RWI_LISTEN_SOCKET)
[[ -S $socket ]] || { echo "simulator $udid names inspector socket '$socket', which is not a socket" >&2; exit 1; }

if $build || [[ ! -d $derived/Build/Products ]]; then
  [[ -d $wda_src/WebDriverAgent.xcodeproj ]] || { echo "no WebDriverAgent source at $wda_src" >&2; exit 1; }
  [[ -d $wda_dir/src ]] || { mkdir -p "$wda_dir"; cp -R "$wda_src" "$wda_dir/src"; }
  xcodebuild build-for-testing -quiet -project "$wda_dir/src/WebDriverAgent.xcodeproj" \
    -scheme WebDriverAgentRunner -destination "id=$udid" -derivedDataPath "$derived" \
    CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=
  # Ad-hoc signed: unsigned (CODE_SIGNING_ALLOWED=NO) the runner is refused at launch with
  # "Application failed preflight checks" (measured 2026-11-18, Xcode 27.2).
fi

# The journey's file step places its file in the runner's Documents and picks it in Safari's Files
# picker, which lists an app's Documents only when the app declares file sharing (as
# run-ios-journey.zsh does for the iPhone). Without the two keys the simulator's Files showed
# "On My iPhone is Empty" (run 6, 2026-11-19; the built runner's Info.plist measured without them).
# Xcode generates the Info.plist, so the keys go into the built app, which is ad-hoc signed again.
runner=("$derived"/Build/Products/*-iphonesimulator/WebDriverAgentRunner-Runner.app(N))
[[ -n ${runner[1]:-} ]] || { echo "no built WebDriverAgentRunner-Runner.app under $derived; run with --build" >&2; exit 1; }
runner=${runner[1]}
if ! /usr/libexec/PlistBuddy -c 'Print :UIFileSharingEnabled' "$runner/Info.plist" >/dev/null 2>&1; then
  entitlements=$(mktemp)
  codesign -d --entitlements - --xml "$runner" >"$entitlements" 2>/dev/null
  /usr/libexec/PlistBuddy -c 'Add :UIFileSharingEnabled bool true' -c 'Add :LSSupportsOpeningDocumentsInPlace bool true' "$runner/Info.plist"
  if [[ -s $entitlements ]]; then
    codesign -f -s - --entitlements "$entitlements" --preserve-metadata=identifier,flags "$runner"
  else
    codesign -f -s - --preserve-metadata=identifier,flags "$runner"
  fi
  rm -f "$entitlements"
  codesign -v --strict "$runner"
fi

# One Safari tab: stop Safari, drop the tabs it would restore, start it again.
xcrun simctl terminate "$udid" com.apple.mobilesafari 2>/dev/null || true
rm -f "$safari_data"/SafariTabs.db*(N) "$safari_data"/BrowserState.db*(N)
pids=()
stop_all() {
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop_all EXIT INT TERM

mkdir -p "$logs"
# The proxy starts first. Its connection launches the simulator's webinspectord on demand, which
# then warms up while WebDriverAgent starts. The proxy reports "Connected" and lists pages only
# once Safari has registered with that daemon (measured 2026-11-19, evidence
# ios-simulator-inspector-cold-start-2026-11-19.txt): 10 s after openurl with the daemon warm,
# 51 s with the daemon and Safari both starting cold at 4-5 GB swap. Run 4 (2026-11-18, 8 GB swap)
# started both cold and ran out of its 60 s ceiling.
ios_webkit_debug_proxy -s "unix:$socket" >"$logs/iwdp.log" 2>&1 &
pids+=($!)
# WebDriverAgent first, alone: launched while Safari opens, SpringBoard refuses the runner as
# Busy ("Application failed preflight checks"); alone it answers /status after about 100 s
# (measured 2026-11-18).
xcodebuild test-without-building -project "$wda_dir/src/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner -destination "id=$udid" -derivedDataPath "$derived" \
  USE_PORT="$wda_port" >"$logs/wda.log" 2>&1 &
pids+=($!)
wda_pid=$!
ceiling=240
for ((s = 0; s < ceiling; s += 1)); do
  curl -fsS "http://127.0.0.1:$wda_port/status" >/dev/null 2>&1 && break
  kill -0 $wda_pid 2>/dev/null || { echo "WebDriverAgent's xcodebuild exited; see $logs/wda.log" >&2; exit 1; }
  sleep 1
done
curl -fsS "http://127.0.0.1:$wda_port/status" >/dev/null || { echo "WebDriverAgent did not answer on port $wda_port within ${ceiling}s; see $logs/wda.log" >&2; exit 1; }

# Wait, at a stated ceiling, for the proxy's SIMULATOR entry and then for exactly one Safari tab.
# 180 s: over three times the slowest measured cold chain (51 s, see above).
ceiling=180
iwdp_port=
tabs=0
for ((s = 0; s < ceiling; s += 1)); do
  if [[ -z $iwdp_port ]]; then
    devices=$(curl -fsS http://127.0.0.1:9221/json 2>/dev/null || true)
    [[ -n $devices ]] && iwdp_port=$(print -r -- "$devices" |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.deviceId==="SIMULATOR");if(d)console.log(d.url.split(":")[1])})')
    if [[ -n $iwdp_port ]]; then
      # The proxy lists only pages that open after it connects, and a bare launch shows the Start
      # Page, which it does not list (both measured 2026-11-17); so Safari is opened on a URL now.
      # about:blank is refused (LSApplicationWorkspaceErrorDomain 115); a closed local port gives
      # Safari's error page in one inspectable tab.
      xcrun simctl openurl "$udid" http://127.0.0.1:9/
    fi
  fi
  [[ -n $iwdp_port ]] && tabs=$(curl -fsS "http://127.0.0.1:$iwdp_port/json" 2>/dev/null | grep -c webSocketDebuggerUrl || true)
  (( tabs == 1 )) && break
  sleep 1
done
[[ -n $iwdp_port ]] || { echo "the proxy listed no SIMULATOR within ${ceiling}s; see $logs/iwdp.log" >&2; exit 1; }
(( tabs == 1 )) || { echo "the proxy lists $tabs Safari tabs on port $iwdp_port after ${ceiling}s; the route needs one" >&2; exit 1; }
cd "$repo/research/devices"
DEVICE_ROUTE=ios-webkit IOS_SIMULATOR=1 IOS_UDID=$udid IWDP_PORT=$iwdp_port PAGE_HOST=127.0.0.1 \
  WDA_URL="http://127.0.0.1:$wda_port" \
  npx playwright test -c playwright.devices.config.ts "$@"

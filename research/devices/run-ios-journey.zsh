#!/bin/zsh
# Run the unchanged journey.spec.ts on a real iPhone's Safari, with every tap, key and finger
# scroll sent by WebDriverAgent (shyden-labs/playwright-devices#7). One script, so WebDriverAgent,
# iproxy and ios_webkit_debug_proxy start and stop together around the run.
#
# Before running:
#   - hold the USB phones claim (~/.claude/locks/usb-devices, global rule usb-devices-one-session-at-a-time)
#   - the iPhone is unlocked, trusted, with Safari open on exactly ONE tab
#   - the phone and this Mac are on the same Wi-Fi, VPN off (the phone loads the page from PAGE_HOST)
#   - the pf rule in mac-setup/ is installed: ios_webkit_debug_proxy listens on every address and
#     has no option to stop it, so pf keeps ports 9221-9322 to this Mac (shyden-labs/playwright-devices#19)
#
# Usage: research/devices/run-ios-journey.zsh [--build]
#   --build  (re)build WebDriverAgent; needed once per Xcode or WebDriverAgent version
#
# Settings (environment, with defaults):
#   IOS_UDID   the phone's UDID (default: the only one idevice_id lists)
#   WDA_PORT   WebDriverAgent's port on the phone and on this Mac (default 8101; Appium holds 8100)
#   IWDP_PORT  ios_webkit_debug_proxy's port for the phone (default 9222)
#   PAGE_HOST  this Mac's address as the phone sees it (default: en0's IPv4 address)
#   WDA_SRC    WebDriverAgent source (default: Appium's appium-webdriveragent checkout)
#   WDA_DIR    signed copy and build output (default: ~/Library/Caches/playwright-devices/wda)
#
# Signing (measured 2026-11-17): team F3XX4PM3MF, profile "WDA Dev Wildcard 2026-06-30"
# (wildcard App ID, expires 2027-06-30), bundle uk.co.shyden.WebDriverAgentRunner. Only the
# WebDriverAgentRunner target carries the profile; frameworks cannot, so they sign without one.
set -euo pipefail

repo=${0:A:h:h:h}
build=false
[[ ${1:-} == --build ]] && build=true

udid=${IOS_UDID:-$(idevice_id -l | head -1)}
[[ -n $udid ]] || { echo "no iPhone found by idevice_id -l: plug it in and trust this Mac" >&2; exit 1; }
wda_port=${WDA_PORT:-8101}
iwdp_port=${IWDP_PORT:-9222}
page_host=${PAGE_HOST:-$(ipconfig getifaddr en0)}
wda_src=${WDA_SRC:-$HOME/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent}
wda_dir=${WDA_DIR:-$HOME/Library/Caches/playwright-devices/wda}
team=F3XX4PM3MF
profile='WDA Dev Wildcard 2026-06-30'
bundle=uk.co.shyden.WebDriverAgentRunner
derived=$wda_dir/derived

[[ -d ~/.claude/locks/usb-devices ]] || { echo "claim the USB phones first (~/.claude/locks/usb-devices)" >&2; exit 1; }
for port in $wda_port $iwdp_port; do
  # lsof exits 1 when nothing listens, which is the state wanted here.
  holder=$( (lsof -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null || true) | tail -n +2 | head -1)
  [[ -z $holder ]] || { echo "port $port is already held: $holder" >&2; exit 1; }
done

if $build || [[ ! -d $derived/Build/Products ]]; then
  [[ -d $wda_src/WebDriverAgent.xcodeproj ]] || { echo "no WebDriverAgent source at $wda_src" >&2; exit 1; }
  rm -rf "$wda_dir/src"
  mkdir -p "$wda_dir"
  cp -R "$wda_src" "$wda_dir/src"
  ruby -rxcodeproj -e '
    team, profile, bundle = ARGV[1], ARGV[2], ARGV[3]
    proj = Xcodeproj::Project.open(ARGV[0])
    proj.targets.each do |t|
      t.build_configurations.each do |c|
        bs = c.build_settings
        bs["CODE_SIGN_STYLE"] = "Manual"
        bs["DEVELOPMENT_TEAM"] = team
        bs["CODE_SIGN_IDENTITY"] = "Apple Development"
        if t.name == "WebDriverAgentRunner"
          bs["PROVISIONING_PROFILE_SPECIFIER"] = profile
          bs["PRODUCT_BUNDLE_IDENTIFIER"] = bundle
        else
          bs["PROVISIONING_PROFILE_SPECIFIER"] = ""
          bs.delete("PROVISIONING_PROFILE")
        end
      end
    end
    proj.save
  ' "$wda_dir/src/WebDriverAgent.xcodeproj" "$team" "$profile" "$bundle"
  xcodebuild build-for-testing -quiet -project "$wda_dir/src/WebDriverAgent.xcodeproj" \
    -scheme WebDriverAgentRunner -destination "id=$udid" -derivedDataPath "$derived"
fi

pids=()
stop_all() {
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop_all EXIT INT TERM

logs=$wda_dir/logs
mkdir -p "$logs"
iproxy "$wda_port:$wda_port" -u "$udid" >"$logs/iproxy.log" 2>&1 &
pids+=($!)
ios_webkit_debug_proxy -c "$udid:$iwdp_port" >"$logs/iwdp.log" 2>&1 &
pids+=($!)
xcodebuild test-without-building -project "$wda_dir/src/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner -destination "id=$udid" -derivedDataPath "$derived" \
  USE_PORT="$wda_port" >"$logs/wda.log" 2>&1 &
pids+=($!)

# Wait for WebDriverAgent's /status, at a stated ceiling, naming what it waits for.
ceiling=120
for ((s = 0; s < ceiling; s += 2)); do
  curl -fsS "http://127.0.0.1:$wda_port/status" >/dev/null 2>&1 && break
  kill -0 "${pids[3]}" 2>/dev/null || { echo "WebDriverAgent's xcodebuild exited; see $logs/wda.log" >&2; exit 1; }
  if grep -q 'because the device is locked' "$logs/wda.log"; then
    echo "the iPhone is locked: unlock it (and set Auto-Lock to Never for device runs), then run again" >&2
    exit 1
  fi
  sleep 2
done
curl -fsS "http://127.0.0.1:$wda_port/status" >/dev/null || { echo "WebDriverAgent did not answer on port $wda_port within ${ceiling}s; see $logs/wda.log" >&2; exit 1; }

cd "$repo/research/devices"
DEVICE_ROUTE=ios-webkit IOS_UDID=$udid IWDP_PORT=$iwdp_port PAGE_HOST=$page_host \
  WDA_URL="http://127.0.0.1:$wda_port" \
  npx playwright test -c playwright.devices.config.ts

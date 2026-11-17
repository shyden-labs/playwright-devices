#!/bin/zsh
# Run the one journey on every real device, every time (global rule: a change for one device is
# proven on all of them): the iPhone through run-ios-journey.zsh, then Chrome on the Android phone
# over both routes (shyden-labs/playwright-devices#7). Each target's Playwright summary is printed
# under its name; the script exits 1 if any target failed, after running them all.
#
# Before running: hold the USB phones claim (~/.claude/locks/usb-devices) and meet
# run-ios-journey.zsh's own conditions (iPhone unlocked, Safari on one tab, same Wi-Fi, pf rule).
#
# Usage: ANDROID_SERIAL=<serial> research/devices/run-all-devices.zsh [playwright test arguments...]
set -uo pipefail

here=${0:A:h}
serial=${ANDROID_SERIAL:?set ANDROID_SERIAL to the Android phone (adb devices)}
[[ -d ~/.claude/locks/usb-devices ]] || { echo "claim the USB phones first (~/.claude/locks/usb-devices)" >&2; exit 1; }

logs=$(mktemp -d)
failed=()
run_target() {
  local name=$1; shift
  local log=$logs/$name.log
  echo "== $name (full output: $log)"
  "$@" >"$log" 2>&1
  local rc=$?
  grep -vE '^\s+at ' "$log" | grep -E '✓|✘|passed|failed|skipped|flaky|Error:'
  # A target counts as passed only if it ran tests and said so; exit 0 with no "N passed" ran nothing.
  if (( rc == 0 )) && ! grep -qE '^\s+[0-9]+ passed' "$log"; then
    echo "$name: exit 0 but no passed total, so nothing ran"
    rc=1
  fi
  echo "$name exit=$rc"
  (( rc == 0 )) || failed+=($name)
}

run_target ios-webkit "$here/run-ios-journey.zsh" "$@"
for route in android-cdp android-playwright; do
  run_target $route env DEVICE_ROUTE=$route ANDROID_SERIAL=$serial \
    npx playwright test -c "$here/playwright.devices.config.ts" "$@"
done

(( ${#failed} == 0 )) || { echo "failed on: ${failed[*]}" >&2; exit 1; }
echo "every device passed"

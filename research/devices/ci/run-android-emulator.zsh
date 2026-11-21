#!/bin/zsh
# Runs the unchanged journey on a GitHub-hosted Android emulator over both Android routes
# (shyden-labs/playwright-devices#38). Called by android-emulator-runner once the emulator has booted.
#
#   run-android-emulator.zsh <serial>
set -uo pipefail

serial=${1:?usage: run-android-emulator.zsh <serial>}
repo=${0:A:h:h:h:h}
# Playwright's Android launch needs Chrome as the debug app (research/devices/android-chrome-start.ts).
adb -s $serial shell am set-debug-app --persistent com.android.chrome
status=0
for route in android-playwright android-cdp; do
  zsh $repo/research/devices/run-journey.zsh android $serial $route || status=1
done
exit $status

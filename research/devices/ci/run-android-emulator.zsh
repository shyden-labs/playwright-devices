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
# The emulator reaches this runner's loopback as 10.0.2.2; the runner has no Wi-Fi (research/devices/serve.ts).
export JOURNEY_HOST_ALIAS=10.0.2.2
# A fresh emulator's Chrome covers the page with a "Chrome notifications make things easier" prompt
# until notifications are allowed (devices-sim run 44882233599).
adb -s $serial shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS
zsh $repo/research/devices/ci/finish-chrome-first-run.zsh $serial
evidence=$repo/research/devices/evidence
result=0
for route in android-playwright android-cdp; do
  zsh $repo/research/devices/run-journey.zsh android $serial $route || result=1
  # What was in front when the route ended, kept beside its report.
  adb -s $serial exec-out screencap -p >$evidence/android-emulator-after-$route.png
  adb -s $serial shell dumpsys activity activities | grep -m1 ResumedActivity >$evidence/android-emulator-after-$route.txt
done
exit $result

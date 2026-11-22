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
# Draws each touch on the screen, so a screenshot shows where a tap landed (shyden-labs/playwright-devices#38).
adb -s $serial shell settings put system show_touches 1
evidence=$repo/research/devices/evidence
# No route starts while Google Play is still updating apps: Chrome died just after a Play services
# update twice (shyden-labs/playwright-devices#45).
zsh $repo/research/devices/ci/wait-for-play-updates.zsh $serial $evidence/android-emulator-play-updates.txt || exit 1
zsh $repo/research/devices/ci/wait-for-play-updates.zsh --list $serial >$evidence/android-emulator-packages-before-routes.txt
zsh $repo/research/devices/ci/measure-android-pickers.zsh $serial $evidence/android-emulator-pickers.txt
result=0
for route in android-playwright android-cdp; do
  # Round 19: the first route's chooser named its browser Media picker, the second's Photos & videos;
  # the resolvers before each route say whether the second route faced different pickers.
  zsh $repo/research/devices/ci/measure-android-pickers.zsh $serial $evidence/android-emulator-pickers-before-$route.txt
  zsh $repo/research/devices/run-journey.zsh android $serial $route || result=1
  # What was in front when the route ended, kept beside its report.
  adb -s $serial exec-out screencap -p >$evidence/android-emulator-after-$route.png
  adb -s $serial shell dumpsys activity activities | grep -m1 ResumedActivity >$evidence/android-emulator-after-$route.txt
  # Every window, popups included: the tablet's drop-down list was missing from the plain dump (round 15).
  adb -s $serial exec-out uiautomator dump --windows /dev/tty >$evidence/android-emulator-after-$route-windows.xml 2>&1 || true
  # Round 16: the pixel_9's file chooser offered Camcorder, Camera and Media picker, no Files. What a
  # person finds behind Media picker, when the chooser is still open (measures, never fails the job).
  # Round 19 (run 45023335822): the cdp route's chooser offered Photos & videos in its place.
  bounds=$(grep -oE 'text="(Media picker|Photos &amp; videos)"[^>]*bounds="[^"]*"' $evidence/android-emulator-after-$route-windows.xml | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)
  if [[ -n $bounds ]]; then
    nums=(${(s:,:)${${bounds//\]\[/,}//[\[\]]/}})
    adb -s $serial shell input tap $(( (nums[1] + nums[3]) / 2 )) $(( (nums[2] + nums[4]) / 2 ))
    adb -s $serial shell sleep 5
    adb -s $serial exec-out screencap -p >$evidence/android-emulator-after-$route-media-picker.png
    adb -s $serial exec-out uiautomator dump --windows /dev/tty >$evidence/android-emulator-after-$route-media-picker-windows.xml 2>&1 || true
    adb -s $serial shell input keyevent KEYCODE_BACK
  fi
done
# Where the Colour tap lands after typing (shyden-labs/playwright-devices#38); measures, never fails the job.
for route in android-playwright android-cdp; do
  DEVICE_SPEC=colour-tap.probe.ts zsh $repo/research/devices/run-journey.zsh android $serial $route || true
done
# Any update that still landed during the routes (shyden-labs/playwright-devices#45). Name and update time
# only: run 45042398426's diff listed packages whose object hash changed when their process restarted.
zsh $repo/research/devices/ci/wait-for-play-updates.zsh --list $serial >$evidence/android-emulator-packages-after-routes.txt
diff $evidence/android-emulator-packages-before-routes.txt $evidence/android-emulator-packages-after-routes.txt >$evidence/android-emulator-packages-changed-during-routes.txt || true
exit $result

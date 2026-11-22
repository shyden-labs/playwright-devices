# Playwright on real devices, simulators and emulators (November 2026)

Findings for shyden-labs/playwright-devices#7: can one unchanged Playwright test (`page.goto`, `toBeVisible()` and `toHaveText()`, a real tap, real typing, a real finger scroll) run on Safari on iPhone and the iOS Simulator, and on Chrome on Android and its emulator? Every result below links the evidence kept in `research/devices/evidence/`.

**Status: draft.** The iOS Simulator and the Android emulators run on GitHub's machines (below); the five-runs-in-a-row count for the emulators is still being gathered.

## Summary

| Target | Result | Route | Evidence |
| --- | --- | --- | --- |
| Real iPhone, Safari | **Works** (20 of 20) | `ios-webkit`: Playwright reads and asserts over ios_webkit_debug_proxy; taps, keys and the finger scroll go through WebDriverAgent | [all-devices-repeat20-2026-11-17.txt](../../research/devices/evidence/all-devices-repeat20-2026-11-17.txt), [ios-wda-journey.txt](../../research/devices/evidence/ios-wda-journey.txt) |
| Real Android phone, Chrome | **Works** (20 of 20 on each route) | `android-cdp` (`chromium.connectOverCDP` over an adb forward) and `android-playwright` (`_android`) | [all-devices-repeat20-2026-11-17.txt](../../research/devices/evidence/all-devices-repeat20-2026-11-17.txt) |
| iOS Simulator (iPhone, iPad), Safari | **Works on GitHub's machines**: iPhone 18 Pro, iPhone Duo, iPad Pro 13-inch and iPad mini each passed the whole journey in six CI rounds in a row (2026-11-22, below). On the 8 GB Mac: iPhone passed (2026-11-19); iPad 6 of 11 (2026-11-20), WebDriverAgent stalls at swap 6.5-7.8 GB | `ios-webkit` (`run-journey.zsh ios-sim <udid>`): the proxy on the simulator's own inspector socket, WebDriverAgent in the simulator | [ios-simulator-iphone-journey-2026-11-19-run8.txt](../../research/devices/evidence/ios-simulator-iphone-journey-2026-11-19-run8.txt), [ipad-sim-file-probe-2026-11-20.txt](../../research/devices/evidence/ipad-sim-file-probe-2026-11-20.txt), [CI run 45046615459](../../research/devices/evidence/ci-run-45046615459/) |
| Android emulator (phone, tablet), Chrome | **Works on GitHub's machines**: pixel_9 and pixel_tablet passed the whole journey on both routes in two CI rounds in a row (2026-11-22, below); three more rounds wanted | the two Android routes, once Google Play has finished updating | [CI run 45046615459](../../research/devices/evidence/ci-run-45046615459/) |
| Native pickers (`<select>`, file, photo) | **Works** on Android (10 of 10 on each route); **partly** on the iPhone (all three reached; the `<select>` step fails 6 of 10 after a passing run, shyden-labs/playwright-devices#25) | the fixture's `nativeChoose`, `nativeChooseFile`, `nativeChoosePhoto`: real touches on the phone's own lists (uiautomator + `adb input` on Android, WebDriverAgent on iOS) | [native-select-2026-11-18.txt](../../research/devices/evidence/native-select-2026-11-18.txt), [native-file-picker-2026-11-18.txt](../../research/devices/evidence/native-file-picker-2026-11-18.txt), [native-photo-picker-2026-11-18.txt](../../research/devices/evidence/native-photo-picker-2026-11-18.txt), [ios-select-flake-2026-11-18.txt](../../research/devices/evidence/ios-select-flake-2026-11-18.txt) |

Measured with Playwright 1.65.1, macOS 27.2.1 and Xcode 27.2. iPhone: iPhone18,4, iOS 27.2, WebDriverAgent built from appium-webdriveragent 14.1.1 (to reconcile: its `/status` on the iPhone reported version 17.0.11), ios_webkit_debug_proxy 1.9.3. Android: OnePlus CPH2653, Android 16, Chrome 157.0.8103.50.

## iPhone: why Playwright alone is not enough

- Playwright has no iOS device support of its own. `webkit.connectOverCDP` to ios_webkit_debug_proxy is accepted ([ios-iphone-cdp.txt](../../research/devices/evidence/ios-iphone-cdp.txt)); `chromium.connectOverCDP` is refused (`Browser.getVersion` not found).
- Over that connection Playwright cannot create a context or a page ("Not supported"), so the test is given Safari's one open tab. It must be the only tab: Playwright waits on every tab the proxy lists, and a background tab never answers ([ios-webkit-background-tab-hang.txt](../../research/devices/evidence/ios-webkit-background-tab-hang.txt)).
- Playwright's input on this route is page JavaScript faking events, not real input ([ios-webkit-input-is-synthetic.txt](../../research/devices/evidence/ios-webkit-input-is-synthetic.txt)). So taps, typing and the finger scroll are sent as real touches and keys by WebDriverAgent, while Playwright still navigates, reads and asserts. The test body is unchanged; the fixture (`research/devices/device-fixture.ts`) chooses the route from `DEVICE_ROUTE`.
- ios_webkit_debug_proxy listens on every network address and has no option to stop that, so a pf rule keeps ports 9221-9322 to the Mac (shyden-labs/playwright-devices#19, `research/devices/mac-setup/`).

## Android

Both routes pass the unchanged journey with real input, sent through Android's own input service (`adb shell input`). Chrome opens its DevTools socket only once it runs in the foreground, so the `android-cdp` route starts Chrome cold and waits for the socket. One swipe in an early run did not scroll; it was not reproduced in 80 further runs (shyden-labs/playwright-devices#18).

The `android-playwright` route needs Chrome set as the debug app once per phone (`adb shell am set-debug-app --persistent com.android.chrome`): Playwright writes Chrome's flags to `/data/local/tmp/chrome-command-line`, which Chrome on a normal phone reads only as the debug app; without it the launch waits for a socket Chrome never opens (0 of 5, 2026-11-20). Playwright deletes that file only after a launch that worked, and a file left behind renames Chrome's socket, so the next `android-cdp` run finds no `chrome_devtools_remote` (shyden-labs/playwright-devices#33). The fixture (`research/devices/android-chrome-start.ts`) removes the file after every Android run and before each CDP start, waits for `/json/version` to name the browser (ceiling 30 s, naming what it last saw), and refuses the Playwright route at once when Chrome is not the debug app. With that, every route passed 5 rounds in a row on one commit: `android-playwright`, `android-cdp` and the iPhone, 15 of 15 ([android-stale-command-line-2026-11-20.txt](../../research/devices/evidence/android-stale-command-line-2026-11-20.txt), [real-phones-every-route-2026-11-20.txt](../../research/devices/evidence/real-phones-every-route-2026-11-20.txt)).

## Native pickers

The journey taps the page's `<select>`, file input and image input, then touches the phone's own native UI, never the page's script:

- **`<select>`:** Android's Chrome opens a native list (found in `uiautomator dump`, touched with `adb shell input tap`); iOS Safari opens a native menu of buttons (found and touched through WebDriverAgent).
- **File:** on Android, the chooser's *Files*, then the file, which the fixture pushed to Downloads and had indexed. On the iPhone, *Choose File* > *Browse* > *On My iPhone* > the WebDriverAgent runner's folder > the file, which the fixture copied there with `devicectl`. The runner lists in Files because the run script adds `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` to the built runner and signs it again with its own certificate. Files cells open only on a tap on the icon, not on the name.
- **Photo:** Google's photo picker on Android (a fixture image pushed first, so it is the newest) and *Photo Library* on the iPhone (the library's own first photo); both select on tap and return on *Done*. The page shows only the file's kind, because a photo's name and date are personal.
- A failed native step attaches the phone's screen by path into the git-ignored run folder, and teardown closes a picker left open, so it cannot swallow the next run's first touch.

## Simulators and emulators on GitHub's machines (shyden-labs/playwright-devices#38)

`.github/workflows/devices-sim.yml` runs the unchanged journey, and the colour-tap probe, through the same run script routes: iOS on the `xcode-27` image (Xcode 27.2; iOS 27.0 for iPhone 18 Pro, iPad Pro 13-inch and iPad mini, iOS 27.1 for iPhone Duo, since 27.2 simulators open the Files folder on no press), Android API 36 Play Store emulators (pixel_9, pixel_tablet) on `ubuntu-26.04` through android-emulator-runner. Reports are kept as each run's artifacts; round 25's text reports are kept in [ci-run-45046615459]({E}/).

| Target | CI rounds passed in a row | Job minutes (rounds 24 and 25) |
| --- | --- | --- |
| iPhone 18 Pro simulator, iOS 27.0 | 6 (rounds 20-25) | 27.2, 20.8 |
| iPhone Duo simulator, iOS 27.1 | 6 | 21.1, 21.3 |
| iPad Pro 13-inch (M5) simulator, iOS 27.0 | 6 | 13.3, 21.7 |
| iPad mini (A17 Pro) simulator, iOS 27.0 | 6 | 32.5, 11.3 |
| pixel_9 emulator, both routes | 2 (rounds 24-25) | 11.2, 9.0 |
| pixel_tablet emulator, both routes | 2 | 13.6, 11.7 |

Rounds: 20 = run 45027508984, 21 = 45035234085, 22 = 45037655845, 23 = 45040015654, 24 = 45042398426, 25 = 45046615459. Job minutes include building WebDriverAgent or booting the emulator, the journey, the probes and the evidence upload.

**Cost:** the repository is public, so GitHub bills none of it: the run timing API reports 0 billable ms for both rounds 24 and 25 (Ubuntu jobs at 0 ms, the macOS jobs not billed). At any run count the monthly cost is 0 while the repository stays public. The workflow runs on pull requests that change `research/devices/**`, `playwright.devices.config.ts` or the workflow itself.

What it took, each measured on these runs:
- **Google Play updating mid-test** (shyden-labs/playwright-devices#45): Play Store and Play services update themselves in the emulator's first minutes; Chrome died 2-6 s after a Play services update twice, once as the app on screen, and one update changed the file chooser between routes. The run now waits until no package's update time has changed for 120 s (at most 600 s) before the first route: in rounds 24 and 25 three of the four emulator runs saw Play Store and Play services update at 78-171 s (round 25's pixel_9 saw none), the routes began after 123-292 s, and no package updated during them.
- **Chrome's keyboard accessory view** takes touches 16 px above its bar's contents: a tap on the colour menu's centre landed 1 px inside it and never reached the page (pixel_tablet, run 45040015654). Taps aim at the part of a target above that view.
- **Pickers differ by build:** the emulator's photo picker returns on the photo's tap (no Done), the file browser may be named "Photos & videos", and a picker's sheet can still be moving when it first lists the photo; the steps accept each, and touch a photo only once two screen reads agree where it is.
- **iOS 27.2 simulators** open the Files folder on no press, so the iOS 27.0 and 27.1 runtimes are used. Twice before round 20 GitHub cancelled the iOS setup step with no output (shyden-labs/playwright-devices#46); setup has since succeeded in every round, and it now prints memory and free disk every 30 s.

## iOS Simulator on the 8 GB Mac

- The simulator's Web Inspector socket is the simulator's own `RWI_LISTEN_SOCKET` (`xcrun simctl getenv <udid> RWI_LISTEN_SOCKET`), not the proxy's default; given that socket, the proxy lists Safari's pages (measured 2026-11-17 23:18). The proxy also attaches every USB iPhone and cannot name the simulator, so the run script puts each USB iPhone on a port from 9300 and leaves 9222 to the simulator: a simulator run holds the USB phones' claim too.
- WebDriverAgent runs in the simulator ad-hoc signed, started alone before Safari; it is refused as "Busy" if it starts while Safari opens. The Files picker lists the runner's folder only after the run script declares file sharing in the built runner (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`).
- **iPhone 18 Pro simulator:** the whole journey passed on 2026-11-19 (run 8, swap 7.9 GB at start) ([ios-simulator-iphone-journey-2026-11-19-run8.txt](../../research/devices/evidence/ios-simulator-iphone-journey-2026-11-19-run8.txt)); not yet re-run with the test-first rewrite.
- **iPad Pro 13-inch simulator, 2026-11-20:** 6 of 11 runs from 18:19 WIB passed (82-197 s); 5 failed. Two ran past the 5-minute limit (18:29: the photo picker's Done opened its review sheet, not reproduced by a later probe; 18:37: every step slow, swap not recorded). The last three (20:56, 21:07, 22:02 WIB) were WebDriverAgent going silent for 30 s or more, never a wrong result on the page, all at the same point, the first lookup after the file is tapped in Files, with swap at 6.5-7.8 GB. A probe at 22:21 WIB then saw the first page tap (`POST /actions`, before any picker was open) go unanswered for 30 s at swap 7 GB, so the stall is not tied to the Files picker ([ipad-sim-file-probe-2026-11-20.txt](../../research/devices/evidence/ipad-sim-file-probe-2026-11-20.txt), WebDriverAgent logs kept beside each run's report). Memory pressure on this 8 GB Mac is the lead suspect: swap rose from 2.5 GB to 7.8 GB during one run while other projects' test runs were active. Unproven until a run on a quiet machine.
- Every request to WebDriverAgent now fails after 30 s naming its method and path, and each native step is its own named step in the report, so a stall says where it happened.

## Licences of each route's dependencies

Every licence below was read from the package itself (Homebrew's formula data and the package's own licence file, or `package.json`) on 2026-11-18.

| Dependency | Used by | Licence | How it is used |
| --- | --- | --- | --- |
| Playwright (`@playwright/test`, `playwright-core`) 1.65.1 | every route | Apache-2.0 | test dependency |
| ios_webkit_debug_proxy 1.9.3 | iOS | BSD-3-Clause | separate program, run only |
| libimobiledevice 1.4.0, libplist 2.8.1 | iOS (linked by the proxy) | LGPL-2.1-or-later | libraries of a program run only |
| libusbmuxd 2.1.1 | iOS (linked by the proxy) | LGPL-2.1 (library) | as above |
| iproxy (ships with libusbmuxd) | real iPhone: forwards WebDriverAgent's port over USB | GPL-2.0 | separate program, run only, never linked, bundled or shipped: allowed (Shyden, 2026-11-18) |
| WebDriverAgent (appium-webdriveragent) | iOS input | Apache-2.0 (package), BSD (WebDriverAgent's own licence file) | built and run on the device |
| Android platform tools (`adb`) 37.0.1 | Android | Apache-2.0 (its NOTICE.txt) | separate program, run only |

No GPL, AGPL or SSPL code is linked, imported, bundled or shipped by any route.

## Recommended route per platform

- **iOS (real iPhone):** `ios-webkit`: Playwright over ios_webkit_debug_proxy for reading and asserting, WebDriverAgent for real input, one Safari tab.
- **Android:** `android-cdp` keeps the most of Playwright (its own contexts, `baseURL`, touch). `android-playwright` works equally well for the journey.
- **iOS Simulator:** the same `ios-webkit` route as the real iPhone, on GitHub's macOS machines rather than the 8 GB Mac.
- **Android emulator:** either Android route, on GitHub's Linux machines, starting only once Google Play has finished updating.

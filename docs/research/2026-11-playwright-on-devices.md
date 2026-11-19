# Playwright on real devices, simulators and emulators (November 2026)

Findings for shyden-labs/playwright-devices#7: can one unchanged Playwright test (`page.goto`, `toBeVisible()` and `toHaveText()`, a real tap, real typing, a real finger scroll) run on Safari on iPhone and the iOS Simulator, and on Chrome on Android and its emulator? Every result below links the evidence kept in `research/devices/evidence/`.

**Status: draft.** The iOS Simulator and the Android emulators are not measured yet; their rows say so.

## Summary

| Target | Result | Route | Evidence |
| --- | --- | --- | --- |
| Real iPhone, Safari | **Works** (20 of 20) | `ios-webkit`: Playwright reads and asserts over ios_webkit_debug_proxy; taps, keys and the finger scroll go through WebDriverAgent | [all-devices-repeat20-2026-11-17.txt](../../research/devices/evidence/all-devices-repeat20-2026-11-17.txt), [ios-wda-journey.txt](../../research/devices/evidence/ios-wda-journey.txt) |
| Real Android phone, Chrome | **Works** (20 of 20 on each route) | `android-cdp` (`chromium.connectOverCDP` over an adb forward) and `android-playwright` (`_android`) | [all-devices-repeat20-2026-11-17.txt](../../research/devices/evidence/all-devices-repeat20-2026-11-17.txt) |
| iOS Simulator (iPhone, iPad), Safari | Not yet measured | `ios-webkit` with `IOS_SIMULATOR=1`; the proxy reaches the simulator, but the journey has not run (below) | [ios-simulator-iwdp-socket-2026-11-17.txt](../../research/devices/evidence/ios-simulator-iwdp-socket-2026-11-17.txt) |
| Android emulator (phone, tablet or foldable), Chrome | Not yet measured | the two Android routes | |
| Native pickers (`<select>`, file, photo) | **Works** on Android (10 of 10 on each route); **partly** on the iPhone (all three reached; the `<select>` step fails 6 of 10 after a passing run, shyden-labs/playwright-devices#25) | the fixture's `nativeChoose`, `nativeChooseFile`, `nativeChoosePhoto`: real touches on the phone's own lists (uiautomator + `adb input` on Android, WebDriverAgent on iOS) | [native-select-2026-11-18.txt](../../research/devices/evidence/native-select-2026-11-18.txt), [native-file-picker-2026-11-18.txt](../../research/devices/evidence/native-file-picker-2026-11-18.txt), [native-photo-picker-2026-11-18.txt](../../research/devices/evidence/native-photo-picker-2026-11-18.txt), [ios-select-flake-2026-11-18.txt](../../research/devices/evidence/ios-select-flake-2026-11-18.txt) |

Measured with Playwright 1.65.1, macOS 27.2.1 and Xcode 27.2. iPhone: iPhone18,4, iOS 27.2, WebDriverAgent built from appium-webdriveragent 14.1.1 (to reconcile: its `/status` on the iPhone reported version 17.0.11), ios_webkit_debug_proxy 1.9.3. Android: OnePlus CPH2653, Android 16, Chrome 157.0.8103.50.

## iPhone: why Playwright alone is not enough

- Playwright has no iOS device support of its own. `webkit.connectOverCDP` to ios_webkit_debug_proxy is accepted ([ios-iphone-cdp.txt](../../research/devices/evidence/ios-iphone-cdp.txt)); `chromium.connectOverCDP` is refused (`Browser.getVersion` not found).
- Over that connection Playwright cannot create a context or a page ("Not supported"), so the test is given Safari's one open tab. It must be the only tab: Playwright waits on every tab the proxy lists, and a background tab never answers ([ios-webkit-background-tab-hang.txt](../../research/devices/evidence/ios-webkit-background-tab-hang.txt)).
- Playwright's input on this route is page JavaScript faking events, not real input ([ios-webkit-input-is-synthetic.txt](../../research/devices/evidence/ios-webkit-input-is-synthetic.txt)). So taps, typing and the finger scroll are sent as real touches and keys by WebDriverAgent, while Playwright still navigates, reads and asserts. The test body is unchanged; the fixture (`research/devices/device-fixture.ts`) chooses the route from `DEVICE_ROUTE`.
- ios_webkit_debug_proxy listens on every network address and has no option to stop that, so a pf rule keeps ports 9221-9322 to the Mac (shyden-labs/playwright-devices#19, `research/devices/mac-setup/`).

## Android

Both routes pass the unchanged journey with real input, sent through Android's own input service (`adb shell input`). Chrome opens its DevTools socket only once it runs in the foreground, so the `android-cdp` route starts Chrome cold and waits for the socket. One swipe in an early run did not scroll; it was not reproduced in 80 further runs (shyden-labs/playwright-devices#18).

## Native pickers

The journey taps the page's `<select>`, file input and image input, then touches the phone's own native UI, never the page's script:

- **`<select>`:** Android's Chrome opens a native list (found in `uiautomator dump`, touched with `adb shell input tap`); iOS Safari opens a native menu of buttons (found and touched through WebDriverAgent).
- **File:** on Android, the chooser's *Files*, then the file, which the fixture pushed to Downloads and had indexed. On the iPhone, *Choose File* > *Browse* > *On My iPhone* > the WebDriverAgent runner's folder > the file, which the fixture copied there with `devicectl`. The runner lists in Files because the run script adds `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` to the built runner and signs it again with its own certificate. Files cells open only on a tap on the icon, not on the name.
- **Photo:** Google's photo picker on Android (a fixture image pushed first, so it is the newest) and *Photo Library* on the iPhone (the library's own first photo); both select on tap and return on *Done*. The page shows only the file's kind, because a photo's name and date are personal.
- A failed native step attaches the phone's screen by path into the git-ignored run folder, and teardown closes a picker left open, so it cannot swallow the next run's first touch.

## iOS Simulator (in progress)

- The simulator's Web Inspector socket is the simulator's own `RWI_LISTEN_SOCKET` (`xcrun simctl getenv <udid> RWI_LISTEN_SOCKET`), not the proxy's default; given that socket, the proxy lists Safari's pages (measured 2026-11-17 23:18).
- WebDriverAgent runs in the simulator ad-hoc signed, started alone before Safari; it is refused as "Busy" if it starts while Safari opens.
- Not yet settled: on 2026-11-18 the proxy listed no page, or listed pages one event late. Every such run so far had swap above 9 GB on this 8 GB Mac, so memory pressure is the first suspect. `research/devices/run-ios-simulator-journey.zsh` is the run script.

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
- **iOS Simulator, Android emulator:** pending their measurements.

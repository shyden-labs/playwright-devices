# Phone release: the real-phone layer as part of the package (shyden-labs/playwright-devices#54)

Status: self-approved after an inline review to zero (Shyden's standing rule for specs, 2026-09-24), 2026-11-25. The approach is Shyden's choice ("package it properly", AskUserQuestion 2026-11-25 22:3x WIB).

## Intent

ShyDesk (shyden-labs/shydesk#176) and every later project should run their own Playwright suite on the real iPhone (Safari) and the real Android phone (Chrome) by installing `@shyden-labs/playwright-devices` from npm. Today the layer that does this lives only in `research/devices/` and drives one hard-wired journey page. It passed on every real phone on d121daf (2026-11-25), but the published package (0.1.5) ships only the desktop browsers and the one-suite checks.

## Goals

1. A project's own tests, written against Playwright's `test` and `page`, run on the real iPhone and the real Android phone (both routes) with real input: taps and keys from the phone, never synthetic events.
2. One command starts the phone side, runs the project's command, and stops everything it started, pass or fail.
3. Native pickers (option, file, photo) are steps a test can call, with the project's own files.
4. Setup is written down: what the Mac needs once, and what each run needs.
5. The research journey runs through the packaged code, so the release is proven by the same journey on every phone (AC1), and again from a clean install (AC4).

## Non-goals

- Simulators and emulators: they stay in shyden-labs/playwright-devices#7 and shyden-labs/playwright-devices#38 and are documented as still being measured. The research script keeps running them until then.
- New input methods. Input the layer does not route (`fill`, `press`, `hover`, `selectOption`, …) keeps failing by name; it never falls back to Playwright's synthetic events.
- Shipping WebDriverAgent. The package builds it on the Mac from a source the user names; nothing from it is bundled.

## Anti-goals

- A phone run that passes without real input, or skips a test.
- A start command that leaves WebDriverAgent, iproxy, ios_webkit_debug_proxy or Chrome running after it ends.
- Shyden's signing team or bundle id hard-coded in the published code.

## Approaches considered

1. **Package it properly (chosen by Shyden).** The layer moves into `src/devices/` with a public entry point and a command.
2. **Minimal export.** Export the research files as they are, with the zsh script shipped for projects to run. Faster, but the fixture is tied to the journey page and fixed files, so ShyDesk would port twice.
3. **Merge without npm.** Cheapest now; ShyDesk keeps waiting for shyden-labs/playwright-devices#7.

## Design

### Entry point `@shyden-labs/playwright-devices/phones`

- `test`: Playwright's `test` extended with:
  - `page`: the phone's page behind the real-input stand-in (today's `realInputPage`): `click`/`tap` become real taps at the element's screen point, `keyboard.type` becomes real keys, and reads and assertions go to the real page.
  - `nativeChoose(option)`, `nativeChooseFile()`, `nativeChoosePhoto()`, `fingerScroll()`: today's `DeviceSession` steps, each shown as a named step in the report.
  - On failure, the device's own screenshot is attached (as today).
  - Option fixture `phoneFiles: { document: string; photo: string }` (absolute paths, set with `test.use`): the files the pickers offer. The package ships today's two journey files as the default. The fixture puts them on the phone itself: Android through adb (as today), and the iPhone's document into the WebDriverAgent runner's Documents with `xcrun devicectl device copy to` (moved here from the run script, so the test and its file can never disagree). On the iPhone, `nativeChoosePhoto` picks the Photo Library's first photo (as today), and `photo` is used on Android only. The README says so.
- `expect`: re-exported from `@playwright/test`.
- `phoneProjects(routes?)`: Playwright projects named `iphone`, `android-cdp` and `android-playwright` (or a declared few), one worker, no retries, and the device-route setting each fixture reads. An unknown or repeated name is refused, naming it (as `desktopProjects` does).
- `phoneGroup(routes?)`: the one-suite group for those names, so the same totals checks cover phones.
- `lanBaseURL(port)`: `http://<this Mac's LAN IPv4>:<port>`, the address the phone can reach. It fails naming the reason when the Mac has no LAN address. A project's web server must listen on that address. Today's `serve.ts` logic is reused.

The route comes from the project's name (`testInfo.project.name`), not from an environment variable. `start` records which target it started (`PLAYWRIGHT_DEVICES_TARGET=iphone|android`), and the fixture refuses a project that does not match it, naming both: running `iphone` under `start android` fails at once rather than timing out. The device-side addresses (WebDriverAgent, the Safari proxy, the Android serial and CDP port) come from environment variables that the start command sets, with today's defaults.

### Command `playwright-devices`

```
playwright-devices setup iphone <udid> --team <id> --profile <name> --bundle <id> --wda-source <dir>
playwright-devices start iphone <udid> -- <command...>
playwright-devices start android <serial> -- <command...>
```

- `setup iphone` builds and signs WebDriverAgent once (today's `run-ios-journey.zsh --build` steps, the file-sharing keys included) into `~/Library/Caches/playwright-devices/wda`, recording which team, profile and bundle it used.
- `start iphone` does today's iPhone device side: it refuses to start if port 8100 or 9222 is already held (naming the holder), checks the pf rule, then starts iproxy and WebDriverAgent. It fails within 5 s of xcodebuild exiting before WebDriverAgent answers, printing the log's failure line (this folds in shyden-labs/playwright-devices#57). It starts ios_webkit_debug_proxy, opens one Safari tab, and then runs the command. Each launch gets its own log (shyden-labs/playwright-devices#55's naming).
- `start android` sets `ANDROID_SERIAL` and checks that adb lists the device. The fixture already starts and stops Chrome itself.
- After the command exits, everything started is stopped in reverse order, and the exit code is the command's own. Ctrl-C and SIGTERM stop everything too.
- Written in TypeScript in `src/devices/cli/`, with each process start going through one injected `spawn` so unit tests mock it (no unit test starts a process).

### Code moves

`research/devices/{device-session, real-input-page, wda-client, screen-map, screen-marker, finger-scroll, ios-native, android-native, android-page-map, android-screen, android-chrome-start, serve}.ts` move to `src/devices/`, with history kept (`git mv`). Their unit tests already exist and move with them. `research/devices/journey.spec.ts` imports `test` from `src/devices/phones.ts`, and its config uses `phoneProjects()`. For phones, `run-journey.zsh` becomes a thin wrapper around `playwright-devices start`; it keeps its simulator and emulator paths and its evidence copy.

### Docs

README section "Real phones": the Mac's one-time setup (Xcode, the signing profile, `setup iphone`, libimobiledevice and ios_webkit_debug_proxy from Homebrew, the pf rule in `research/devices/mac-setup/` moved to `mac-setup/` and shipped, and on Android the developer options, USB debugging and Chrome's "Select debug app"), the iPhone's settings (Developer Mode, Settings > Developer > Enable UI Automation, unlocked), one example config and test, the routed input list, and what is still being measured (simulators and emulators: shyden-labs/playwright-devices#7, shyden-labs/playwright-devices#38).

### Proof

1. Unit: every moved file keeps its tests. The new `phoneProjects`, `phoneGroup`, `lanBaseURL`, fixture option and CLI each get tests written first and seen red. Coverage stays at the repo's figure.
2. AC1: on the release head, the journey through `playwright-devices start` on the iPhone and on the OnePlus (both routes), on one commit, with the reports kept.
3. AC4: in a scratch project outside the repo, `npm install` of the packed tarball (then of the published version), with a one-test suite using `phoneProjects()`, run through `start` on both phones; output kept.

## Left to the builder

- File layout inside `src/devices/` and the CLI's argument parser (no new dependency unless its licence passes and a hand-written parser would be worse).
- The default-files location in the package (`files` must include them).
- The exact error wording, keeping today's "names the cause" style.

## Parked for Shyden (does not block the build)

- None so far. Signing values are options, so publishing ties no team id to the package.

## Relation to open work

- shyden-labs/playwright-devices#55 (one log per launch) and shyden-labs/playwright-devices#57 (fail fast when xcodebuild exits) are both built into `start`'s TypeScript. PR shyden-labs/playwright-devices#58 changes the zsh script on `38-sims-in-ci`; the simulator path keeps that change until shyden-labs/playwright-devices#7 moves simulators onto `start`.
- The research script's simulator and emulator paths stay as they are, so shyden-labs/playwright-devices#38's CI rounds keep running unchanged.

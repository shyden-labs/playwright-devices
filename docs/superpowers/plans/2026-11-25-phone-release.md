# Phone Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the real-phone layer in `@shyden-labs/playwright-devices`: a `phones` entry point (fixture, projects, group, LAN address) and a `playwright-devices` command that sets up and starts the phone side around a project's own command.

**Architecture:** The research files move into `src/devices/` unchanged in behaviour. A new fixture reads its route from the Playwright project's name and takes every outside effect (connect, adb, devicectl) through injected functions, so unit tests mock them. The command's start logic takes one injected `Spawner`, so no unit test starts a process.

**Tech Stack:** TypeScript (Node 26, ESM, `.ts` imports rewritten on build), Playwright Test 1.65, Vitest (unit, 100% coverage over `src/**` and `scripts/**`), zsh for the research script.

**Spec:** `docs/superpowers/specs/2026-11-25-phone-release-design.md`

## Global Constraints

- Branch `54-phone-release` off `7-devices-test-first` (develop already merged in); squash-merged into `develop` by PR.
- Strict TDD: every new or changed behaviour has its test run red first; mutate the code once while writing each test, then put it back.
- Unit tests never start a process or open a socket (`tests/setup/unit-refusal.ts` refuses both); every unit test runs in under 1 s.
- Coverage stays at 100% lines, branches, functions and statements over `src/**/*.ts` and `scripts/**/*.ts`.
- Input not routed to the phone fails by name (`not routed to real input yet: <method>`); never a synthetic fallback.
- No retry anywhere; a wait has a stated ceiling and fails naming what it waited for.
- Commit messages say `Refs shyden-labs/playwright-devices#54`, never a closing keyword.
- Before every commit: `npm run -s format:check && npm run -s lint && npm run -s typecheck && npm run -s test:unit`, all passing.
- Signing values (team, profile, bundle) are command options; none is in `src/`.
- Route names: projects `iphone`, `android-cdp`, `android-playwright`; targets `iphone`, `android`.

## Review Focus

1. A phone unplugged or locked mid-run: `start` still stops every process it started, and exits non-zero naming the command's failure. Test in Task 5.
2. A port (8100 or 9222) still held by a crashed earlier run: `start iphone` refuses before starting anything, naming the holder's `lsof` line. Test in Task 5.
3. Ctrl-C (SIGINT) while waiting for WebDriverAgent: everything already started is stopped, and the exit code is 130. Test in Task 5.
4. Running project `iphone` under `start android` (or with no `start` at all): the fixture fails at once, naming the project and the target. Test in Task 4.
5. A Mac with no LAN IPv4 (Wi-Fi off): `lanBaseURL` fails naming that the phone cannot reach this Mac. Test in Task 3.

---

### Task 1: Move the device library into `src/devices/` at 100% coverage

**Files:**
- Move (`git mv`): `research/devices/{device-session,real-input-page,wda-client,screen-map,screen-marker,finger-scroll,ios-native,android-native,android-page-map,android-screen,android-chrome-start,serve}.ts` → `src/devices/`
- Modify: every importer (`research/devices/device-fixture.ts`, `research/devices/probes/*.ts`, `tests/unit/*.test.ts`): paths only
- Modify: `tsconfig.build.json` `include` adds `"src/devices/**/*.ts"`
- Test: the existing unit tests for these files, plus new tests for any line the coverage run shows uncovered

**Interfaces:**
- Produces: the same exports at `src/devices/<file>.ts` (e.g. `iosSession`, `androidSession`, `withNamedSteps`, `realInputPage`, `connectWda`, `startChromeCold`, `stopChromeAfterPlaywright`, `requireChromeDebugApp`, `lanAddress`, `startJourneyServer`, `ROUTES`, `type Route`, `type Adb`, `type DeviceSession`).

- [ ] **Step 1:** `git mv` the twelve files, and fix the imports with paths only. Run `npm run -s typecheck && npm run -s test:unit`. Expected: both pass (a pure move).
- [ ] **Step 2:** Run `npm run -s test:coverage`. Expected: below 100% wherever the moved files have untested lines; write the uncovered file:line list to `.superpowers/sdd/54/coverage-after-move.txt`.
- [ ] **Step 3:** For each uncovered line, write the unit test that reaches it (behaviour first, never a test that only executes the line). Run it red by mutating the line (e.g. invert its condition), then restore the line.
- [ ] **Step 4:** Run `npm run -s test:coverage`. Expected: 100% on all four measures.
- [ ] **Step 5:** Commit: "Move the device library into src/devices with its tests, at 100% coverage".

### Task 2: `phoneProjects` and `phoneGroup`

**Files:**
- Create: `src/devices/phone-projects.ts`
- Test: `tests/unit/phone-projects.test.ts`

**Interfaces:**
- Produces: `export const PHONE_PROJECTS = ['iphone', 'android-cdp', 'android-playwright'] as const; export type PhoneProject = (typeof PHONE_PROJECTS)[number];` `export function phoneProjects(names?: readonly string[]): PlaywrightTestProject[]` `export function phoneGroup(names?: readonly string[]): { phones: string[] }` `export function routeOfProject(name: string): Route` (`iphone` → `ios-webkit`, otherwise the same name) `export function targetOfProject(name: PhoneProject): 'iphone' | 'android'`.

- [ ] **Step 1: Write the failing tests:**
  - `phoneProjects()` returns three projects named as in `PHONE_PROJECTS`, each with `retries: 0` (one worker is the project config's `workers: 1`, which the README example sets);
  - `phoneProjects(['iphone'])` returns one;
  - `phoneProjects(['ipad'])` throws `unknown phone project: ipad (known: iphone, android-cdp, android-playwright)`;
  - `phoneProjects(['iphone', 'iphone'])` throws `phone project named twice: iphone`;
  - `phoneGroup()` equals `{ phones: ['iphone', 'android-cdp', 'android-playwright'] }`;
  - `routeOfProject('iphone') === 'ios-webkit'`;
  - `routeOfProject('chromium')` throws `not a phone project: chromium`;
  - `targetOfProject('android-cdp') === 'android'`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/phone-projects.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement in `src/devices/phone-projects.ts`, reusing the refusal shape of `src/desktop/browsers.ts`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: `lanBaseURL`

**Files:**
- Create: `src/devices/lan.ts`
- Modify: `src/devices/serve.ts` (uses `lanAddress` from `lan.ts`; `lanAddress` moves there)
- Test: `tests/unit/lan.test.ts`

**Interfaces:**
- Produces: `export function lanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string` (moved, unchanged) `export function lanBaseURL(port: number, interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): string` (default `os.networkInterfaces()`).

- [ ] **Step 1: Write the failing tests:**
  - `lanBaseURL(4321, { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.3', … }] }) === 'http://192.168.1.3:4321'`;
  - with only `lo0`, it throws `this Mac has no LAN IPv4 address, so a phone cannot reach it: join the phone's Wi-Fi`;
  - `lanBaseURL(0, …)` and `lanBaseURL(70000, …)` throw `port must be 1-65535: <n>`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. (`lanAddress`'s existing error message changes to the one above; its tests follow.)
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 4: The `phones` fixture

**Files:**
- Create: `src/devices/phones.ts` (the public entry: `test`, `expect`, `phoneProjects`, `phoneGroup`, `lanBaseURL`, `PHONE_PROJECTS`)
- Create: `src/devices/phone-connect.ts` (today's `connect()` from `research/devices/device-fixture.ts`, taking its effects as arguments)
- Create: `src/devices/phone-files/device-journey.txt`, `src/devices/phone-files/device-journey.png` (`git mv` from `research/devices/fixtures/`)
- Test: `tests/unit/phone-connect.test.ts`, `tests/unit/phones.test.ts`

**Interfaces:**
- Consumes: Task 1's sessions, `routeOfProject` and `targetOfProject` (Task 2).
- Produces:
  - `export interface PhoneFiles { document: string; photo: string }` `export const DEFAULT_PHONE_FILES: PhoneFiles` (absolute paths to `src/devices/phone-files/…`, resolved from `import.meta.url`).
  - `export interface ConnectEffects { webkitOverCDP(url: string): Promise<Browser>; chromiumOverCDP(url: string): Promise<Browser>; androidDevices(): Promise<AndroidDevice[]>; connectWda(url: string): Promise<IosDevice>; adbFor(serial: string): Adb; copyToIphone(udid: string, file: string): Promise<void> }` `export const REAL_EFFECTS: ConnectEffects`.
  - `export async function connectPhone(project: string, env: NodeJS.ProcessEnv, baseURL: string, files: PhoneFiles, effects: ConnectEffects): Promise<Connection>` where `Connection = { session: DeviceSession; disconnect(): Promise<void> }`.
  - `test` fixtures: `phoneFiles` (option, default `DEFAULT_PHONE_FILES`), `session`, `page`, `nativeChoose`, `nativeChooseFile`, `nativeChoosePhoto`, `fingerScroll`. `baseURL` comes from Playwright's `use.baseURL`, and the fixture fails `set use.baseURL to lanBaseURL(<port>): the phone opens pages there` when it is unset.

- [ ] **Step 1: Write the failing tests in `phone-connect.test.ts`** (all effects are mocks):
  - project `iphone` with `PLAYWRIGHT_DEVICES_TARGET=iphone`, `IOS_UDID=U`: calls `copyToIphone('U', files.document)` before `connectWda`, connects `webkitOverCDP('http://127.0.0.1:9222')`, and refuses a browser with 2 tabs: `Safari must have exactly one tab open; it has 2`;
  - project `iphone` with `PLAYWRIGHT_DEVICES_TARGET=android`: throws `project iphone needs \`playwright-devices start iphone\`; this run was started for android`, calling no effect;
  - project `android-cdp` with no `PLAYWRIGHT_DEVICES_TARGET`: throws `project android-cdp needs \`playwright-devices start android\`; this run was not started by it`;
  - project `android-playwright` with serial `S` not in `androidDevices()`: throws `Playwright lists no Android device S`;
  - `disconnect()` on android-cdp closes the page, then the browser, then stops Chrome, and still stops Chrome when `browser.close` rejects.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `connectPhone` from today's `connect()`; `REAL_EFFECTS.copyToIphone` runs `xcrun devicectl device copy to --device <udid> --domain-type appDataContainer --domain-identifier <IOS_RUNNER_ID or uk.co.shyden.WebDriverAgentRunner.xctrunner> --source <file> --destination Documents/<basename>` through `execFile` with a 30 s ceiling. `REAL_EFFECTS` is unit-tested like the repo's other default runners: `vi.mock('node:child_process')` and `vi.mock('@playwright/test')` stand in, and each effect's call and error message are asserted (the repo has no coverage exclusions, and gets none).
- [ ] **Step 4: Write the failing tests in `phones.test.ts`:** `phones.ts` exports exactly `test`, `expect`, `phoneProjects`, `phoneGroup`, `lanBaseURL`, `PHONE_PROJECTS`, `DEFAULT_PHONE_FILES`; both default files exist on disk.
- [ ] **Step 5:** Implement `phones.ts` (today's `test.extend` from `device-fixture.ts`, minus `journeyURL`, plus the `phoneFiles` option and the `baseURL` check). Run both test files. Expected: PASS.
- [ ] **Step 6:** Commit.

### Task 5: `playwright-devices start`

**Files:**
- Create: `src/devices/cli/spawner.ts`, `src/devices/cli/start.ts`
- Test: `tests/unit/start.test.ts`

**Interfaces:**
- Produces:
  - `export interface Spawned { pid: number; exited: Promise<number>; kill(signal?: NodeJS.Signals): void }` `export interface Spawner { spawn(command: string, args: string[], options: { logFile?: string; env?: NodeJS.ProcessEnv; inherit?: boolean }): Spawned; run(command: string, args: string[]): Promise<{ code: number; stdout: string }>; get(url: string): Promise<string | null>; sleep(ms: number): Promise<void>; now(): number; readFile(path: string): Promise<string> }` `export const NODE_SPAWNER: Spawner`.
  - `export interface StartOptions { target: 'iphone' | 'android'; id: string; command: string[]; logDir: string; stamp: string; signal: AbortSignal }` `export async function start(options: StartOptions, spawner: Spawner): Promise<number>` (the exit code).
- iPhone order (today's `run-journey.zsh iphone`): port check (`lsof -nP -iTCP:<port> -sTCP:LISTEN` for 8100, 9222) → pf rule check (`/etc/pf.shyden.conf` contains `port 9221:9322`; `launchctl print system/uk.co.shyden.pf` contains `last exit code = 0`) → `iproxy 8100 8100 -u <udid>` → `xcodebuild test-without-building … -destination id=<udid> -derivedDataPath ~/Library/Caches/playwright-devices/wda/derived` → wait for `GET http://127.0.0.1:8100/status` containing `"ready"`, ceiling 180 s → `ios_webkit_debug_proxy -c <udid>:9222` → open one Safari tab through WebDriverAgent (POST /session, POST url `http://127.0.0.1:9/`, DELETE session) → wait for `http://127.0.0.1:9222/json` containing `webSocketDebuggerUrl`, ceiling 30 s → the command with `PLAYWRIGHT_DEVICES_TARGET=iphone`, `IOS_UDID=<udid>`, inheriting stdio.
- Android: `adb devices` must list `<serial>\tdevice` (else `adb lists no device <serial> ready: plug it in and allow USB debugging`) → the command with `PLAYWRIGHT_DEVICES_TARGET=android`, `ANDROID_SERIAL=<serial>`.
- Logs: `<logDir>/<name>-<stamp>-<pid>.log` for `iproxy`, `wda`, `iwdp`.

- [ ] **Step 1: Write the failing tests** (a fake `Spawner` that records calls and answers scripted results):
  - the iPhone order above, asserted as the recorded call list;
  - port 8100 held: returns 2, prints `port 8100 is already held: <lsof line>`, and spawned nothing;
  - pf rule missing: returns 2, naming `/etc/pf.shyden.conf does not block ports 9221-9322; install mac-setup/ first`, and spawned nothing;
  - xcodebuild's `exited` resolves with 65 at t=63 s while /status never answers: returns 2 within 5 s (fake clock) of the exit, printing the wda log's first line containing `Underlying Error:` or `Testing failed:` and the log path; iproxy is killed;
  - /status not ready by 180 s: returns 2 naming `WebDriverAgent did not answer at http://127.0.0.1:8100/status within 180 s`;
  - the command exits 1: `start` returns 1, and kills iwdp, wda and iproxy in that order;
  - the abort signal fires while waiting for /status: returns 130, and every spawned process is killed;
  - Android, device listed: runs the command with `ANDROID_SERIAL` and `PLAYWRIGHT_DEVICES_TARGET=android`, returning its code; not listed: returns 2 with the message above;
  - log names follow `<name>-<stamp>-<pid>.log`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `start` and `NODE_SPAWNER` (`node:child_process.spawn`, `fetch` with a 2 s timeout for `get`). `NODE_SPAWNER` gets its own tests with `vi.mock('node:child_process')`, `vi.mock('node:fs/promises')` and a stubbed global `fetch` (a `fetch` that rejects gives `get` → `null`).
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 6: `playwright-devices setup iphone`

**Files:**
- Create: `src/devices/cli/setup.ts`
- Test: `tests/unit/setup.test.ts`

**Interfaces:**
- Consumes: `Spawner` (Task 5).
- Produces: `export interface SetupOptions { udid: string; team: string; profile: string; bundle: string; wdaSource: string; wdaDir: string }` `export async function setupIphone(options: SetupOptions, spawner: Spawner): Promise<number>`.
- Steps, as `research/devices/run-ios-journey.zsh` on `7-playwright-on-devices` (lines 55-100) does them: refuse when `<wdaSource>/WebDriverAgent.xcodeproj` is missing → copy the source to `<wdaDir>/src` → set signing with `ruby -rxcodeproj` (the same script, with team/profile/bundle as arguments) → `xcodebuild build-for-testing -quiet … -destination id=<udid> -derivedDataPath <wdaDir>/derived` → add `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` to the runner's Info.plist and re-sign it with its existing identity and entitlements → write `<wdaDir>/setup.json` `{ team, profile, bundle, builtAt }`.

- [ ] **Step 1: Write the failing tests:** the recorded call order; a missing source returns 2 naming the path; a failing build returns its code and writes no `setup.json`; `setup.json` holds exactly the four keys.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 7: The `playwright-devices` command and the package entry

**Files:**
- Create: `src/devices/cli/main.ts`
- Modify: `package.json` (`bin["playwright-devices"] = "dist/src/devices/cli/main.js"`; `exports["./phones"]` → `dist/src/devices/phones.{d.ts,js}`; `files` adds `dist/src/devices/phone-files/` and `mac-setup/`), `package.json` `scripts.postbuild` = `node scripts/copy-phone-files.ts` (tsc does not copy the phone files), `research/devices/mac-setup/` → `mac-setup/` (`git mv`)
- Create: `scripts/copy-phone-files.ts`
- Test: `tests/unit/cli-main.test.ts`, `tests/unit/package.test.ts` (extend), `tests/unit/copy-phone-files.test.ts`

**Interfaces:**
- Produces: `export async function main(argv: string[], spawner: Spawner, signal: AbortSignal): Promise<number>`.
- Usage text (exact): `usage: playwright-devices setup iphone <udid> --team <id> --profile <name> --bundle <id> --wda-source <dir> | start iphone <udid> -- <command...> | start android <serial> -- <command...>`

- [ ] **Step 1: Write the failing tests:** `main(['start','iphone','U','--','npx','playwright','test'])` calls `start` with `{ target: 'iphone', id: 'U', command: ['npx','playwright','test'] }`; a missing `--` or empty command, an unknown target, or a missing setup flag returns 2 printing the usage text; `package.json` has the bin, the `./phones` export and the `files` entries; `copy-phone-files` copies both files into `dist/src/devices/phone-files/`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement (hand-written argument parsing; `main.js` wires `NODE_SPAWNER` and SIGINT/SIGTERM to an `AbortController`).
- [ ] **Step 4:** Run, then `npm run build && npm pack --dry-run | grep -E "phones|phone-files|mac-setup|cli/main"`. Expected: PASS, and all four appear.
- [ ] **Step 5:** Commit.

### Task 8: The research journey runs through the package

**Files:**
- Modify: `research/devices/journey.spec.ts` (imports `test`, `expect` from `../../src/devices/phones.ts`; `test.use({ baseURL })` from a worker fixture that serves `journey.html` on `lanBaseURL`)
- Modify: `playwright.devices.config.ts` (`projects: phoneProjects()`)
- Modify: `research/devices/run-journey.zsh` (`iphone` → `node src/devices/cli/main.ts start iphone <udid> -- npx playwright test -c playwright.devices.config.ts --project iphone`; `android <serial> <route>` → `start android <serial> -- … --project <route>`; `ios-sim` and emulators set `PLAYWRIGHT_DEVICES_TARGET` themselves and pass `--project iphone` or `--project <route>`)
- Delete: `research/devices/device-fixture.ts`

- [ ] **Step 1:** Run `npx playwright test -c playwright.devices.config.ts --list`. Expected: 3 tests (one per project), each named the same journey.
- [ ] **Step 2:** Claim the phones (holder line `measures shyden-labs/playwright-devices#7`); run `run-journey.zsh iphone 00008150-000954D90A20401C`, `android 3b402284 android-cdp` and `android 3b402284 android-playwright` on one commit, keeping stderr; release the phones. Expected: 3 passed. Needs Shyden only if WebDriverAgent reports "enabling automation mode" (then park it and tell him).
- [ ] **Step 3:** Commit the evidence with the change.

### Task 9: README "Real phones" and the PR

**Files:**
- Modify: `README.md` (new section "Real phones" after "Desktop browsers": the one-time Mac setup, the iPhone's settings, the Android settings, an example `playwright.config.ts` with `phoneProjects()` and `use: { baseURL: lanBaseURL(4173) }`, an example test using `nativeChooseFile`, the note that on the iPhone `nativeChoosePhoto` picks the Photo Library's first photo and `phoneFiles.photo` is used on Android only, the routed-input list (`click`, `tap`, `keyboard.type`, the native steps, `fingerScroll`) and the refused list, and "Simulators and emulators: still being measured (shyden-labs/playwright-devices#7, shyden-labs/playwright-devices#38)")
- Test: `tests/unit/repo-basics.test.ts` (extend: README names `phoneProjects`, `lanBaseURL` and `playwright-devices start`)

- [ ] **Step 1:** Write the failing README test; run it red; write the section; run it green.
- [ ] **Step 2:** Push `54-phone-release`; open the PR into `develop` (`Refs shyden-labs/playwright-devices#54`); wait for every check by name on the head SHA; fix SonarCloud findings as suggested.
- [ ] **Step 3:** Clean install (AC4): in the scratchpad, `npm init -y`, `npm install <packed tarball>`, one test using `phoneProjects()` and `nativeChooseFile`, run through `npx playwright-devices start` on the iPhone and both Android routes; keep the output in `.superpowers/sdd/54/clean-install/`.
- [ ] **Step 4:** Merge to `develop` once green; the release cut and the npm publish are Shyden's.

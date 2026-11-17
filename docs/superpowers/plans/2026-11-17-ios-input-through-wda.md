# Real iOS input through WebDriverAgent: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `research/devices/journey.spec.ts` runs unchanged on the `ios-webkit` route with every tap, key and scroll sent by WebDriverAgent.

**Architecture:** `ios-wda-page.ts` wraps Playwright's `Page` and `Locator` in JavaScript `Proxy` objects that send input to an `IosInput`; `wda-input.ts` implements `IosInput` over WebDriverAgent's HTTP API; `device-fixture.ts` wires both on `ios-webkit`.

**Tech Stack:** TypeScript, @playwright/test 1.65.1, Vitest (unit), WebDriverAgent 17.0.11 (appium-webdriveragent, Apache-2.0), ios_webkit_debug_proxy.

**Spec:** `docs/superpowers/specs/2026-11-17-ios-input-through-wda-design.md`

## Global Constraints

- playwright-core is not modified.
- No input falls back to Playwright's synthetic events; an unrouted input method throws `not routed to WebDriverAgent yet: <method>`.
- Unit tests live in `tests/unit/`, mock the page, locator and WDA call; no fetch, no process (`tests/setup/unit-refusal.ts`), under 1 s each.
- Each test is written and run red before its code.
- WebDriverAgent's address comes from `WDA_URL` (default `http://127.0.0.1:8100`); the page host from `PAGE_HOST` (the phone cannot reach `localhost`).

## Review Focus

1. A target outside the visible viewport (box below the fold): `tap` throws naming the locator and its box, never taps the wrong spot. Test in Task 1.
2. A locator with no box (hidden or detached): `tap` throws `has no box`. Test in Task 1.
3. Chained locators (`page.locator('form').getByLabel('Name')`, `.first()`, `.nth()`): still wrapped, so `.tap()` stays real. Test in Task 1.
4. A WDA HTTP error: the thrown error names method, path and status. Test in Task 2.
5. An absolute `goto` URL passes through unchanged; a relative one gets `http://PAGE_HOST:4517`. Test in Task 1.

---

### Task 1: The wrapped page

**Files:**
- Create: `research/devices/ios-wda-page.ts`
- Test: `tests/unit/ios-wda-page.test.ts`

**Interfaces:**
- Produces:
  - `interface Box { x: number; y: number; width: number; height: number }`
  - `interface IosInput { tapAt(box: Box): Promise<void>; type(text: string): Promise<void> }`
  - `function wrapPageForWda(page: Page, input: IosInput, baseURL: string): Page`

- [ ] **Step 1: Write the failing tests** (each its own `test`, page/locator are plain mock objects cast to `Page`/`Locator`):
  - `goto('/journey.html')` calls the real `goto` with `http://10.0.0.2:4517/journey.html`; `goto('https://a.test/x')` passes `https://a.test/x`.
  - `getByRole('button', {name:'Tap me'}).tap()` calls `boundingBox()` then `input.tapAt({x:10,y:20,width:30,height:40})`, never the real `tap`.
  - `.click()` does the same.
  - `boundingBox()` returning `null` → rejects with `/has no box/`.
  - box with `y` beyond `page.viewportSize().height` (mock 800, box y 900) → rejects with `/outside the viewport/`.
  - `page.locator('form').getByLabel('Name').tap()` and `getByTestId('x').first().tap()` reach `input.tapAt`.
  - `keyboard.type('Ayu')` calls `input.type('Ayu')`.
  - `fill`, `press`, `hover`, `dblclick` on a locator, and `page.mouse`, `page.touchscreen` access, throw `not routed to WebDriverAgent yet: <name>`.
  - Any other property (`textContent`, `page.url`) returns the real one, bound to the real object.
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/ios-wda-page.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `wrapPageForWda`** with `Proxy` handlers; locator-returning names (`locator`, `getByRole`, `getByLabel`, `getByTestId`, `getByText`, `first`, `last`, `nth`, `filter`) return wrapped locators. If `page.viewportSize()` is `null`, read it with `page.evaluate(() => ({ width: innerWidth, height: innerHeight }))`.
- [ ] **Step 4: Mutate once**: change `tapAt` to call the real `tap`; see the tap tests fail; revert. Run the file again. Expected: PASS.
- [ ] **Step 5: Lint, typecheck, format check, commit** `Wrap Playwright's page so iOS taps and keys go to WebDriverAgent (Refs shyden-labs/playwright-devices#7)`.

### Task 2: WebDriverAgent input

**Files:**
- Create: `research/devices/wda-input.ts`
- Test: `tests/unit/wda-input.test.ts`

**Interfaces:**
- Consumes: `Box`, `IosInput` from Task 1.
- Produces:
  - `type WdaCall = (method: string, path: string, body?: unknown) => Promise<unknown>`
  - `function wdaHttp(baseUrl: string): WdaCall` (fetch; error text `WDA <method> <path> <status>: <value, 200 chars>`; as in `ios-wda.device.ts:17`)
  - `async function openWdaInput(call: WdaCall, page: Page): Promise<IosInput & { swipeUp(): Promise<void>; close(): Promise<void> }>`

- [ ] **Step 1: Write the failing tests** with a recording mock `call` and mock `page.evaluate`:
  - opening posts `/session` with `{capabilities:{alwaysMatch:{}}}`; `close()` sends `DELETE /session/<id>`.
  - `tapAt(box)`: adds the marker, reads `accessibility id` rect (mock `{x:0,y:68,width:100}`; scale 1), removes the marker, then posts `/session/<id>/actions` with one touch pointer: move to `(x+width/2, 68+y+height/2)` rounded, down, up.
  - `type('Ayu')` posts `/wda/keys` `{value:['A','y','u']}`.
  - `swipeUp()` reads `GET /session/<id>/window/size` (mock 420x912) and swipes x 210 from y 410 to 137 (45% → 15%, rounded) with a 400 ms move.
  - `wdaHttp`: a non-ok response rejects with `WDA POST /x 500: ...` (fetch mocked with `vi.stubGlobal`).
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/wda-input.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement**, moving the marker method out of `ios-wda.device.ts` (that file then imports it).
- [ ] **Step 4: Mutate once** (drop the toolbar origin from the point); see the tap test fail; revert. Run again. Expected: PASS.
- [ ] **Step 5: Lint, typecheck, format check, commit** `Send real iOS taps, keys and swipes through WebDriverAgent (Refs shyden-labs/playwright-devices#7)`.

### Task 3: Wire the route and measure on the iPhone Air

**Files:**
- Modify: `research/devices/device-fixture.ts` (the `ios-webkit` branch and `fingerScroll`)
- Evidence: `research/devices/evidence/ios-wda-journey.txt`, `ios-wda-journey.json`

- [ ] **Step 1:** In the `ios-webkit` branch, open `openWdaInput(wdaHttp(WDA_URL), page)`, `use(wrapPageForWda(page, input, \`http://${PAGE_HOST}:${serverPort}\`))`, and `close()` it in `finally`. `fingerScroll` on `ios-webkit` calls the same input's `swipeUp()` (share it through a worker-less test fixture `iosInput`).
- [ ] **Step 2:** Claim the phones (`usb-devices` lock), `lsof -iTCP:8100 -iTCP:8101 -sTCP:LISTEN` before; start iwdp and WDA as in the handover.
- [ ] **Step 3: First measurement**: run the journey (`DEVICE_ROUTE=ios-webkit`). If `expect` refuses the wrapped locator, stop and ask Shyden (spec).
- [ ] **Step 4:** Keep the run's output and JSON report as evidence, with iOS, Xcode, Playwright and WDA versions. Expected: 4 soft-assertion groups pass; if any fails, record the error text.
- [ ] **Step 5:** Re-run the Android route unchanged (every device, every time); keep its evidence.
- [ ] **Step 6:** Stop iwdp and WDA, `lsof` after, release the lock; commit `Run the unchanged journey on real iPhone Safari with real input through WebDriverAgent (Refs shyden-labs/playwright-devices#7)`.

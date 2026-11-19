# Real iOS input for the unchanged journey through WebDriverAgent (design)

Refs shyden-labs/playwright-devices#7 (AC 1). Short design: a small change to the research fixture.

## Intent

The unchanged journey (`research/devices/journey.spec.ts`) must pass on real iPhone Safari with
real input. Playwright 1.65.1 attaches to Safari through `ios_webkit_debug_proxy` and can read the
page, but its `tap` is refused and its click and keyboard are faked in page JavaScript
(`evidence/ios-webkit-input-is-synthetic.txt`). WebDriverAgent (XCUITest) gives trusted touches and
keys (`evidence/ios-wda-steps.txt`).

## Goals, non-goals, anti-goals

- Goal: the journey file runs unchanged on the `ios-webkit` route, with every tap, key and scroll
  sent as a real finger or key by WebDriverAgent, and every read and `expect` done by Playwright.
- Non-goal: the iOS Simulator (next step), native pickers (AC 4), a published package.
- Anti-goal: any input that falls back to Playwright's synthetic events. If WebDriverAgent cannot
  do a call, the call throws naming the method; it never quietly uses Playwright's own input.
- Anti-goal: modifying playwright-core.

## Approaches

1. **Wrap the page (chosen by Shyden, 2026-11-17).** The fixture gives the test a stand-in for
   Playwright's `Page`; reads go to the real page, input goes to WebDriverAgent.
2. Patch playwright-core's WebKit input: covers everything, but redone on every upgrade and carried
   by every project. Rejected.
3. A separate iOS suite calling WebDriverAgent: breaks "same tests on every device". Rejected.

## Design

- `research/devices/ios-wda-page.ts` builds the stand-in with a JavaScript `Proxy` over the real
  `Page`:
  - `goto(url)`: a relative URL is resolved against the configured `baseURL` (the route ignores it).
  - `getByRole`, `getByLabel`, `getByTestId`, `locator`: return a `Proxy` over the real `Locator`;
    on it `tap()` and `click()` read `boundingBox()` through Playwright, map it to a screen point
    (the measured marker method from `ios-wda.device.ts`: a 100x100 fixed marker read back by
    WebDriverAgent gives origin and scale), and send one W3C touch tap through `/actions`.
  - `keyboard.type(text)`: `/wda/keys` with the characters.
  - Every other property is the real one, so `expect(locator)` gets a real-looking `Locator`.
  - Input methods not yet routed (`fill`, `press`, `mouse`, `touchscreen`, `hover`, `dblclick`)
    throw "not routed to WebDriverAgent yet: <method>".
- `fingerScroll` on `ios-webkit`: a W3C touch swipe through `/actions` from 45% to 15% of the
  screen height (the Android fixture's measured span).
- WebDriverAgent's URL comes from `WDA_URL` (the measured run used port 8101; 8100 is held by
  another session's WDA). The session is created once per test and deleted in `finally`.
- The wrapping code is checked by unit tests with the page, locator and `fetch` mocked (no device,
  no network); the device result is the journey run on the iPhone Air, kept as evidence.

## First measurement (settles the main risk)

Whether `expect.soft(proxiedLocator).toHaveText(...)` is accepted. If Playwright refuses the
wrapped locator, work stops and Shyden is asked before anything else is tried.

## Left to the builder

File layout inside `research/devices/`, names, and the exact unit test cases.

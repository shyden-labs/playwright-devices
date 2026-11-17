/**
 * Gives the journey a `page` on the device route named by `DEVICE_ROUTE`, and a `fingerScroll`
 * that drags a real finger up the screen. Each route removes everything it opened when the test
 * ends, a stopped run included, so the next session's connection is not broken by a stale adb
 * forward or tab (ShyTalk's report on shyden-labs/playwright-devices#7).
 */
import { execFileSync } from 'node:child_process';
import { _android, chromium, test as base, type Page, webkit } from '@playwright/test';
import { centreOfText } from './android-native.ts';
import { wrapPageForWda } from './ios-wda-page.ts';
import { openWdaInput, wdaHttp, type WdaInput } from './wda-input.ts';

export const serverPort = 4517;

/** The WebDriverAgent input behind each wrapped iOS page, so the finger scroll uses the same session. */
const iosInputs = new WeakMap<Page, WdaInput>();
const cdpPort = 9222;

interface DeviceFixtures {
  page: Page;
  fingerScroll: () => Promise<void>;
  /** A real touch on the item labelled `label` in a native list the page opened (a <select>'s options, a file menu). */
  nativeChoose: (label: string) => Promise<void>;
  /**
   * With the phone's own file picker open, finds `name` (a file from research/devices/fixtures,
   * placed on the phone by this fixture) and touches it, all by real touches.
   */
  nativeChooseFile: (name: string) => Promise<void>;
}

const fixtureFiles = new URL('fixtures/', import.meta.url);
/** WebDriverAgent's runner app; run-ios-journey.zsh shares its Documents with the Files picker. */
const wdaRunnerBundle = 'uk.co.shyden.WebDriverAgentRunner.xctrunner';
const wdaRunnerFolder = 'WebDriverAgentRunner-Runner';

function adb(serial: string, ...args: string[]): string {
  return execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} must name the device for this route`);
  return value;
}

/**
 * A real finger drag from 45% to 15% of the screen height, sent by Android's own input service.
 * It stays in the top half because the on-screen keyboard can cover the lower part after typing
 * (measured 2026-11-17 on the OnePlus: a 70%-to-30% swipe landed on the keyboard and did not scroll).
 */
function androidSwipeUp(serial: string): void {
  const size = /(\d+)x(\d+)/.exec(adb(serial, 'shell', 'wm', 'size'));
  if (size?.[1] === undefined || size[2] === undefined) throw new Error('adb wm size gave no screen size');
  const x = String(Math.round(Number(size[1]) / 2));
  const fromY = String(Math.round(Number(size[2]) * 0.45));
  const toY = String(Math.round(Number(size[2]) * 0.15));
  adb(serial, 'shell', 'input', 'swipe', x, fromY, x, toY, '400');
}

/** How long a native list may take to open after the tap that opens it (shared with WebDriverAgent's). */
const nativeCeilingMs = 3000;

/**
 * Taps the one on-screen node whose text is `label`, read from Android's accessibility dump, with a
 * real touch from Android's input service. Waits for the list to open up to the ceiling, then fails
 * naming the texts that were on screen.
 */
async function androidTapText(serial: string, label: string): Promise<void> {
  const deadline = Date.now() + nativeCeilingMs;
  for (;;) {
    const xml = adb(serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty');
    const point = centreOfText(xml, label);
    if (point !== undefined) {
      adb(serial, 'shell', 'input', 'tap', String(point.x), String(point.y));
      return;
    }
    if (Date.now() >= deadline) {
      const texts = [...xml.matchAll(/\btext="([^"]+)"/g)].map((m) => m[1]).join(', ');
      throw new Error(`no on-screen node with the text "${label}" within ${String(nativeCeilingMs)}ms (on screen: ${texts || 'no text'})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const chromePackage = 'com.android.chrome';
const chromeSocket = '@chrome_devtools_remote';
const socketCeilingMs = 5000;

function devToolsSocketOpen(serial: string): boolean {
  return adb(serial, 'shell', 'cat', '/proc/net/unix')
    .split('\n')
    .some((line) => line.trim().split(/\s+/).pop() === chromeSocket);
}

/**
 * Chrome opens its DevTools socket only once it is running in the foreground (measured on the
 * OnePlus, 2026-11-17: Chrome's process was alive with no socket). Force-stop it, start it cold on
 * a blank page and wait for the socket, failing at the ceiling with what was measured.
 */
async function launchChromeCold(serial: string): Promise<void> {
  adb(serial, 'shell', 'am', 'force-stop', chromePackage);
  adb(serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'about:blank', chromePackage);
  const deadline = Date.now() + socketCeilingMs;
  while (!devToolsSocketOpen(serial)) {
    if (Date.now() > deadline) {
      throw new Error(`${chromeSocket} did not open within ${String(socketCeilingMs)}ms of a cold Chrome start`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const test = base.extend<DeviceFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this pattern.
  page: async ({}, use) => {
    const route = requiredEnv('DEVICE_ROUTE');
    if (route === 'android-cdp') {
      const serial = requiredEnv('ANDROID_SERIAL');
      const cleanup: (() => unknown)[] = [];
      try {
        adb(serial, 'reverse', `tcp:${String(serverPort)}`, `tcp:${String(serverPort)}`);
        cleanup.push(() => adb(serial, 'reverse', '--remove', `tcp:${String(serverPort)}`));
        await launchChromeCold(serial);
        adb(serial, 'forward', `tcp:${String(cdpPort)}`, 'localabstract:chrome_devtools_remote');
        cleanup.push(() => adb(serial, 'forward', '--remove', `tcp:${String(cdpPort)}`));
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(cdpPort)}`);
        cleanup.push(() => browser.close());
        // Playwright applies `use` options (baseURL, hasTouch) only to contexts it creates, not to
        // the phone's default one (measured 2026-11-17: a relative goto failed there).
        const context = await browser.newContext({ baseURL: `http://localhost:${String(serverPort)}`, hasTouch: true, viewport: null });
        cleanup.push(() => context.close());
        const page = await context.newPage();
        await use(page);
      } finally {
        for (const step of cleanup.reverse()) await step();
      }
      return;
    }
    if (route === 'android-playwright') {
      const serial = requiredEnv('ANDROID_SERIAL');
      adb(serial, 'reverse', `tcp:${String(serverPort)}`, `tcp:${String(serverPort)}`);
      const device = (await _android.devices()).find((candidate) => candidate.serial() === serial);
      if (device === undefined) throw new Error(`Playwright's _android does not list ${serial}`);
      const context = await device.launchBrowser({ baseURL: `http://localhost:${String(serverPort)}`, hasTouch: true, viewport: null });
      const page = await context.newPage();
      try {
        await use(page);
      } finally {
        await context.close();
        await device.close();
        adb(serial, 'reverse', '--remove', `tcp:${String(serverPort)}`);
      }
      return;
    }
    if (route === 'ios-webkit') {
      // Mobile Safari through ios_webkit_debug_proxy (already listening on IWDP_PORT). Playwright
      // 1.65.1's WebKit-over-proxy browser cannot create a context or a page (coreBundle.js
      // WVBrowser/WVBrowserContext throw "Not supported"), so the test is given Safari's one open
      // tab. It must be the only tab: Playwright attaches to every tab the proxy lists and waits
      // for each, and a background tab never answers (measured 2026-11-17 on the iPhone Air,
      // evidence/ios-webkit-background-tab-hang.txt). Safari is brought to the front without a
      // URL, because opening a URL adds a tab.
      const udid = requiredEnv('IOS_UDID');
      const iwdpPort = process.env.IWDP_PORT ?? '9222';
      // IOS_SIMULATOR=1: the UDID is a booted iOS Simulator, which devicectl does not list.
      const launch =
        process.env.IOS_SIMULATOR === '1'
          ? ['simctl', 'launch', udid, 'com.apple.mobilesafari']
          : ['devicectl', 'device', 'process', 'launch', '--device', udid, 'com.apple.mobilesafari'];
      execFileSync('xcrun', launch, { stdio: 'ignore' });
      const tabs = (await fetch(`http://127.0.0.1:${iwdpPort}/json`).then((r) => r.json())) as { url: string }[];
      if (tabs.length !== 1) {
        throw new Error(`Safari must have exactly one tab open for this route; the proxy lists ${String(tabs.length)}`);
      }
      // Playwright's input on this route is page JavaScript faking events
      // (evidence/ios-webkit-input-is-synthetic.txt), so taps, typing and the finger scroll go to
      // WebDriverAgent (WDA_URL) as real touches and keys; Playwright reads and asserts. The phone
      // reaches the test server at PAGE_HOST, because this route ignores Playwright's baseURL.
      const pageHost = requiredEnv('PAGE_HOST');
      const browser = await webkit.connectOverCDP(`http://127.0.0.1:${iwdpPort}`);
      try {
        const page = browser.contexts()[0]?.pages()[0];
        if (page === undefined) throw new Error('the proxy listed no Safari tab Playwright could attach to');
        const input = await openWdaInput(wdaHttp(process.env.WDA_URL ?? 'http://127.0.0.1:8100'), page);
        try {
          const wrapped = wrapPageForWda(page, input, `http://${pageHost}:${String(serverPort)}`);
          iosInputs.set(wrapped, input);
          await use(wrapped);
        } finally {
          await input.close();
        }
      } finally {
        await browser.close();
      }
      return;
    }
    throw new Error(`DEVICE_ROUTE ${route} is not a route this measurement knows`);
  },
  fingerScroll: async ({ page }, use) => {
    const route = requiredEnv('DEVICE_ROUTE');
    const iosInput = iosInputs.get(page);
    if (route === 'ios-webkit' && iosInput !== undefined) {
      await use(() => iosInput.swipeUp());
      return;
    }
    if (route.startsWith('android-')) {
      const serial = requiredEnv('ANDROID_SERIAL');
      await use(() => {
        androidSwipeUp(serial);
        return Promise.resolve();
      });
      return;
    }
    // Fail at the scroll step itself, naming why, so the steps before it are still measured.
    await use(() => Promise.reject(new Error(`DEVICE_ROUTE ${route} has no real finger scroll yet`)));
  },
  nativeChoose: async ({ page }, use) => {
    const route = requiredEnv('DEVICE_ROUTE');
    const iosInput = iosInputs.get(page);
    if (route === 'ios-webkit' && iosInput !== undefined) {
      await use((label) => iosInput.tapNative(label));
      return;
    }
    if (route.startsWith('android-')) {
      const serial = requiredEnv('ANDROID_SERIAL');
      await use((label) => androidTapText(serial, label));
      return;
    }
    await use(() => Promise.reject(new Error(`DEVICE_ROUTE ${route} has no way to touch a native list yet`)));
  },
  nativeChooseFile: async ({ nativeChoose }, use, testInfo) => {
    const route = requiredEnv('DEVICE_ROUTE');
    const placed: string[] = [];
    const source = (name: string) => new URL(name, fixtureFiles).pathname;
    if (route === 'ios-webkit') {
      const udid = requiredEnv('IOS_UDID');
      // Measured 2026-11-18 (iOS 27.2): Safari's file input offers a menu; Choose File opens the
      // Files picker, which reopens wherever it was last, so Browse and On My iPhone lead to the
      // runner's folder from any start. The file shows without its extension.
      await use(async (name) => {
        execFileSync(
          'xcrun',
          [
            'devicectl',
            'device',
            'copy',
            'to',
            '--device',
            udid,
            '--domain-type',
            'appDataContainer',
            '--domain-identifier',
            wdaRunnerBundle,
            '--source',
            source(name),
            '--destination',
            `Documents/${name}`,
          ],
          { stdio: 'ignore' },
        );
        for (const label of ['Choose File', 'Browse', 'On My iPhone', wdaRunnerFolder, name.replace(/\.[^.]+$/, '')])
          await nativeChoose(label);
      });
      // A picker left open by a failed step would swallow the next run's first tap (measured 2026-11-18).
      if (testInfo.status !== testInfo.expectedStatus) await nativeChoose('Cancel').catch(() => undefined);
      return;
    }
    if (route.startsWith('android-')) {
      const serial = requiredEnv('ANDROID_SERIAL');
      try {
        // Measured 2026-11-18 (Android 16): the chooser offers Files, which opens on Recent; a file
        // pushed by adb is listed there once the media scanner has indexed it.
        await use(async (name) => {
          const onPhone = `/sdcard/Download/${name}`;
          adb(serial, 'push', source(name), onPhone);
          placed.push(onPhone);
          adb(serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${onPhone}`);
          for (const label of ['Files', name]) await nativeChoose(label);
        });
      } finally {
        for (const onPhone of placed) {
          adb(serial, 'shell', 'rm', '-f', onPhone);
          adb(serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${onPhone}`);
        }
        // Close a picker a failed step left open, so Chrome is in front for the next run.
        if (testInfo.status !== testInfo.expectedStatus) adb(serial, 'shell', 'input', 'keyevent', 'BACK');
      }
      return;
    }
    await use(() => Promise.reject(new Error(`DEVICE_ROUTE ${route} has no way to reach the native file picker yet`)));
  },
});

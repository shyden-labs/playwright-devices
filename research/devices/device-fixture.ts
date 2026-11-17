/**
 * Gives the journey a `page` on the device route named by `DEVICE_ROUTE`, and a `fingerScroll`
 * that drags a real finger up the screen. Each route removes everything it opened when the test
 * ends, a stopped run included, so the next session's connection is not broken by a stale adb
 * forward or tab (ShyTalk's report on shyden-labs/playwright-devices#7).
 */
import { execFileSync } from 'node:child_process';
import { _android, chromium, test as base, type Page } from '@playwright/test';

export const serverPort = 4517;
const cdpPort = 9222;

interface DeviceFixtures {
  page: Page;
  fingerScroll: () => Promise<void>;
}

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
    throw new Error(`DEVICE_ROUTE ${route} is not a route this measurement knows`);
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this pattern.
  fingerScroll: async ({}, use) => {
    const route = requiredEnv('DEVICE_ROUTE');
    if (route.startsWith('android-')) {
      const serial = requiredEnv('ANDROID_SERIAL');
      await use(() => {
        androidSwipeUp(serial);
        return Promise.resolve();
      });
      return;
    }
    throw new Error(`DEVICE_ROUTE ${route} has no real finger scroll`);
  },
});

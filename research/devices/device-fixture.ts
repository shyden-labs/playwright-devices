/**
 * The journey's fixtures (shyden-labs/playwright-devices#7): connect the route
 * `DEVICE_ROUTE` names, hand the test its page and native steps, and tear
 * down whatever happened. The run scripts start the device side first
 * (WebDriverAgent, ios_webkit_debug_proxy, Chrome and its adb forward).
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _android, chromium, expect, test as base, webkit, type Browser, type Page } from '@playwright/test';
import { androidSession, iosSession, routeFrom, withNamedSteps, type DeviceSession } from './device-session.ts';
import { requireChromeDebugApp, startChromeCold, stopChromeAfterPlaywright } from './android-chrome-start.ts';
import type { Adb } from './finger-scroll.ts';
import { startJourneyServer } from './serve.ts';
import { connectWda } from './wda-client.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** No adb call the journey makes takes long; a hung one (uiautomator on an emulator, 2026-11-18) fails naming itself. */
const ADB_CEILING_MS = 30_000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set; the run script sets it`);
  return value;
}

export function adbFor(serial: string): Adb {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('adb', ['-s', serial, ...args], { timeout: ADB_CEILING_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error)
          reject(new Error(`adb ${args.join(' ')} failed${error.killed ? ` after ${ADB_CEILING_MS} ms` : ''}: ${stderr || error.message}`));
        else resolve(stdout);
      });
    });
}

/** Safari's one tab: Playwright cannot open another over ios_webkit_debug_proxy. */
function onlyTab(browser: Browser): Page {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const [tab] = pages;
  if (pages.length !== 1 || tab === undefined) throw new Error(`Safari must have exactly one tab open; it has ${pages.length}`);
  return tab;
}

interface Connection {
  session: DeviceSession;
  disconnect: () => Promise<void>;
}

async function connect(baseURL: string): Promise<Connection> {
  const files = { document: here('./fixtures/device-journey.txt'), photo: here('./fixtures/device-journey.png') };
  switch (routeFrom(process.env)) {
    case 'ios-webkit': {
      const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
      const wda = await connectWda({ url: process.env.WDA_URL ?? 'http://127.0.0.1:8100' });
      const file = { folder: process.env.IOS_FILE_FOLDER ?? 'WebDriverAgentRunner-Runner', label: 'device-journey' };
      return { session: iosSession({ page: onlyTab(browser), wda, baseURL, file }), disconnect: () => browser.close() };
    }
    case 'android-cdp': {
      const adb = adbFor(required('ANDROID_SERIAL'));
      const port = Number(process.env.ANDROID_CDP_PORT ?? '9230');
      const chrome = await startChromeCold({ adb, port });
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const [context] = browser.contexts();
      if (context === undefined) throw new Error('Chrome on the phone offered no browser context');
      const page = await context.newPage();
      return {
        session: await androidSession({ page, adb, baseURL, files }),
        disconnect: async () => {
          try {
            await page.close();
            await browser.close();
          } finally {
            await chrome.stop();
          }
        },
      };
    }
    case 'android-playwright': {
      const serial = required('ANDROID_SERIAL');
      const adb = adbFor(serial);
      await requireChromeDebugApp(adb);
      const device = (await _android.devices()).find((found) => found.serial() === serial);
      if (device === undefined) throw new Error(`Playwright lists no Android device ${serial}`);
      const context = await device.launchBrowser();
      const page = await context.newPage();
      return {
        session: await androidSession({ page, adb, baseURL, files }),
        disconnect: async () => {
          try {
            await context.close();
            await device.close();
          } finally {
            await stopChromeAfterPlaywright(adb);
          }
        },
      };
    }
  }
}

interface JourneyFixtures {
  session: DeviceSession;
  nativeChoose: DeviceSession['nativeChoose'];
  nativeChooseFile: DeviceSession['nativeChooseFile'];
  nativeChoosePhoto: DeviceSession['nativeChoosePhoto'];
  fingerScroll: DeviceSession['fingerScroll'];
}

export const test = base.extend<JourneyFixtures, { journeyURL: string }>({
  journeyURL: [
    // Playwright reads a fixture's dependencies from this pattern; the server needs none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startJourneyServer(here('./journey.html'));
      try {
        await use(server.baseURL);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],
  session: async ({ journeyURL }, use, testInfo) => {
    const connection = await connect(journeyURL);
    const { disconnect } = connection;
    const session = withNamedSteps(connection.session, (name, body) => base.step(name, body));
    try {
      await use(session);
      // The device's own screen, before teardown closes anything: Playwright's screenshot shows only the page.
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('device screen at failure', { body: await session.screenshot(), contentType: 'image/png' });
        await testInfo.attach('device screen source at failure', { body: await session.screenSource(), contentType: 'text/xml' });
        const touches = await session.page
          .evaluate(() => (window as unknown as { touchesSeen?: string[] }).touchesSeen ?? [])
          .then(
            (seen) => seen.join('\n'),
            (error: unknown) => `the page could not be read: ${String(error)}`,
          );
        await testInfo.attach('touches the page saw', { body: touches, contentType: 'text/plain' });
        const more = await session.moreEvidence();
        await Promise.all(more.map(({ name, body }) => testInfo.attach(name, { body, contentType: 'text/plain' })));
      }
    } finally {
      try {
        await session.close();
      } finally {
        await disconnect();
      }
    }
  },
  page: async ({ session }, use) => {
    await use(session.page);
  },
  nativeChoose: async ({ session }, use) => {
    await use(session.nativeChoose);
  },
  nativeChooseFile: async ({ session }, use) => {
    await use(session.nativeChooseFile);
  },
  nativeChoosePhoto: async ({ session }, use) => {
    await use(session.nativeChoosePhoto);
  },
  fingerScroll: async ({ session }, use) => {
    await use(session.fingerScroll);
  },
});

export { expect };

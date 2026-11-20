/**
 * The journey's fixtures (shyden-labs/playwright-devices#7): connect the route
 * `DEVICE_ROUTE` names, hand the test its page and native steps, and tear
 * down whatever happened. The run scripts start the device side first
 * (WebDriverAgent, ios_webkit_debug_proxy, Chrome and its adb forward).
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _android, chromium, expect, test as base, webkit, type Browser, type Page } from '@playwright/test';
import { androidSession, iosSession, routeFrom, type DeviceSession } from './device-session.ts';
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

function adbFor(serial: string): Adb {
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
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ANDROID_CDP_PORT ?? '9230'}`);
      const [context] = browser.contexts();
      if (context === undefined) throw new Error('Chrome on the phone offered no browser context');
      const page = await context.newPage();
      return {
        session: await androidSession({ page, adb, baseURL, files }),
        disconnect: async () => {
          await page.close();
          await browser.close();
        },
      };
    }
    case 'android-playwright': {
      const serial = required('ANDROID_SERIAL');
      const device = (await _android.devices()).find((found) => found.serial() === serial);
      if (device === undefined) throw new Error(`Playwright lists no Android device ${serial}`);
      const context = await device.launchBrowser();
      const page = await context.newPage();
      return {
        session: await androidSession({ page, adb: adbFor(serial), baseURL, files }),
        disconnect: async () => {
          await context.close();
          await device.close();
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
  session: async ({ journeyURL }, use) => {
    const { session, disconnect } = await connect(journeyURL);
    try {
      await use(session);
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

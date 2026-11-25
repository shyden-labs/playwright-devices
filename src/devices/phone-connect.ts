/**
 * Connects the route a phone project names (shyden-labs/playwright-devices#54):
 * the iPhone's Safari through ios_webkit_debug_proxy and WebDriverAgent, or
 * Chrome on Android over CDP or through Playwright's own Android support.
 * `playwright-devices start` has already started the device side; every
 * outside effect comes in through `ConnectEffects`, so the logic is tested
 * without a phone.
 */
import { parse } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { androidSession, iosSession, type DeviceSession, type IosDevice } from './device-session.ts';
import type { Adb } from './finger-scroll.ts';
import { routeOfProject, targetOfProject, type PhoneProject } from './phone-projects.ts';

/** The files the native pickers offer: absolute paths on this Mac. */
export interface PhoneFiles {
  document: string;
  photo: string;
}

/** The part of Playwright's Android device the connection uses. */
export interface AndroidPhone {
  serial(): string;
  launchBrowser(): Promise<BrowserContext>;
  close(): Promise<void>;
}

/** Everything the connection does outside this process. */
export interface ConnectEffects {
  webkitOverCDP(url: string): Promise<Browser>;
  chromiumOverCDP(url: string): Promise<Browser>;
  androidDevices(): Promise<AndroidPhone[]>;
  connectWda(url: string): Promise<IosDevice>;
  adbFor(serial: string): Adb;
  /** Puts `file` in the WebDriverAgent runner's Documents, where Safari's Files picker lists it. */
  copyToIphone(udid: string, runnerId: string, file: string): Promise<void>;
  startChrome(adb: Adb, port: number): Promise<{ stop: () => Promise<void> }>;
  requireChromeDebugApp(adb: Adb): Promise<void>;
  stopChromeAfterPlaywright(adb: Adb): Promise<void>;
}

export interface Connection {
  session: DeviceSession;
  disconnect: () => Promise<void>;
}

const DEFAULTS = {
  IWDP_URL: 'http://127.0.0.1:9222',
  WDA_URL: 'http://127.0.0.1:8100',
  IOS_FILE_FOLDER: 'WebDriverAgentRunner-Runner',
  ANDROID_CDP_PORT: '9230',
};

function required(env: NodeJS.ProcessEnv, name: string, target: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set; \`playwright-devices start ${target}\` sets it`);
  return value;
}

/** Safari's one tab: Playwright cannot open another over ios_webkit_debug_proxy. */
async function onlyTab(browser: Browser): Promise<Page> {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const [tab] = pages;
  if (pages.length === 1 && tab !== undefined) return tab;
  await browser.close();
  throw new Error(`Safari must have exactly one tab open; it has ${pages.length}`);
}

/** Runs `first`, then `last` whatever happened, and reports `first`'s failure. */
async function thenAlways(first: () => Promise<void>, last: () => Promise<void>): Promise<void> {
  try {
    await first();
  } finally {
    await last();
  }
}

async function connectIphone(env: NodeJS.ProcessEnv, baseURL: string, files: PhoneFiles, effects: ConnectEffects): Promise<Connection> {
  const udid = required(env, 'IOS_UDID', 'iphone');
  const runnerId = required(env, 'IOS_RUNNER_ID', 'iphone');
  await effects.copyToIphone(udid, runnerId, files.document);
  const browser = await effects.webkitOverCDP(env.IWDP_URL ?? DEFAULTS.IWDP_URL);
  const page = await onlyTab(browser);
  const wda = await effects.connectWda(env.WDA_URL ?? DEFAULTS.WDA_URL);
  const file = { folder: env.IOS_FILE_FOLDER ?? DEFAULTS.IOS_FILE_FOLDER, label: parse(files.document).name };
  return { session: iosSession({ page, wda, baseURL, file }), disconnect: () => browser.close() };
}

async function connectAndroidCdp(env: NodeJS.ProcessEnv, baseURL: string, files: PhoneFiles, effects: ConnectEffects): Promise<Connection> {
  const adb = effects.adbFor(required(env, 'ANDROID_SERIAL', 'android'));
  const port = Number(env.ANDROID_CDP_PORT ?? DEFAULTS.ANDROID_CDP_PORT);
  const chrome = await effects.startChrome(adb, port);
  const browser = await effects.chromiumOverCDP(`http://127.0.0.1:${port}`);
  const [context] = browser.contexts();
  if (context === undefined) throw new Error('Chrome on the phone offered no browser context');
  const page = await context.newPage();
  return {
    session: await androidSession({ page, adb, baseURL, files }),
    disconnect: () =>
      thenAlways(
        async () => {
          await page.close();
          await browser.close();
        },
        () => chrome.stop(),
      ),
  };
}

async function connectAndroidPlaywright(
  env: NodeJS.ProcessEnv,
  baseURL: string,
  files: PhoneFiles,
  effects: ConnectEffects,
): Promise<Connection> {
  const serial = required(env, 'ANDROID_SERIAL', 'android');
  const adb = effects.adbFor(serial);
  await effects.requireChromeDebugApp(adb);
  const device = (await effects.androidDevices()).find((found) => found.serial() === serial);
  if (device === undefined) throw new Error(`Playwright lists no Android device ${serial}`);
  const context = await device.launchBrowser();
  const page = await context.newPage();
  return {
    session: await androidSession({ page, adb, baseURL, files }),
    disconnect: () =>
      thenAlways(
        async () => {
          await context.close();
          await device.close();
        },
        () => effects.stopChromeAfterPlaywright(adb),
      ),
  };
}

/**
 * Connects the phone `project` names. Refuses, before touching anything, a run
 * that `playwright-devices start` did not start for that project's device.
 */
export async function connectPhone(
  project: string,
  env: NodeJS.ProcessEnv,
  baseURL: string,
  files: PhoneFiles,
  effects: ConnectEffects,
): Promise<Connection> {
  const route = routeOfProject(project);
  const needed = targetOfProject(project as PhoneProject);
  const started = env.PLAYWRIGHT_DEVICES_TARGET;
  if (started !== needed) {
    const why = started === undefined || started === '' ? 'this run was not started by it' : `this run was started for ${started}`;
    throw new Error(`project ${project} needs \`playwright-devices start ${needed}\`; ${why}`);
  }
  switch (route) {
    case 'ios-webkit':
      return connectIphone(env, baseURL, files, effects);
    case 'android-cdp':
      return connectAndroidCdp(env, baseURL, files, effects);
    case 'android-playwright':
      return connectAndroidPlaywright(env, baseURL, files, effects);
  }
}

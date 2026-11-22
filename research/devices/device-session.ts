/**
 * One device's session for the unchanged journey (shyden-labs/playwright-devices#7):
 * the page the test drives, the native steps, the finger scroll, and the
 * teardown, built from parts the fixture connects. Every input is real: iOS
 * through WebDriverAgent, Android through `adb shell input`.
 */
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import {
  androidChooseFile,
  androidChooseOption,
  androidChoosePhoto,
  androidClosePicker,
  connectAndroidScreen,
  stageAndroidFile,
} from './android-native.ts';
import { androidScreenPointsOf } from './android-page-map.ts';
import { androidFingerScroll, iosFingerScroll, type Adb, type IosSwiper } from './finger-scroll.ts';
import { screenPointsOf, type MarkerReader } from './screen-marker.ts';
import { iosChooseFile, iosChooseOption, iosChoosePhoto, iosClosePicker, type FileInFiles, type NativeScreen } from './ios-native.ts';
import { realInputPage, type RealInput } from './real-input-page.ts';

/** What the journey's fixtures hand the test. */
export interface DeviceSession {
  page: Page;
  nativeChoose: (option: string) => Promise<void>;
  nativeChooseFile: () => Promise<void>;
  nativeChoosePhoto: () => Promise<void>;
  fingerScroll: () => Promise<void>;
  /** The device's screen as PNG bytes, kept as evidence when a test fails. */
  screenshot: () => Promise<Buffer>;
  /** The device's own description of its screen (WebDriverAgent's source, or a uiautomator dump). */
  screenSource: () => Promise<string>;
  /** Further evidence for a failure, each a named text: Android's touches sent and its crash and event logs. */
  moreEvidence: () => Promise<{ name: string; body: string }[]>;
  /** Shuts a picker a failed step left open, then releases the device; call it in the fixture's teardown. */
  close: () => Promise<void>;
}

/** Runs `first`, then `last` whatever happened, and reports `first`'s failure. */
async function thenAlways(first: () => Promise<void>, last: () => Promise<void>): Promise<void> {
  try {
    await first();
  } finally {
    await last();
  }
}

/** The WebDriverAgent client, as the iOS session uses it. */
export type IosDevice = RealInput &
  MarkerReader &
  IosSwiper &
  NativeScreen & { screenshot(): Promise<Buffer>; source(): Promise<string>; close(): Promise<void> };

export interface IosSessionOptions {
  /** Safari's one tab, reached through ios_webkit_debug_proxy. */
  page: Page;
  wda: IosDevice;
  baseURL: string;
  /** Where the journey's document sits in Files, and its name there. */
  file: FileInFiles;
}

export function iosSession({ page, wda, baseURL, file }: IosSessionOptions): DeviceSession {
  return {
    page: realInputPage(page, { input: wda, toScreen: screenPointsOf(page, wda), baseURL }),
    nativeChoose: (option) => iosChooseOption(wda, option),
    nativeChooseFile: () => iosChooseFile(wda, file),
    nativeChoosePhoto: () => iosChoosePhoto(wda),
    fingerScroll: () => iosFingerScroll(wda),
    screenshot: () => wda.screenshot(),
    screenSource: () => wda.source(),
    moreEvidence: () => Promise.resolve([]),
    close: () =>
      thenAlways(
        () => iosClosePicker(wda),
        () => wda.close(),
      ),
  };
}

export interface AndroidSessionOptions {
  /** Chrome's page; its taps and keys are DevTools-injected, so the stand-in sends them through adb. */
  page: Page;
  adb: Adb;
  baseURL: string;
  /** The journey's document and photo, on this Mac. */
  files: { document: string; photo: string };
}

/** Stages the journey's files on the phone (the pickers list only indexed files), and answers the session. */
export async function androidSession({ page, adb, baseURL, files }: AndroidSessionOptions): Promise<DeviceSession> {
  const screen = connectAndroidScreen({ adb });
  const removeDocument = await stageAndroidFile(adb, files.document, '/sdcard/Download');
  const removePhoto = await stageAndroidFile(adb, files.photo, '/sdcard/Pictures');
  return {
    page: realInputPage(page, { input: screen, toScreen: androidScreenPointsOf(page, screen), baseURL }),
    nativeChoose: (option) => androidChooseOption(screen, option),
    nativeChooseFile: () => androidChooseFile(screen, basename(files.document)),
    nativeChoosePhoto: () => androidChoosePhoto(screen),
    fingerScroll: () => androidFingerScroll(adb),
    screenshot: () => screen.screenshot(),
    screenSource: () => screen.source(),
    moreEvidence: async () => [
      { name: 'touches sent', body: screen.touchesSent().join('\n') },
      { name: 'device log', body: await screen.deviceLog() },
      { name: 'memory killer log', body: await screen.memoryLog() },
    ],
    close: () =>
      thenAlways(
        () => androidClosePicker(screen),
        () => thenAlways(removeDocument, removePhoto),
      ),
  };
}

/** Runs `body` as one named step of the test (Playwright's `test.step` in the fixture). */
export type NamedStep = (name: string, body: () => Promise<void>) => Promise<void>;

/**
 * The same session with each native step run inside a step named for it, so a
 * slow stage's report shows which native step took the time.
 */
export function withNamedSteps(session: DeviceSession, step: NamedStep): DeviceSession {
  return {
    ...session,
    nativeChoose: (option) => step(`native: choose "${option}"`, () => session.nativeChoose(option)),
    nativeChooseFile: () => step('native: choose a file', session.nativeChooseFile),
    nativeChoosePhoto: () => step('native: choose a photo', session.nativeChoosePhoto),
    fingerScroll: () => step('native: finger scroll', session.fingerScroll),
  };
}

/** The ways the journey reaches a phone's browser. */
export const ROUTES = ['ios-webkit', 'android-cdp', 'android-playwright'] as const;
export type Route = (typeof ROUTES)[number];

/** The route `DEVICE_ROUTE` names; refuses anything else. */
export function routeFrom(env: NodeJS.ProcessEnv): Route {
  const route = env.DEVICE_ROUTE;
  if ((ROUTES as readonly (string | undefined)[]).includes(route)) return route as Route;
  const it = route === undefined ? 'it is unset' : `it is "${route}"`;
  throw new Error(`DEVICE_ROUTE must be one of ${ROUTES.join(', ')}; ${it}`);
}
